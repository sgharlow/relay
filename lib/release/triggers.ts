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
import { assertCanRelease } from '../billing/entitlements';
import { isSqlState40001, withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { DECISIONS, evaluateOutcome, type Decision } from './verifier-decision';
import { isEligibleVerifier } from './quorum';
import { notifyRecipientsOfRelease, notifyRecipientsOfClosure } from '../notify/notifications';
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

/**
 * Grace window: release as soon as the N-of-M quorum is met, with no artificial
 * delay. Shared with the cron sweep (lib/release/heartbeat.ts) so both the
 * manual and the automatic missed-check-in paths open the same window.
 *
 * ⚠️ THIS VALUE IS LOAD-BEARING — IT IS NOT A CONFIG KNOB.
 *
 * `submitConfirmation` below is the only driver of GRACE → RELEASED, and it
 * evaluates `canRelease` exactly once, at confirmation time. If the window has
 * not elapsed it returns `pending_grace` and returns — and nothing re-drives it.
 * No scheduled job resolves GRACE rows whose window has since passed
 * (`runHeartbeatSweep` selects `state = 'armed'` only).
 *
 * ⚠️ THE ABOVE WAS TRUE UNTIL 2026-08-08 and is now FIXED. `resolveElapsedGrace`
 * in lib/release/heartbeat.ts runs on every cron sweep and releases GRACE rows
 * where `grace_ends_at <= now()` AND `received >= required` — exactly the
 * resolver this comment asked for. Raising this value now creates a REAL
 * owner-cancel window rather than stranding the release.
 *
 * It stays 0 for the H0 demo, where an instant release is the point. Raising it
 * is now a product decision (how long should an owner get to stop a false
 * alarm?) rather than a thing that would quietly break releases.
 *
 * Guarded by lib/release/grace-window-invariant.test.ts.
 */
export const GRACE_WINDOW_MS = 0;

/**
 * Owner fires a trigger: ARMED → PENDING → GRACE. Entering GRACE opens the
 * confirmable window (stamps `grace_ends_at`) so that N-of-M verifier
 * confirmations can drive GRACE → RELEASED (design.md §"Release State Machine":
 * "PENDING → GRACE: owner notified, grace window started"). Returns the GRACE row.
 *
 * The owner is the one firing it, so we don't wait for an owner-response window;
 * the owner can still check in (PENDING/GRACE → ARMED) before the quorum is met.
 */
export async function initiateTrigger(
  ownerId: string,
  triggerType: string,
  machine: Pick<ReleaseStateMachine, 'transition'>,
  now: Date,
): Promise<ReleaseStateRow> {
  // The paywall, finally connected. assertCanRelease was written, unit-tested
  // and called by NOTHING — dead code that was quietly load-bearing, because
  // wiring it before checkout existed would have meant no account could ever
  // release. Checkout exists now, so it is wired here, on the one path that
  // starts a release. Free currently permits releasing (beta); flipping that
  // flag is what turns enforcement on, and this call is what makes the flag
  // mean something.
  await assertCanRelease(ownerId);

  const row = await readStateByOwnerTrigger(ownerId, triggerType);
  if (row.state !== 'armed') {
    throw new TriggerError(`Trigger "${triggerType}" is not ARMED (state=${row.state})`, 409);
  }
  const reversible = isReversibleTrigger(triggerType);

  // ARMED → PENDING (owner-initiated).
  const pending = await machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible,
    updates: { initiated_by: `owner:${ownerId}`, initiated_at: now.toISOString() },
  });

  // PENDING → GRACE — open the grace window so verifier confirmations can release.
  const graceEndsAt = new Date(now.getTime() + GRACE_WINDOW_MS).toISOString();
  const grace = await machine.transition(pending.id, 'pending', 'grace', pending.version, {
    reversible,
    updates: { grace_ends_at: graceEndsAt },
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'trigger_initiated',
    entity: 'release_state',
    entityId: row.id,
    detail: { trigger_type: triggerType },
  });

  return grace;
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
 * Owner stands a release down: PENDING or GRACE back to ARMED.
 *
 * WHY THIS EXISTS (defect found 2026-08-08 by driving production). The only
 * stop-control the UI offered during an in-progress release was Cancel, which
 * lands in CANCELLED — a state with NO outgoing edge in PERMITTED_TRANSITIONS
 * and which `processCheckin` does not touch. One click on the most innocuous
 * word in the interface permanently killed the access rule: that recipient
 * could never be granted emergency access again, and nothing said so.
 *
 * Relay's headline claim is that emergency access reverses. The reverse edges
 * existed and were tested — `pending → armed` and `grace → armed`, both
 * reversible-only — they simply had no way to be invoked except by the owner's
 * periodic check-in. This exposes them directly, which is what a false alarm
 * actually needs.
 *
 * PERMITTED_TRANSITIONS stays at seven. Nothing is added; two existing edges
 * get a caller.
 */
