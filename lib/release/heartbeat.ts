/**
 * Heartbeat + scheduler logic (Requirement 4).
 *
 * Two entry points, both built on the ReleaseStateMachine:
 *  - processCheckin(ownerId, machine) — an owner heartbeat: records activity and
 *    reverses any reversible trigger from PENDING/GRACE/RELEASED back to ARMED via
 *    CAS (recovering from a RELEASED reversible trigger closes the recipient's
 *    access — the version bump invalidates outstanding tokens). Estate triggers
 *    are reported as `blocked` (cannot reverse / permanent once released, Req 4.5)
 *    so the route can return 409.
 *  - runHeartbeatSweep(machine, deps) — the cron evaluation: finds overdue active
 *    owners and arms each ARMED release_state to PENDING (Req 4.3), retrying a
 *    transient failure with exponential backoff (base 5s, max 3) before logging
 *    and moving on (Req 4.7).
 *
 * `isOverdue` is the pure overdue predicate (Property 9).
 *
 * 🔴 THE NOTE THAT USED TO SIT HERE WAS FALSE, and it hid the product's worst
 * silence. It read: "the owner-alert email on a PENDING transition (Req 4.4) is
 * sent by the notification layer — wired there, not here." Nothing was wired
 * anywhere: notifyOwnerTriggerPending had ZERO production callers, and
 * notifyVerifiersForTrigger was called only by the MANUAL initiate route. So
 * the flagship scenario — the owner stops checking in and the dead-man's
 * switch arms — proceeded in total silence: no nudge to the owner who might
 * simply be on holiday, and no notice to the verifiers whose confirmations now
 * gate the release. Quorum sat at 0/N with nobody knowing a question existed;
 * the dead-man's switch was a switch that never rang its bell. Both notices
 * now go out from the sweep, best-effort, after the transition commits — a
 * comment claiming a caller exists is not a caller.
 *
 * ⚠️ AND RINGING THE BELL AT THE TRANSITION IS NOT A WARNING BEFORE IT. Until
 * 2026-08-21 the notice above was the whole of what an owner heard: a person on
 * holiday who missed ONE interval had their verifiers asked whether they were
 * incapacitated, and learnt of it from the message saying it had already
 * started. The ladder that runs BEFORE this is `lib/release/checkin-reminder.ts`
 * — a separate sweep, on the same cron, reading a DISJOINT set of owners (those
 * approaching their interval, never those past it).
 *
 * It is deliberately not called from here. `runHeartbeatSweep` is the product's
 * dead-man's switch, and a reminder that could delay or suppress ARMED → PENDING
 * would be a worse defect than the silence it fixes — a genuinely absent owner's
 * family waiting longer, invisibly, until the day it mattered. Keeping the nudge
 * out of this function is what makes that impossible rather than merely
 * unintended. Do not fold it in.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.7, 6.2
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../domain/enums';
import {
  notifyRecipientsOfClosure,
  notifyRecipientsOfRelease,
  notifyOwnerTriggerPending,
  notifyVerifiersForTrigger,
  toVerifierContact,
} from '../notify/notifications';
import { listVerifiers } from '../people/verifiers';
import { isReversibleTrigger, type ReleaseStateMachine } from './state-machine';
import { graceWindowMs } from './triggers';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Just the surface of ReleaseStateMachine this module needs (eases testing). */
type Machine = Pick<ReleaseStateMachine, 'transition'>;

interface PendingRow {
  id: string;
  trigger_type: string;
  state: 'pending' | 'grace' | 'released';
  version: string | number;
}

interface ArmedRow {
  id: string;
  trigger_type: string;
  version: string | number;
}

// ---------------------------------------------------------------------------
// Overdue predicate (Property 9)
// ---------------------------------------------------------------------------

/**
 * True when more than `intervalDays` have elapsed since `lastActiveAt`
 * (strictly greater — exactly-at-interval is not yet overdue).
 */
