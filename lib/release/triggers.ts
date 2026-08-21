/**
 * Trigger lifecycle operations (Requirement 6) built on the ReleaseStateMachine.
 *
 *  - initiateTrigger  — Owner fires a trigger: ARMED → PENDING (Req 6 entry).
 *  - standDownTrigger — Owner stops a false alarm: PENDING/GRACE/RELEASED → ARMED.
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

import { recordIntegrityAction } from '../db/integrity';
import { query } from '../db/connection';
import { assertCanRelease } from '../billing/entitlements';
import { isSqlState40001, withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { DECISIONS, evaluateOutcome, type Decision } from './verifier-decision';
import { isEligibleVerifier, countEligibleVerifiers } from './quorum';
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
// Initiate / stand down
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
 * How long after a release starts before anything can open.
 *
 * ⚖️ RULED 2026-08-12, and it is NOT one number. A single constant conflated two
 * situations with opposite requirements, which is why picking a value for it
 * always felt arbitrary.
 *
 * REVERSIBLE TRIGGERS: 0. The owner is already protected at every point —
 * `processCheckin` reverses PENDING, GRACE and RELEASED alike, so checking in
 * closes access that has already opened, by hand of nobody. A delay adds nothing
 * they do not already have and costs something real: a spouse waiting on a
 * hospital's insurance portal while a timer runs. Every path to here has ALSO
 * already given the owner a chance to say no — an owner-initiated release now
 * needs an explicit confirmation, the cron fires only after the full check-in
 * interval AND the reminder ladder that precedes it, and an escalation only
 * after a challenge window the owner did not answer.
 *
 * 🔴 THAT CLAUSE WAS FALSE FOR MOST OF A DAY, and the history matters more than
 * the current wording. It read "the full check-in interval PLUS REMINDERS" and
 * there were no reminders: `runHeartbeatSweep` transitioned on the FIRST overdue
 * sweep and notified afterwards, and grep found no reminder sender anywhere in
 * lib/. J5-R4 required an escalation ladder before any ARMED → PENDING and the
 * register and ROADMAP both recorded it as OPEN, so this comment was the only
 * place in the repo claiming otherwise — and it was being used to justify a zero
 * grace window. It was corrected to say what existed on 2026-08-21 morning; the
 * ladder itself landed later the same day
 * (`lib/release/checkin-reminder.ts`), so the clause is now earned rather than
 * asserted. Both directions are the same lesson: a comment is not a caller, and
 * a safety argument resting on one is resting on nothing.
 *
 * ESTATE: 72 hours, because none of that is true. `processCheckin` puts estate
 * in its `blocked` list — "cannot reverse / permanent once released" — so once
 * it completes there is no way back at all, for anyone. This window is the ONLY
 * moment an owner can intervene, which makes it the opposite of an artificial
 * delay: it is the entire protection.
 *
 * The asymmetry decides the length. If the estate event is real, the owner is
 * dead and three days against probate timescales is nothing. If it is a mistake,
 * three days may be the only thing that saves them. 72h also matches
 * `CHALLENGE_WINDOW_SECONDS.estate`, because both answer the same question —
 * how long before something permanent happens to this person's estate — and two
 * numbers answering one question is how they drift apart.
 *
 * ⚠️ A NON-ZERO WINDOW ONLY WORKS BECAUSE `resolveElapsedGrace` EXISTS. Until
 * 2026-08-08 nothing re-drove a GRACE row after its window passed, so raising
 * this would have stranded the release rather than delaying it. That resolver
 * now runs on the hourly cron and releases only rows whose quorum is already
 * met, so the effective wait is the window plus at most an hour.
 *
 * Guarded by lib/release/grace-window-invariant.test.ts.
 */
export function graceWindowMs(triggerType: string): number {
  return isReversibleTrigger(triggerType) ? 0 : 72 * 60 * 60 * 1000;
}

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
  const graceEndsAt = new Date(now.getTime() + graceWindowMs(triggerType)).toISOString();
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

