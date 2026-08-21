/**
 * Release-state provisioning (Requirement 5.1).
 *
 * Ensures exactly one `release_state` row exists per (owner_id, trigger_type),
 * created in the ARMED safe-default state. DSQL has no UNIQUE enforcement, so
 * single-row-ness is app-enforced via an OCC intent-read before INSERT.
 *
 * `setRequiredConfirmations` validates the N-of-M configuration via the Rule
 * Engine's `validateNofM` (Property 8) before persisting N — this is the real
 * caller that primitive was built for.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.1, 3.9
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { formatCaseId } from './case-id';
import { ValidationError } from '../validation';
import { validateNofM, VALID_TRIGGER_TYPES, type TriggerType } from '../rules/access-rules';
import { TriggerError } from './triggers';
import type { ReleaseStateRow } from './state-machine';

export interface EnsureOptions {
  /** Required confirmations (N ≥ 1) for a newly-created row. Default 1. */
  requiredConfirmations?: number;
}

/**
 * Returns the (owner, trigger_type) release_state row, creating it ARMED if
 * absent. Idempotent: a second call returns the existing row unchanged.
 */
export async function ensureReleaseState(
  ownerId: string,
  triggerType: string,
  opts: EnsureOptions = {},
): Promise<ReleaseStateRow> {
  if (!VALID_TRIGGER_TYPES.includes(triggerType as TriggerType)) {
    throw new ValidationError(`Unknown trigger type "${triggerType}"`, 'trigger_type');
  }
  const required = opts.requiredConfirmations ?? 1;
  if (!Number.isInteger(required) || required < 1) {
    throw new ValidationError('required_confirmations must be an integer ≥ 1', 'required_confirmations');
  }

  const existing = await query<ReleaseStateRow>(
    `SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2 LIMIT 1`,
    [ownerId, triggerType],
  );
  if (existing.rowCount && existing.rows.length) return existing.rows[0];

  const inserted = await withOccRetry(() =>
    query<ReleaseStateRow>(
      `INSERT INTO release_state (owner_id, trigger_type, state, required_confirmations)
       VALUES ($1, $2, 'armed', $3)
       RETURNING *`,
      [ownerId, triggerType, required],
    ),
  );

  const row = inserted.rows[0];

  // CC7: one phone-readable case ID per release, derived from its own id so the
  // same release always yields the same referent. Set once, at creation.
  await withOccRetry(() =>
    query(`UPDATE release_state SET case_id = $2 WHERE id = $1 AND case_id IS NULL`, [
      row.id,
      formatCaseId(row.id),
    ]),
  );

  return { ...row, case_id: formatCaseId(row.id) };
}

/**
 * Configures the N-of-M quorum for a trigger: validates 1 ≤ N ≤ M (Property 8),
 * ensures the row exists, then sets `required_confirmations = N` — but only
 * while the trigger is ARMED, and only via CAS.
 *
 * 🔴 IT WAS THE ONE release_state WRITE THE OCC DESIGN DID NOT COVER, closed
 * 2026-08-21. `001_initial.sql:9-12` states the rule for this table without
 * exception — all state mutations use CAS on state + version — and this
 * statement was `WHERE owner_id = $1 AND trigger_type = $2`: no state
 * predicate, no version match, no version bump. The route validated N against
 * the eligible verifier count and never read the row's state at all.
 *
 * Only the owner can call it, so this is not an attack. It is an owner changing
 * the outcome of a release that is already running, which is worse for being an
 * accident: lower N from 2 to 1 while a GRACE row already holds one
 * confirmation, and `resolveElapsedGrace` — which releases on
 * `received_confirmations >= required_confirmations` — opens the vault at the
 * top of the next hour. Nobody did anything, nothing said that is what the Set
 * button meant, and the two remaining safeguards (the grace window and a
 * verifier answering) are both already spent.
 *
 * REFUSED, NOT SERIALISED. There is no correct interleaving to choose here — a
 * quorum edit during a live release is a question for the owner, not a race for
 * the database to arbitrate. So both ways of losing return 409: the row is not
 * ARMED when we read it, or a transition committed between the read and the
 * write. The second is the reason the version predicate is here as well as the
 * state one; a state check alone has a window exactly the width of this
 * function.
 *
 * Requirements: 3.9, 6.1, 5.6
 */
export async function setRequiredConfirmations(
  ownerId: string,
  triggerType: string,
  n: number,
  m: number,
): Promise<ReleaseStateRow> {
  validateNofM(n, m); // 1 ≤ N ≤ M (throws ValidationError otherwise)
  const row = await ensureReleaseState(ownerId, triggerType, { requiredConfirmations: n });

  if (row.state !== 'armed') {
    throw new TriggerError(
      `The ${triggerType} trigger is in progress (state=${row.state}). Stand it down before changing how many confirmations it needs.`,
      409,
    );
  }

  const updated = await withOccRetry(() =>
    query<ReleaseStateRow>(
      `UPDATE release_state
          SET required_confirmations = $3,
              version = version + 1
        WHERE id = $1 AND state = 'armed' AND version = $2
       RETURNING *`,
      [row.id, String(row.version), n],
    ),
  );

  if (updated.rowCount === 0 || updated.rows.length === 0) {
    // The row moved under us. Same answer as above, and deliberately the same
    // message: from the owner's side these are one situation.
    throw new TriggerError(
      `The ${triggerType} trigger changed while you were editing it. Reload and try again.`,
      409,
    );
  }
  return updated.rows[0];
}