export function isOverdue(lastActiveAt: Date | string, intervalDays: number, now: Date): boolean {
  const last = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  return now.getTime() - last.getTime() > intervalDays * MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Owner check-in (Property 10)
// ---------------------------------------------------------------------------

export interface CheckinResult {
  /** Trigger types reset PENDING/GRACE → ARMED. */
  reset: string[];
  /** Estate trigger types that could not be reversed (Req 4.5). */
  blocked: string[];
}

/**
 * Records the owner's heartbeat and reverses reversible triggers from
 * PENDING/GRACE back to ARMED. Estate triggers in those states are collected
 * into `blocked` (the route maps a non-empty `blocked` to 409).
 */
export async function processCheckin(ownerId: string, machine: Machine): Promise<CheckinResult> {
  // Req 4.2 — record activity.
  await query(`UPDATE users SET last_active_at = now() WHERE id = $1`, [ownerId]);

  const rows = await query<PendingRow>(
    `SELECT id, trigger_type, state, version
       FROM release_state
      WHERE owner_id = $1 AND state IN ('pending', 'grace', 'released')`,
    [ownerId],
  );

  const reset: string[] = [];
  const blocked: string[] = [];

  for (const row of rows.rows) {
    if (!isReversibleTrigger(row.trigger_type)) {
      blocked.push(row.trigger_type); // estate — cannot reverse / permanent once released (Req 4.5)
      continue;
    }
    try {
      /*
        Re-arm. For a RELEASED reversible trigger this closes the recipient's
        access; clear the release bookkeeping so it starts fresh next time.

        🔴 UNCONDITIONAL SINCE 2026-08-21. It used to reset only when the state
        was RELEASED, so checking in during PENDING or GRACE — the common case,
        and the one the heartbeat exists to serve — re-armed a trigger that still
        carried its confirmations and denials. The next emergency then started
        part-way to quorum. Same defect as standDownTrigger's, in the sibling
        path, with the same comment above it claiming otherwise.
      */
      await machine.transition(row.id, row.state, 'armed', row.version, {
        reversible: true,
        updates: {
          received_confirmations: 0,
          received_denials: 0,
          grace_ends_at: null,
          released_at: null,
        },
      });
      reset.push(row.trigger_type);

      // A RELEASED trigger had recipients holding live access, and they are now
      // owed an explanation. Check-in is the OTHER way access closes — the
      // stand-down button is not the only one — so the notice belongs on both
      // paths or a recipient hears nothing depending on which control the owner
      // happened to use. Best-effort: closing access must not depend on mail.
      if (row.state === 'released') {
        try {
          await notifyRecipientsOfClosure({ ownerId, triggerType: row.trigger_type });
        } catch (err) {
          process.stderr.write(`[checkin] closure notification failed: ${String(err)}\n`);
        }
      }
    } catch {
      // A concurrent writer moved this row; it will be re-evaluated on the next
      // heartbeat. Do not fail the whole check-in for one racing row.
    }
  }

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'owner_checkin',
    entity: 'release_state',
    detail: { reset, blocked },
  });

  return { reset, blocked };
}

// ---------------------------------------------------------------------------
// Cron sweep (Property 9 at the system level)
// ---------------------------------------------------------------------------

export interface SweepResult {
  /** Owners found overdue. */
  evaluated: number;
  /** ARMED → PENDING transitions committed. */
  transitioned: number;
  /** Transitions that failed after all retries. */
  failures: number;
}

export interface SweepDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const CRON_RETRY_BASE_MS = 5000;
const CRON_MAX_RETRIES = 3;

/**
 * Finds overdue active owners and advances each ARMED release_state through
 * PENDING into GRACE (opening the confirmable window) so a missed check-in can
 * actually be released by N-of-M verifier confirmations — the automatic
 * dead-man's-switch. A per-owner transient failure is retried (base 5s backoff,
 * max 3) then logged and skipped so one bad owner never blocks the sweep (Req 4.7).
 */
