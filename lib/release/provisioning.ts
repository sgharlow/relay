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
import { ValidationError } from '../validation';
import { validateNofM, VALID_TRIGGER_TYPES, type TriggerType } from '../rules/access-rules';
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
  return inserted.rows[0];
}

/**
 * Configures the N-of-M quorum for a trigger: validates 1 ≤ N ≤ M (Property 8),
 * ensures the row exists, then sets `required_confirmations = N`.
 */
export async function setRequiredConfirmations(
  ownerId: string,
  triggerType: string,
  n: number,
  m: number,
): Promise<ReleaseStateRow> {
  validateNofM(n, m); // 1 ≤ N ≤ M (throws ValidationError otherwise)
  await ensureReleaseState(ownerId, triggerType, { requiredConfirmations: n });

  const updated = await withOccRetry(() =>
    query<ReleaseStateRow>(
      `UPDATE release_state
          SET required_confirmations = $3
        WHERE owner_id = $1 AND trigger_type = $2
       RETURNING *`,
      [ownerId, triggerType, n],
    ),
  );
  return updated.rows[0];
}
