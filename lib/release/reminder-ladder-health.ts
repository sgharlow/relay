/**
 * Did the check-in reminder ladder actually fire for the people it was due for?
 *
 * 🔴 WHY THIS EXISTS, AND THE DATE THAT FORCED IT. As of 2026-08-30
 * `owner_checkin_reminder_first` and `_final` have ZERO rows in `audit_log`,
 * ever — the ladder shipped 2026-08-21 and has never fired for anybody. Its
 * first firing is dated: the live owner's 75% rung, currently
 * 2026-09-21T15:49Z. `scripts/e2e-sweep.ts --mode reminder` established that a
 * DISPOSABLE owner can never observe it, because the audit row is written only
 * on successful delivery and `email.ts` refuses reserved TLDs — so the first
 * firing will happen to a real address, unattended, and nothing would have
 * noticed either way.
 *
 * `sweepCheckinReminders` NEVER THROWS, by design and for a good reason. So its
 * failure mode is a 200 from the cron, a healthy `scheduler_runs` ledger, and an
 * owner who is simply never warned before their vault starts opening. Every
 * existing alarm in this repo would stay green through that. The portfolio rule
 * is explicit: a job whose success signal is a side effect must have the ABSENCE
 * of that side effect monitored, because a job that never runs produces no
 * failure to alert on.
 *
 * WHAT IT ASKS, AND WHY THAT QUESTION AND NOT ANOTHER. Not "did the sweep run"
 * — `/api/health/scheduler` already answers that, and the sweep running is not
 * the same as an owner being warned. This asks the OUTCOME question: is there an
 * owner for whom a rung has been due for longer than a tick, with nothing in the
 * audit log to show for it? That is one question covering every way the ladder
 * can fail — the cron stopping, the candidate query excluding somebody, a mail
 * provider refusing, a rung renamed — because all of them end in the same place.
 *
 * ⚠️ IT DOES NOT RE-EXPRESS THE RUNGS. `dueRung` is imported and asked, so 75%
 * and 90% appear in exactly one file. An owner for whom `dueRung` STILL returns
 * a rung, when that rung fell due more than {@link REMINDER_GRACE_MS} ago, is an
 * owner the ladder has failed — that is the entire rule, and it cannot drift
 * from the ladder because it IS the ladder's rule.
 *
 * ⚠️ AND IT READS WITHOUT `CANDIDATE_SQL`'s 50% FLOOR, deliberately. Reusing
 * that query would make this check blind to precisely the bug where the floor
 * rises above a rung — the failure `CANDIDATE_FLOOR_FRACTION`'s own header warns
 * about, in which "the reminder silently stops existing for them and nothing
 * else fails". A monitor that inherits the suspect's assumptions is not a
 * monitor. It reads every active non-demo owner holding an armed trigger and
 * applies the rule itself.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, B15.1 (the half a disposable owner cannot prove)
 */

import { query } from '../db/connection';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../domain/enums';
import { CHECKIN_REMINDER_ACTIONS, CHECKIN_REMINDER_RUNGS, dueRung } from './checkin-reminder';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long after a rung falls due before its absence is a finding.
 *
 * THREE HOURS, and the number is chosen against the two alarms either side of
 * it rather than picked for feeling about right. The sweep is hourly, so one
 * hour is the floor. `/api/health/scheduler` calls the scheduler unhealthy at
 * 9000s (2.5 h) of silence, so anything below that is ALREADY somebody else's
 * alarm and firing here too would produce two mails for one cause — the exact
 * noise the portfolio has just finished removing from another project. Three
 * hours starts just above the point where the scheduler alarm has already
 * spoken, so a red here means the sweep was running and the owner still was not
 * warned, which is a different and worse finding.
 */
export const REMINDER_GRACE_MS = 3 * 60 * 60 * 1000;

export interface LadderOwner {
  /** Opaque; never leaves the process. Findings are reported as counts. */
  readonly id: string;
  readonly checkinIntervalDays: number;
  readonly lastActiveAt: string;
  /** Rungs already recorded for this owner since `lastActiveAt`. */
  readonly rungsSent: readonly string[];
}

export interface LadderFinding {
  /** Which rung. `first` or `final`. */
  readonly rung: string;
  /** How long it has been due, in hours, rounded. */
  readonly overdueHours: number;
}

export interface LadderBlindSpot {
  readonly rung: string;
  readonly reason: string;
}

export interface LadderHealth {
  readonly healthy: boolean;
  /** Owners examined. A count, never an identity. */
  readonly ownersExamined: number;
  /** Rungs that fell due, are still due, and have no audit row. */
  readonly unhonoured: LadderFinding[];
  /**
   * Rungs this check structurally cannot report on for an owner, because the
   * rung's window is shorter than the grace period. Reported rather than
   * silently counted as healthy — see {@link assessLadder}.
   */
  readonly blind: LadderBlindSpot[];
  /** Rungs recorded across all owners, ever. Zero until the first firing. */
  readonly rungsEverRecorded: number;
}