/*
  🔴 `cancelTrigger` STOOD HERE, and it is retired — ruled 2026-08-21.

  It read the row, checked ownership and reversibility, and drove
  GRACE → CANCELLED. `PERMITTED_TRANSITIONS` has no edge out of `cancelled`, so
  that call permanently retired the trigger TYPE for the owner: every access rule
  using it, every recipient scoped to it, with `/initiate` answering 409 for it
  forever, check-in not reversing it, and the heartbeat sweep never reading it
  again. Its only caller was `POST /api/triggers/[id]/cancel`, behind a two-tap
  "Cancel permanently" button sitting next to the one an owner actually wants —
  and the whole reason `standDownTrigger` below exists (2026-08-08) is that
  people were reaching for that button to stop a false alarm and retiring their
  arrangement instead.

  Two rounds of copy fixes went into making the button describe itself honestly.
  The ruling is that the wording was never the problem: a permanent,
  unreachable-from state does not belong two taps deep on the screen somebody
  opens while something is going wrong.

  ⚠️ THE STATE-MACHINE EDGE IS DELIBERATELY KEPT — see the note on it in
  state-machine.ts. Production holds rows that took it and the CANCELLED card
  still renders for them; what is gone is every way to reach it. Removing the
  function as well as the route is the point: a library call that can permanently
  retire an owner's arrangement is not something to leave lying about because
  deleting the button felt like enough.
*/

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
  /*
    The bookkeeping reset mirrors processCheckin exactly. Without it a re-armed
    trigger carries its old confirmation count and released_at forward, so the
    next emergency starts pre-confirmed — it would fire on fewer verifiers than
    the owner configured.

    🔴 THAT PARAGRAPH WAS TRUE AND THE CODE UNDER IT ONLY HALF DID IT, corrected
    2026-08-21. The reset was conditional on `row.state === 'released'`, so
    standing down from PENDING or GRACE — the ordinary false alarm, caught early,
    which is the case this control was BUILT for — cleared nothing. A 2-of-3 with
    Alice already confirmed went back to ARMED still carrying her vote, and the
    next month's emergency opened the vault on one live confirmation plus a
    stale one. The condition described the rarer path and the comment described
    the intent; nothing described what ran.

    `received_denials` is cleared here too, and could not be before: it was
    missing from UPDATABLE_COLUMNS, so the state machine dropped the key.
    Unconditional now — every re-arm, from every state, starts clean.
  */
  const updated = await machine.transition(row.id, row.state, 'armed', row.version, {
    reversible: true,
    updates: {
      received_confirmations: 0,
      received_denials: 0,
      grace_ends_at: null,
      released_at: null,
    },
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
   * under rules 6/7). J7-R1 guarantees that nobody has to ENROL in order to
   * answer; since its second amendment (2026-08-12) it does not promise that
   * everyone named can answer, nor that every answer counts. An unconfirmed
   * verifier is mailed no code at all — see lib/notify/verifier-notice-class.ts.
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

  /*
    🔴 M IS THE ELIGIBLE POOL, NOT THE ROSTER — corrected 2026-08-13. This used
    to count every named verifier, while confirmations and denials only ever
    come from ELIGIBLE ones (confirmed, unconflicted — the gate below refuses
    the rest). With the ordinary beta roster — some named people never verified
    — the raw count inflated M, so the halt threshold (denials that make quorum
    arithmetically unreachable) could NEVER be crossed: both eligible verifiers
    deny, quorum is factually dead, and the release waited forever instead of
    standing down. The deny-halt safety of J7-R7 was unreachable for exactly
    the rosters the beta has. One predicate, shared with the answering gate and
    the readiness banner, so the three cannot drift.
  */
  const [poolRows, conflictedRecipients] = await Promise.all([
    query<{ id: string; claimed_user_id: string | null; standby_state: string | null }>(
      `SELECT id, claimed_user_id, standby_state FROM verifiers WHERE owner_id = $1`,
      [row.owner_id],
    ),
    query<{ claimed_user_id: string | null }>(
      `SELECT DISTINCT r.claimed_user_id
         FROM recipients r
         JOIN access_rules ar ON ar.recipient_id = r.id
        WHERE ar.owner_id = $1 AND ar.trigger_type = $2 AND r.claimed_user_id IS NOT NULL`,
      [row.owner_id, row.trigger_type],
    ),
  ]);

  const outcomeKind = evaluateOutcome({
    m: countEligibleVerifiers(poolRows.rows, {
      recipientUserIds: conflictedRecipients.rows.map((r) => r.claimed_user_id as string),
      ownerUserId: row.owner_id,
    }),
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

  /*
    RE-READ, AND REPORT WHAT ACTUALLY HAPPENED. This used to write the halt
    audit entry and return `halted` without ever checking whether the reset
    landed, which was safe only because the reset was unconditional and always
    landed. It is guarded now (state-machine.ts): a row a concurrent
    confirmation already drove to RELEASED is deliberately left alone, because
    undoing a committed release with no notice to the people whose access it
    closes is not a safety net.

    So the halt can now genuinely fail to happen, and the verifier must be told
    so. Logging `release_halted_by_denial` for a release that went ahead would
    put a false event in the owner's own record — the one place they go to
    reconstruct what occurred — so both the entry and the status key on the
    re-read. The denial itself is already on the record above either way.
  */
  const after = await readState(releaseStateId);
  if (after.state !== 'armed') return outcome(after.state === 'released' ? 'released' : 'recorded', after);

  await writeAuditEntry(row.owner_id, {
    actor: 'system',
    action: 'release_halted_by_denial',
    entity: 'release_state',
    entityId: releaseStateId,
    detail: { denials: Number(row.received_denials ?? 0) },
  });

  return outcome('halted', after);
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

  /*
    Idempotency intent-read (Req 6.4) — SCOPED TO THE CURRENT RELEASE INSTANCE.

    🔴 IT WAS NOT, until 2026-08-21, and the consequence was the worst kind:
    quiet, and on the second use. `release_state` is ONE PERMANENT ROW per
    (owner, trigger_type) — `ensureReleaseState` returns the existing row and
    nothing deletes it — and `verifier_confirmations` keys on that permanent id.
    So this read asked "has this verifier EVER answered on this trigger", and
    answered `duplicate` to somebody responding to a completely different
    emergency months later. Their standby dashboard showed nothing waiting, the
    token door said "Recorded", and the tally did not move. On a 1-of-1 roster —
    which is the roster the beta actually has — the second emergency could never
    reach quorum at all.

    `initiated_at` is the instance marker and it already existed: all five paths
    that start a release stamp it (owner initiate, owner-consent challenge, lapse
    escalation, cron heartbeat, demo simulate). A NULL falls back to the old
    unscoped behaviour, which is the conservative direction — the fallback can
    only refuse an answer, never manufacture one.

    The head read moved ABOVE this one because this one now depends on it.

    ⚠️ TWO THINGS THIS KEY IS NOT, both worth knowing before anyone "improves" it.
    (1) `confirmed_at` comes from the DATABASE clock (its column DEFAULT) and
    `initiated_at` from the APP clock. If the app clock ran AHEAD of the database
    clock, a confirmation landing inside that skew window would not be seen by a
    later duplicate read, and a double-tap could count twice. That is the risky
    direction, and it is left rather than papered over with a fudge factor: the
    gap between a release opening and a human answering is seconds to minutes,
    NTP skew is milliseconds, and a tolerance constant would be a second thing to
    get wrong. If confirmations are ever machine-generated, revisit this.
    (2) `case_id` is NOT an alternative key. Provisioning sets it once
    (`UPDATE ... WHERE case_id IS NULL`, lib/release/provisioning.ts), so it
    identifies the TRIGGER, not the emergency — every release on a trigger shares
    one case reference. A per-release id would need a column, therefore a
    migration, therefore Steve; `initiated_at` is what exists today.
  */
  const head = await readState(releaseStateId);

  const existing = await query<{ id: string }>(
    `SELECT id FROM verifier_confirmations
       WHERE release_state_id = $1 AND verifier_id = $2
         AND ($3::timestamptz IS NULL OR confirmed_at >= $3::timestamptz)
       LIMIT 1`,
    [releaseStateId, verifierId, head.initiated_at],
  );
  if (existing.rowCount && existing.rows.length) {
    /*
      Requirement 16.5 names this as one of four integrity actions the audit log
      must carry (`ref_integrity_uniqueness_enforced`), and it had never been
      written. A silently-ignored duplicate is the correct BEHAVIOUR — a
      verifier who taps twice, or whose confirmation email is opened on two
      devices, must not count twice — but the owner's record showed nothing at
      all, so a second answer that changed no tally left no trace of having
      arrived.
    */
    await recordIntegrityAction(
      head.owner_id,
      'ref_integrity_uniqueness_enforced',
      'verifier_confirmations',
      releaseStateId,
      { verifierId },
    );
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
  // The answer is still recorded below — an unconfirmed verifier who CAN reach
  // this door (they claimed a standby account, or hold a code from before the
  // owner's decision) has their answer on the record and out of the tally.
  // J7-R1 guarantees only that nobody enrols in order to answer; its second
  // amendment (2026-08-12) withdrew the promise that anyone named can vote, and
  // an unconfirmed verifier is now mailed no code at all.
  if (!(await verifierCountsTowardQuorum(head.owner_id, head.trigger_type, verifierId))) {
    // RECORDED IN THE AUDIT LOG ONLY, and deliberately NOT in
    // verifier_confirmations. That table is the quorum ledger, and the
    // idempotency intent-read above keys on it: writing a non-counting row there
    // would make every later attempt return `duplicate`, so a verifier who
    // answered before the owner got round to verifying them could NEVER count —
    // permanently, and silently. That is the ordinary beta sequence (they
    // answer, the owner then makes the call), so it would have been the common
    // case rather than an edge one.
    //
    // Leaving the ledger untouched means they can simply answer again once
    // verified, and the audit entry below is the durable record that they did
    // respond — which is the thing the owner needs to know.
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