export async function standDownTrigger(
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

  // Estate handoffs are permanent by design (Req 5.10) — the reverse edges are
  // reversibleOnly, and this check makes the refusal legible rather than
  // letting the state machine throw an opaque transition error.
  if (!isReversibleTrigger(row.trigger_type)) {
    throw new TriggerError('Estate handoffs are permanent and cannot be stood down', 409);
  }
  if (row.state !== 'pending' && row.state !== 'grace' && row.state !== 'released') {
    throw new TriggerError('Only a trigger in PENDING, GRACE or RELEASED can be stood down', 409);
  }

  // RELEASED is the state this matters most in — access has actually been
  // granted, and closing it is the entire differentiator. Until 2026-08-08 a
  // RELEASED trigger had no owner-facing control at all: the released→armed
  // edge existed and processCheckin used it, but an owner home from hospital
  // looking at their own trigger saw no button to close anything.
  //
  // The bookkeeping reset mirrors processCheckin exactly. Without it a re-armed
  // trigger carries its old confirmation count and released_at forward, so the
  // next emergency starts pre-confirmed — it would fire on fewer verifiers than
  // the owner configured.
  const updated = await machine.transition(row.id, row.state, 'armed', row.version, {
    reversible: true,
    updates:
      row.state === 'released'
        ? { received_confirmations: 0, grace_ends_at: null, released_at: null }
        : undefined,
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'trigger_stood_down',
    entity: 'release_state',
    entityId: row.id,
    detail: { trigger_type: row.trigger_type, from: row.state },
  });

  // Only a RELEASED trigger had recipients with live access, so only that case
  // leaves anyone owed an explanation. Best-effort by design: closing access is
  // the safety-critical half and must not be held up, let alone rolled back, by
  // a mail failure.
  if (row.state === 'released') {
    try {
      await notifyRecipientsOfClosure({ ownerId, triggerType: row.trigger_type });
    } catch (err) {
      process.stderr.write(`[release] closure notification failed: ${String(err)}\n`);
    }
  }

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

export type ConfirmStatus =
  | 'recorded'
  | 'duplicate'
  | 'released'
  | 'pending_grace'
  | 'inactive'
  /** Denials made the quorum unreachable; the release stood down to ARMED. */
  | 'halted'
  /**
   * §4.3 — the answer was RECORDED but does not advance the quorum, because the
   * owner has not confirmed this verifier's identity (or they are conflicted out
   * under rules 6/7). J7-R1 guarantees anyone named may render a decision; it
   * does not promise that every decision counts.
   */
  | 'not_counted';

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
  /**
   * confirm (default, so every existing caller is unchanged) | deny | abstain.
   * A verifier who can only confirm is a rubber stamp (J7-R5).
   */
  decision?: Decision;
  machine: Pick<ReleaseStateMachine, 'releaseFromGrace' | 'safeResetToArmed'>;
  now: Date;
  sleep?: (ms: number) => Promise<void>;
}

const CONFIRM_MAX_RETRIES = 3;
const CONFIRM_BASE_MS = 100;

/**
 * Records a denial and halts the release when denials make the N-of-M threshold
 * arithmetically unreachable.
 *
 * `M` is the number of verifiers designated for this owner — the pool the
 * quorum could ever draw from. Halting returns the row to ARMED through
 * `safeResetToArmed`, the same default-safe path OCC exhaustion uses (J7-R7).
 */
