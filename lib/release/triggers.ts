/**
 * Trigger lifecycle operations (Requirement 6) built on the ReleaseStateMachine.
 *
 *  - initiateTrigger  — Owner fires a trigger: ARMED → PENDING (Req 6 entry).
 *  - cancelTrigger    — Owner cancels a reversible trigger in GRACE → CANCELLED.
 *  - submitConfirmation — a Verifier confirmation: idempotent intent-read, then
 *    INSERT + CAS-increment of `received_confirmations` (Req 6.3, 6.4, 6.9). When
 *    the quorum is met AND the grace window has elapsed it drives GRACE→RELEASED
 *    (Req 6.5); quorum-met-but-grace-open returns `pending_grace` (Req 6.6).
 *
 * Idempotency (Property 14): the per-(release_state, verifier) intent-read makes
 * repeated sequential submissions increment the counter exactly once. The
 * confirmation row is inserted only AFTER a successful CAS increment, so a
 * retried increment never leaves an uncounted row.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.3, 6.4, 6.5, 6.6, 6.9
 */

import { query } from '../db/connection';
import { isSqlState40001 } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { notifyRecipientsOfRelease } from '../notify/notifications';
import {
  canRelease,
  isReversibleTrigger,
  type ReleaseStateMachine,
  type ReleaseStateRow,
} from './state-machine';

export const VALID_CONFIRM_METHODS = ['app', 'document', 'manual'] as const;
export type ConfirmMethod = (typeof VALID_CONFIRM_METHODS)[number];

/** Carries an HTTP status for the route to map (404 / 409 / 403). */
export class TriggerError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'TriggerError';
    Object.setPrototypeOf(this, TriggerError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Initiate / cancel
// ---------------------------------------------------------------------------

async function readStateByOwnerTrigger(ownerId: string, triggerType: string): Promise<ReleaseStateRow> {
  const r = await query<ReleaseStateRow>(
    `SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2 LIMIT 1`,
    [ownerId, triggerType],
  );
  if (r.rowCount === 0 || r.rows.length === 0) {
    throw new TriggerError(`No release state for trigger "${triggerType}"`, 404);
  }
  return r.rows[0];
}

/** Owner fires a trigger: ARMED → PENDING. Returns the row + verifier recipients. */
export async function initiateTrigger(
  ownerId: string,
  triggerType: string,
  machine: Pick<ReleaseStateMachine, 'transition'>,
  now: Date,
): Promise<ReleaseStateRow> {
  const row = await readStateByOwnerTrigger(ownerId, triggerType);
  if (row.state !== 'armed') {
    throw new TriggerError(`Trigger "${triggerType}" is not ARMED (state=${row.state})`, 409);
  }

  const updated = await machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible: isReversibleTrigger(triggerType),
    updates: { initiated_by: `owner:${ownerId}`, initiated_at: now.toISOString() },
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'trigger_initiated',
    entity: 'release_state',
    entityId: row.id,
    detail: { trigger_type: triggerType },
  });

  return updated;
}

/** Owner cancels a reversible trigger in GRACE → CANCELLED. */
export async function cancelTrigger(
  ownerId: string,
  releaseStateId: string,
  machine: Pick<ReleaseStateMachine, 'transition'>,
): Promise<ReleaseStateRow> {
  const r = await query<ReleaseStateRow>(`SELECT * FROM release_state WHERE id = $1 LIMIT 1`, [
    releaseStateId,
  ]);
  if (r.rowCount === 0 || r.rows.length === 0) {
    throw new TriggerError('Release state not found', 404);
  }
  const row = r.rows[0];
  if (row.owner_id !== ownerId) {
    throw new TriggerError('Not authorized for this trigger', 403);
  }
  if (row.state !== 'grace' || !isReversibleTrigger(row.trigger_type)) {
    throw new TriggerError('Only reversible triggers in GRACE can be cancelled', 409);
  }

  const updated = await machine.transition(row.id, 'grace', 'cancelled', row.version, {
    reversible: true,
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'trigger_cancelled',
    entity: 'release_state',
    entityId: row.id,
    detail: { trigger_type: row.trigger_type },
  });

  return updated;
}

/**
 * Re-issues + re-emails recipient access links for an already-RELEASED trigger
 * (owner-initiated). Recipients are auto-notified on first release; this is the
 * manual re-send. Returns the number of recipients emailed.
 */
export async function resendReleaseNotifications(ownerId: string, releaseStateId: string): Promise<number> {
  const r = await query<ReleaseStateRow>(`SELECT * FROM release_state WHERE id = $1 LIMIT 1`, [releaseStateId]);
  if (r.rowCount === 0 || r.rows.length === 0) {
    throw new TriggerError('Release state not found', 404);
  }
  const row = r.rows[0];
  if (row.owner_id !== ownerId) throw new TriggerError('Not authorized for this trigger', 403);
  if (row.state !== 'released') throw new TriggerError('Release is not active', 409);

  return notifyRecipientsOfRelease({
    releaseStateId,
    ownerId,
    triggerType: row.trigger_type,
    version: row.version,
  });
}