export async function runHeartbeatSweep(machine: Machine, deps: SweepDeps = {}): Promise<SweepResult> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());

  /*
    🔴 SEEDED ACCOUNTS ARE EXCLUDED, added 2026-08-13 by the release audit after
    measuring what this query would actually do on production.

    `demo@relay.test` is live, holds two ARMED release_states, has a 30-day
    check-in interval and was last active on 2026-08-13 — so on roughly
    2026-09-12 this sweep would have found it overdue and armed both triggers,
    unattended and at night. That fires the owner-alert mail to `demo@relay.test`
    and the verifier notices to `achen@example.com` and `sam@example.com`: three
    addresses in reserved domains that cannot receive mail, so three HARD BOUNCES
    on the Resend account SHARED with report-bridge, where the reputation cost
    lands on a different project. The QA walks hit exactly this on 2026-08-12 and
    the fix was applied to the fixtures; the SEED was never changed, and the
    seeded account is the one that lives in production.

    Nobody could have stopped it either: a demo account has no credential, so
    there is no owner to check in and reverse the false alarm.

    STRUCTURAL RATHER THAN A DATA FIX. Making the seeded addresses deliverable
    (done, in lib/seed/demo-data.ts) stops the bounces; it does not stop a
    fixture account performing a real release nobody asked for. This does. A
    demo advances only through /api/demo/simulate, which is explicit, gated on
    this same flag, and driven by a person who meant it.
  */
  const overdue = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users
       WHERE status = 'active'
         AND is_demo_account = false
         AND now() - last_active_at > (checkin_interval_days * INTERVAL '1 day')`,
  );

  let transitioned = 0;
  let failures = 0;

  for (const owner of overdue.rows) {
    /*
      🔴 THE CRON COULD START A TRIGGER THE PRODUCT NO LONGER OFFERS, added
      2026-08-21 by the release review.

      `/api/triggers/[id]/initiate` refuses a withdrawn type with a 400, and the
      triggers screen tells an owner holding a legacy row that Relay "no longer
      offers" it and "this trigger cannot be started". Both statements were true
      of the OWNER and false of THIS QUERY, which read every armed row for an
      overdue owner with no trigger_type predicate. An `estate` row predating the
      2026-08-14 withdrawal (`g2-counsel-opinion` declined, permanent) would have
      been armed here, every verifier mailed, and released on quorum — and estate
      is not reversible, so `processCheckin` reports it `blocked` and stand-down
      is gated on `reversible`. (Cancel was gated on it too; that control was
      retired on 2026-08-21 and stand-down is now the only stop control, which
      does not change this argument — neither was available to an estate row.)
      The owner could not have stopped what their own screen told them could not
      begin. The copy was false in
      exactly the case it was shown.

      The predicate is in the WHERE clause for the reason the demo exclusion
      above records: a post-hoc filter in JS loads the row anyway and drifts the
      moment a second caller appears. This is the same closed list every other
      release-starting boundary already binds — /api/rules, /api/policies,
      /api/demo/simulate and the initiate route — so the sweep was the one start
      boundary that did not consult it, not a new rule invented here.

      ⚠️ DELIBERATELY NOT APPLIED to `resolveElapsedGrace` below, and the
      asymmetry is the argument rather than an oversight. This guard stops a
      withdrawn arrangement being STARTED. A legacy row already in GRACE with
      quorum met has been started and answered; filtering it out of the resolver
      would strand it in GRACE permanently, with no stand-down path and nobody
      told — trading a visible completion for silent limbo. Finishing what is
      already in flight is the safer direction; refusing to begin is where the
      product's promise actually lives.

      ⚠️ AND IT DOES NOT CLOSE THE HARDER GAP, so nobody mistakes it for cover:
      an overdue owner's `emergency` row still arms, still releases, and nothing
      auto-closes a released state — a deceased owner's emergency access opens
      and stays open. That is the limitation `lib/domain/enums.ts` records, and
      it is untouched by this. Narrowing the type list was never going to fix it.
    */
    const armed = await query<ArmedRow>(
      `SELECT id, trigger_type, version
         FROM release_state
        WHERE owner_id = $1
          AND state = 'armed'
          AND trigger_type = ANY($2)`,
      [owner.id, [...USER_SELECTABLE_TRIGGER_TYPES]],
    );
    for (const rs of armed.rows) {
      const ok = await armOne(machine, rs, owner.id, now, sleep);
      if (ok) transitioned++;
      else failures++;

      /*
        THE BELL, FINALLY RUNG (Req 4.4 + 6.2 on the scheduler path). Sent only
        after the transition COMMITTED — never from inside armOne's retry loop,
        where a transient failure would mean duplicate mail — and best-effort,
        because a mail outage must not fail the sweep or block the next owner.
        The verifier call is the SAME function the manual initiate route uses,
        so the two paths cannot drift on who is told what.
      */
      if (ok) {
        try {
          await notifyOwnerTriggerPending(owner.email, rs.trigger_type);
        } catch (err) {
          process.stderr.write(`[heartbeat] owner pending notice failed: ${String(err)}\n`);
        }
        try {
          const verifiers = await listVerifiers(owner.id);
          await notifyVerifiersForTrigger(
            verifiers.map(toVerifierContact),
            rs.trigger_type,
            rs.id,
            owner.id,
          );
        } catch (err) {
          process.stderr.write(`[heartbeat] verifier notices failed: ${String(err)}\n`);
        }
      }
    }
  }

  return { evaluated: overdue.rows.length, transitioned, failures };
}

async function armOne(
  machine: Machine,
  rs: ArmedRow,
  ownerId: string,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const reversible = isReversibleTrigger(rs.trigger_type);
  for (let attempt = 0; attempt < CRON_MAX_RETRIES; attempt++) {
    try {
      const at = now();
      // ARMED → PENDING (the owner's trigger fires on a missed check-in).
      const pending = await machine.transition(rs.id, 'armed', 'pending', rs.version, {
        reversible,
        updates: { initiated_by: 'cron', initiated_at: at.toISOString() },
      });
      // PENDING → GRACE — open the confirmable window so N-of-M verifier
      // confirmations can drive the release. The owner can still check in to
      // reverse a false alarm while it is in GRACE.
      await machine.transition(pending.id, 'pending', 'grace', pending.version, {
        reversible,
        updates: { grace_ends_at: new Date(at.getTime() + graceWindowMs(rs.trigger_type)).toISOString() },
      });
      return true;
    } catch {
      if (attempt < CRON_MAX_RETRIES - 1) {
        await sleep(CRON_RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }
  process.stderr.write(`[heartbeat] failed to arm owner ${ownerId} trigger ${rs.trigger_type}\n`);
  return false;
}

// ---------------------------------------------------------------------------
// Grace resolution — the missing half of a configurable grace window
// ---------------------------------------------------------------------------

/**
 * Releases GRACE rows whose window has elapsed and whose quorum is already met.
 *
 * WHY THIS EXISTS. `GRACE_WINDOW_MS` is 0, and the comment on it explains that
 * raising it does NOT create an owner-cancel window — it strands the release
 * permanently. `submitConfirmation` evaluates `canRelease` exactly once, at
 * confirmation time; if the window has not elapsed it returns `pending_grace`
 * and nothing ever re-drives it. The sweep only looks at ARMED rows.
 *
 * So the grace window was not a knob that was set to zero — it was a knob that
 * could not be turned. This is the resolver that makes it real: a row whose
 * quorum is met and whose window has now passed gets released on the next
 * sweep. With that in place, GRACE_WINDOW_MS can be raised to give an owner a
 * genuine window to stop a false alarm before anything opens.
 *
 * Deliberately conservative: it releases ONLY rows that already have every
 * confirmation they need. It never lowers a threshold, never releases early,
 * and a row that is short of quorum is left exactly where it is.
 *
 * Requirements: 6.5, 6.6
 */
export async function resolveElapsedGrace(machine: Machine, now: Date = new Date()): Promise<number> {
  const due = await query<{
    id: string;
    owner_id: string;
    trigger_type: string;
    version: string | number;
    received_confirmations: number;
    required_confirmations: number;
  }>(
    `SELECT id, owner_id, trigger_type, version, received_confirmations, required_confirmations
       FROM release_state
      WHERE state = 'grace'
        AND grace_ends_at IS NOT NULL
        AND grace_ends_at <= $1
        AND received_confirmations >= required_confirmations`,
    [now.toISOString()],
  );

  let released = 0;
  for (const row of due.rows) {
    try {
      const committed = await machine.transition(row.id, 'grace', 'released', row.version, {
        reversible: isReversibleTrigger(row.trigger_type),
        updates: { released_at: now.toISOString() },
      });

      // Same notification the confirmation path sends, so a recipient's
      // experience does not depend on which code path completed the release.
      // The version is the COMMITTED row's, not a guess of old+1: the unclaimed
      // fallback mints a token carrying this number, a token whose version
      // disagrees with the row is rejected at redemption, and a guessed version
      // would brick the one credential sent to the person with no other way in.
      await notifyRecipientsOfRelease({
        releaseStateId: row.id,
        ownerId: row.owner_id,
        triggerType: row.trigger_type,
        version: String(committed.version),
      }).catch(() => undefined);

      released++;
    } catch (err) {
      /*
        A concurrent writer moved the row; the next sweep re-evaluates it.

        🔴 THAT SENTENCE WAS THE WHOLE HANDLER UNTIL 2026-08-21 — no counter, no
        log line, nothing. It is true of a lost CAS race and of nothing else. A
        schema change, a bad deploy of state-machine.ts, OCC exhaustion on every
        row: all landed here, silently, hourly, while `recordSchedulerRun` wrote
        a healthy row because it only ever carried the ARMED→PENDING counters.
        The transition that opens a vault could fail permanently and every
        signal the product emitted said fine.

        `getSchedulerHealth` is the alarm now — it derives the stuck rows
        straight from the database rather than trusting a counter. This line is
        what lets whoever answers that alarm find out WHY, with the row that
        failed and the error that failed it.
      */
      process.stderr.write(`[heartbeat] grace release failed for ${row.id}: ${String(err)}\n`);
    }
  }

  return released;
}