/**
 * The rule, pure, so it can be read without a database and tested without one.
 *
 * 🔴 THE BLIND SPOT IS REPORTED RATHER THAN HIDDEN. A rung occupies the window
 * between itself and the next boundary — for the `final` rung at 90% that is the
 * last 10% of the interval, which on a ONE-DAY interval is 2.4 hours, shorter
 * than {@link REMINDER_GRACE_MS}. Such an owner tips past 100% (where `dueRung`
 * correctly returns null, because the dead-man's switch owns them from there)
 * before the grace has elapsed, so this check can never report that rung for
 * them. That is a real limit and the honest thing to do with it is say so on
 * every response: a monitor that quietly returns "healthy" for a question it
 * cannot answer is worse than no monitor. At the 30-day default the same window
 * is three days and there is no blind spot.
 */
export function assessLadder(owners: readonly LadderOwner[], now: Date): LadderHealth {
  const unhonoured: LadderFinding[] = [];
  const blind: LadderBlindSpot[] = [];

  for (const owner of owners) {
    const intervalMs = owner.checkinIntervalDays * MS_PER_DAY;
    const lastActive = new Date(owner.lastActiveAt).getTime();
    if (!Number.isFinite(lastActive) || intervalMs <= 0) continue;

    const elapsedMs = now.getTime() - lastActive;

    // The ladder's own rule, asked rather than restated. Null means either
    // nothing is due yet, or the highest rung reached is already recorded, or
    // the owner is overdue and belongs to the heartbeat sweep instead.
    const due = dueRung(elapsedMs, intervalMs, owner.rungsSent);
    if (due) {
      const dueAtMs = lastActive + due.atElapsedFraction * intervalMs;
      const overdueMs = now.getTime() - dueAtMs;
      if (overdueMs > REMINDER_GRACE_MS) {
        unhonoured.push({ rung: due.key, overdueHours: Math.round(overdueMs / 3_600_000) });
      }
    }

    // Independent of whether anything is due right now: does this owner's
    // interval leave any rung a window too short for this check to see?
    for (let i = 0; i < CHECKIN_REMINDER_RUNGS.length; i++) {
      const rung = CHECKIN_REMINDER_RUNGS[i];
      const next = CHECKIN_REMINDER_RUNGS[i + 1];
      const upperFraction = next ? next.atElapsedFraction : 1;
      const windowMs = (upperFraction - rung.atElapsedFraction) * intervalMs;
      if (windowMs <= REMINDER_GRACE_MS) {
        blind.push({
          rung: rung.key,
          reason:
            `a ${owner.checkinIntervalDays}-day interval leaves this rung a ` +
            `${(windowMs / 3_600_000).toFixed(1)}h window, shorter than the ` +
            `${REMINDER_GRACE_MS / 3_600_000}h grace — its absence cannot be reported`,
        });
      }
    }
  }

  return {
    healthy: unhonoured.length === 0,
    ownersExamined: owners.length,
    unhonoured,
    blind,
    rungsEverRecorded: 0,
  };
}

/**
 * Every active, non-demo owner holding an armed trigger the schedule would act
 * on, with the rungs already recorded for them since they were last active.
 *
 * The `rungsSent` bound is `ts > last_active_at`, which is the bound
 * `rungsSentThisWindow` uses — the ladder resets itself when an owner shows any
 * sign of life, so a rung from a previous window must not count as this one's.
 * That is the one piece of the ladder's logic restated here rather than
 * imported, because it lives inside a private function; if it ever changes,
 * `reminder-ladder-health.test.ts` says so in its own words.
 */
const OWNERS_SQL = `
  SELECT u.id,
         u.checkin_interval_days,
         u.last_active_at::text AS last_active_at,
         COALESCE(
           (SELECT array_agg(a.action)
              FROM audit_log a
             WHERE a.owner_id = u.id
               AND a.action = ANY($2)
               AND a.ts > u.last_active_at),
           ARRAY[]::text[]
         ) AS rungs_sent
    FROM users u
   WHERE u.status = 'active'
     AND u.is_demo_account = false
     AND u.checkin_interval_days > 0
     AND EXISTS (
           SELECT 1 FROM release_state rs
            WHERE rs.owner_id = u.id
              AND rs.state = 'armed'
              AND rs.trigger_type = ANY($1)
         )`;

export async function getReminderLadderHealth(now: Date = new Date()): Promise<LadderHealth> {
  const r = await query<{
    id: string;
    checkin_interval_days: number;
    last_active_at: string;
    rungs_sent: string[] | null;
  }>(OWNERS_SQL, [[...USER_SELECTABLE_TRIGGER_TYPES], [...CHECKIN_REMINDER_ACTIONS]]);

  const owners: LadderOwner[] = r.rows.map((row) => ({
    id: row.id,
    checkinIntervalDays: Number(row.checkin_interval_days),
    lastActiveAt: row.last_active_at,
    rungsSent: row.rungs_sent ?? [],
  }));

  const assessed = assessLadder(owners, now);

  /*
    The counter that makes the FIRST firing visible. Until it moves off zero,
    this product has never sent a check-in reminder to anybody — which is a
    true and useful thing for a monitor to be able to say out loud, and it is
    how the 2026-09-21 firing gets OBSERVED rather than merely survived.
  */
  const ever = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log WHERE action = ANY($1)`,
    [[...CHECKIN_REMINDER_ACTIONS]],
  );

  return { ...assessed, rungsEverRecorded: Number(ever.rows[0]?.n ?? 0) };
}