// ---------------------------------------------------------------------------
// Verifier confirmation (Property 14)
// ---------------------------------------------------------------------------

export type ConfirmStatus = 'recorded' | 'duplicate' | 'released' | 'pending_grace' | 'inactive';

export interface ConfirmOutcome {
  status: ConfirmStatus;
  receivedConfirmations: number;
  requiredConfirmations: number;
  triggerType: string;
  /** Owner id when the caller should notify (status === 'pending_grace'). */
  ownerId?: string;
}

export interface SubmitConfirmationParams {
  releaseStateId: string;
  verifierId: string;
  method?: string;
  machine: Pick<ReleaseStateMachine, 'releaseFromGrace'>;
  now: Date;
  sleep?: (ms: number) => Promise<void>;
}

const CONFIRM_MAX_RETRIES = 3;
const CONFIRM_BASE_MS = 100;

export async function submitConfirmation(params: SubmitConfirmationParams): Promise<ConfirmOutcome> {
  const { releaseStateId, verifierId, machine, now } = params;
  const sleep = params.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const method: ConfirmMethod = VALID_CONFIRM_METHODS.includes(params.method as ConfirmMethod)
    ? (params.method as ConfirmMethod)
    : 'app';

  // Idempotency intent-read (Req 6.4).
  const existing = await query<{ id: string }>(
    `SELECT id FROM verifier_confirmations
       WHERE release_state_id = $1 AND verifier_id = $2 LIMIT 1`,
    [releaseStateId, verifierId],
  );

  const head = await readState(releaseStateId);
  if (existing.rowCount && existing.rows.length) {
    return outcome('duplicate', head);
  }
  if (head.state !== 'pending' && head.state !== 'grace') {
    return outcome('inactive', head); // not in a confirmable window
  }

  // CAS-increment received_confirmations (Req 6.3) with bounded OCC retry (Req 6.9).
  let updated: ReleaseStateRow | null = null;
  for (let attempt = 0; attempt < CONFIRM_MAX_RETRIES; attempt++) {
    const cur = await readState(releaseStateId);
    try {
      const upd = await query<ReleaseStateRow>(
        `UPDATE release_state
            SET received_confirmations = received_confirmations + 1,
                version = version + 1
          WHERE id = $1 AND version = $2
       RETURNING *`,
        [releaseStateId, String(cur.version)],
      );
      if (upd.rowCount && upd.rows.length) {
        updated = upd.rows[0];
        break;
      }
      // CAS mismatch — another writer bumped version; re-read and retry.
    } catch (err) {
      if (!isSqlState40001(err)) throw err;
    }
    if (attempt < CONFIRM_MAX_RETRIES - 1) await sleep(CONFIRM_BASE_MS * 2 ** attempt);
  }

  if (!updated) {
    // Could not record within retry budget — treat as a duplicate/no-op (Req 6.9 fail-safe).
    return outcome('duplicate', await readState(releaseStateId));
  }

  // Record the confirmation row AFTER a successful increment (no orphan rows).
  await query(
    `INSERT INTO verifier_confirmations (release_state_id, verifier_id, method)
     VALUES ($1, $2, $3)`,
    [releaseStateId, verifierId, method],
  );

  await writeAuditEntry(updated.owner_id, {
    actor: `verifier:${verifierId}`,
    action: 'verifier_confirmed',
    entity: 'release_state',
    entityId: releaseStateId,
    detail: { received: updated.received_confirmations, required: updated.required_confirmations },
  });

  // Quorum + grace evaluation.
  const quorumMet = updated.received_confirmations >= updated.required_confirmations;
  if (updated.state === 'grace' && quorumMet) {
    if (canRelease(updated.received_confirmations, updated.required_confirmations, updated.grace_ends_at, now)) {
      const released = await machine.releaseFromGrace(updated, now); // GRACE → RELEASED (Req 6.5)
      // Email scoped recipients their access link (best-effort — never blocks release).
      await notifyRecipientsOfRelease({
        releaseStateId: released.id,
        ownerId: released.owner_id,
        triggerType: released.trigger_type,
        version: released.version,
      }).catch(() => {});
      return outcome('released', released);
    }
    return { ...outcome('pending_grace', updated), ownerId: updated.owner_id }; // Req 6.6
  }

  return outcome('recorded', updated);
}

async function readState(id: string): Promise<ReleaseStateRow> {
  const r = await query<ReleaseStateRow>(`SELECT * FROM release_state WHERE id = $1 LIMIT 1`, [id]);
  if (r.rowCount === 0 || r.rows.length === 0) {
    throw new TriggerError('Release state not found', 404);
  }
  return r.rows[0];
}

function outcome(status: ConfirmStatus, row: ReleaseStateRow): ConfirmOutcome {
  return {
    status,
    receivedConfirmations: Number(row.received_confirmations),
    requiredConfirmations: Number(row.required_confirmations),
    triggerType: row.trigger_type,
  };
}