async function denyConfirmation(args: {
  releaseStateId: string;
  verifierId: string;
  method: ConfirmMethod;
  head: ReleaseStateRow;
  machine: Pick<ReleaseStateMachine, 'safeResetToArmed'>;
}): Promise<ConfirmOutcome> {
  const { releaseStateId, verifierId, method, head } = args;

  await query(
    `INSERT INTO verifier_confirmations (release_state_id, verifier_id, method, decision)
     VALUES ($1, $2, $3, 'deny')`,
    [releaseStateId, verifierId, method],
  );

  // COALESCE: the column is nullable because DSQL cannot add a NOT NULL column.
  const bumped = await withOccRetry(() =>
    query<ReleaseStateRow>(
      `UPDATE release_state
          SET received_denials = COALESCE(received_denials, 0) + 1
        WHERE id = $1
     RETURNING *`,
      [releaseStateId],
    ),
  );

  const row = bumped.rows[0] ?? head;

  // M = the verifier pool this owner designated.
  const pool = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM verifiers WHERE owner_id = $1`,
    [row.owner_id],
  );

  const outcomeKind = evaluateOutcome({
    m: Number(pool.rows[0]?.n ?? '0'),
    n: row.required_confirmations,
    confirmations: row.received_confirmations,
    denials: Number(row.received_denials ?? 0),
  });

  await writeAuditEntry(row.owner_id, {
    actor: `verifier:${verifierId}`,
    action: 'verifier_denied',
    entity: 'release_state',
    entityId: releaseStateId,
    detail: {
      denials: Number(row.received_denials ?? 0),
      required: row.required_confirmations,
      outcome: outcomeKind,
    },
  });

  if (outcomeKind !== 'halt') return outcome('recorded', row);

  // Enough objections that the quorum can never be met — stand the release down
  // through the same default-safe path OCC exhaustion uses.
  await args.machine.safeResetToArmed(releaseStateId);

  await writeAuditEntry(row.owner_id, {
    actor: 'system',
    action: 'release_halted_by_denial',
    entity: 'release_state',
    entityId: releaseStateId,
    detail: { denials: Number(row.received_denials ?? 0) },
  });

  return outcome('halted', await readState(releaseStateId));
}

/**
 * Does this verifier's answer advance the quorum on THIS release?
 *
 * Reads the same rows the configuration check reads and applies the same
 * predicate, so "what N was validated against" and "what actually counts" are
 * one definition rather than two that can drift apart.
 */
async function verifierCountsTowardQuorum(
  ownerId: string,
  triggerType: string,
  verifierId: string,
): Promise<boolean> {
  const [verifier, recipients] = await Promise.all([
    query<{ id: string; claimed_user_id: string | null; standby_state: string | null }>(
      `SELECT id, claimed_user_id, standby_state FROM verifiers WHERE id = $1 AND owner_id = $2 LIMIT 1`,
      [verifierId, ownerId],
    ),
    query<{ claimed_user_id: string | null }>(
      `SELECT DISTINCT r.claimed_user_id
         FROM recipients r
         JOIN access_rules ar ON ar.recipient_id = r.id
        WHERE ar.owner_id = $1 AND ar.trigger_type = $2 AND r.claimed_user_id IS NOT NULL`,
      [ownerId, triggerType],
    ),
  ]);

  const row = verifier.rows[0];
  if (!row) return false;

  return isEligibleVerifier(row, {
    recipientUserIds: recipients.rows.map((r) => r.claimed_user_id as string),
    ownerUserId: ownerId,
  });
}

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

  // §4.3, tightened 2026-08-12. Checked BEFORE any decision branch so it applies
  // to confirm, deny and abstain alike — a denial from an unverified party must
  // not be able to halt a release either, or the same gap reopens facing the
  // other way.
  //
  // The answer is still recorded below. J7-R1 guarantees that anyone named may
  // render a decision; what changed is that a decision only advances the
  // threshold when the owner has actually checked who they were speaking to.
  if (!(await verifierCountsTowardQuorum(head.owner_id, head.trigger_type, verifierId))) {
    await query(
      `INSERT INTO verifier_confirmations (release_state_id, verifier_id, method, decision)
       VALUES ($1, $2, $3, $4)`,
      [releaseStateId, verifierId, method, params.decision ?? 'confirm'],
    );
    await writeAuditEntry(head.owner_id, {
      actor: `verifier:${verifierId}`,
      action: 'verifier_answer_not_counted',
      entity: 'release_state',
      entityId: releaseStateId,
      detail: { decision: params.decision ?? 'confirm', reason: 'not_confirmed_or_conflicted' },
    });
    return outcome('not_counted', head);
  }

  const decision: Decision = DECISIONS.includes(params.decision as Decision)
    ? (params.decision as Decision)
    : 'confirm';

  // ---- Abstain: recorded, counts toward neither side, escalates elsewhere ----
  if (decision === 'abstain') {
    await query(
      `INSERT INTO verifier_confirmations (release_state_id, verifier_id, method, decision)
       VALUES ($1, $2, $3, 'abstain')`,
      [releaseStateId, verifierId, method],
    );
    await writeAuditEntry(head.owner_id, {
      actor: `verifier:${verifierId}`,
      action: 'verifier_abstained',
      entity: 'release_state',
      entityId: releaseStateId,
    });
    return outcome('recorded', head);
  }

  // ---- Deny: count separately, halt if the quorum becomes unreachable ----
  if (decision === 'deny') {
    return denyConfirmation({ releaseStateId, verifierId, method, head, machine: params.machine });
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
  // Write 'confirm' explicitly rather than leaving NULL: NULL is the
  // backward-compatible reading for rows written before the decision column
  // existed, so a new row that omits it is indistinguishable from a pre-
  // migration one. New rows say what they are.
  await query(
    `INSERT INTO verifier_confirmations (release_state_id, verifier_id, method, decision)
     VALUES ($1, $2, $3, 'confirm')`,
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
