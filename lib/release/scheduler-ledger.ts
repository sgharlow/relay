/**
 * Scheduler run ledger — the CC9 dead-man's-switch.
 *
 * The heartbeat sweep's success signal is a side effect: rows transitioned in a
 * table nobody is watching. Every UI surface can render 200 while the sweep has
 * not run in days, which is exactly what happened here — the cron was never
 * scheduled at all and the test suite stayed green.
 *
 * This records every run and exposes the ABSENCE of recent runs as an unhealthy
 * condition an external monitor can alarm on.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { query } from '../db/connection';

/**
 * The schedule is hourly; allow one missed run plus slack before alarming, so a
 * single late invocation does not page anyone.
 */
export const STALE_AFTER_SECONDS = 9000; // 2.5 h

/** Mirrors SweepResult from lib/release/heartbeat.ts — do not diverge. */
export interface SweepSummary {
  evaluated: number;
  transitioned: number;
  failures: number;
}

export interface SchedulerHealth {
  lastRunAt: string | null;
  ageSeconds: number | null;
  healthy: boolean;
  thresholdSeconds: number;
  /**
   * From the most recent sweep. Reported even when healthy, because a partial
   * failure is worth seeing before it becomes a total one — and because a
   * number nobody can read is how `failures` came to be written and never
   * consulted in the first place.
   */
  failures: number | null;
  transitioned: number | null;
  /**
   * Rows the release resolver should already have opened: state GRACE, quorum
   * met, window elapsed more than one missed run ago. Anything above zero means
   * `resolveElapsedGrace` is not doing its job — see the note in
   * getSchedulerHealth.
   */
  graceOverdue: number;
  /** Requests the owner never answered that `escalateLapsedRequests` has not handed on. */
  escalationOverdue: number;
}

export async function recordSchedulerRun(summary: SweepSummary): Promise<void> {
  await query(
    `INSERT INTO scheduler_runs (job, evaluated, transitioned, failures)
     VALUES ('heartbeat', $1, $2, $3)`,
    [summary.evaluated, summary.transitioned, summary.failures],
  );
}

export async function getSchedulerHealth(now: Date = new Date()): Promise<SchedulerHealth> {
  /*
    🔴 THIS MEASURED THAT THE CRON RAN, NEVER THAT IT WORKED. The sweep records
    `failures` on every run and nothing has ever read the column: health was
    `ran_at` and a threshold, full stop. So a heartbeat firing punctually every
    hour while failing EVERY transition — OCC exhaustion, a DB fault, a bad
    deploy — reported 200 healthy the whole time.

    That is the worst possible shape for this particular probe, because the job
    it is watching IS the dead-man's switch: the thing that advances an overdue
    release when an owner has stopped checking in. A silent total failure means
    nobody's release ever opens, and the monitor built to catch exactly that says
    everything is fine.

    The portfolio rule this violates is the one about unattended jobs: a green
    runner is not proof of work. Running is a necessary signal, not a sufficient
    one.

    THE RULE. Unhealthy when the last sweep attempted work and NONE of it
    landed (`transitioned === 0` with `failures > 0`). A partial failure stays
    healthy but is reported — one row losing a CAS race is ordinary and the next
    sweep retries it, so alarming on it would train people to ignore the alarm.
    An idle sweep (nothing overdue) is healthy: zero of zero is not a failure.

    🔴 AND IT WATCHED ONLY THE FIRST PHASE, until 2026-08-21. `transitioned` and
    `failures` come from `runHeartbeatSweep`, which does ARMED → PENDING → GRACE
    and nothing else. Two more legs run in the same cron and reported into an
    HTTP response nobody reads, swallowing their own failures without even a
    stderr line: `resolveElapsedGrace` (GRACE → RELEASED — the transition that
    actually opens a vault, the product event) and `escalateLapsedRequests`. The
    very failure the rule above was written for could recur one phase later and
    this probe would answer 200 forever, because arming nothing is healthy.

    MEASURED FROM THE WORK, NOT FROM A COUNTER THE SWEEP REMEMBERS TO WRITE.
    New scheduler_runs columns were the obvious fix and the wrong one: a
    migration in two regions, plus a second number that can quietly stop being
    written — which is the shape of the bug, not the shape of the fix. The rows
    that OUGHT to have been resolved are queryable directly, so the probe asks
    the database what is stuck instead of asking the sweep how it thinks it did.
    That also catches the failure that never reaches the sweep at all: a cron
    that stopped invoking the later legs, or a deploy that dropped the call.

    The two sub-selects mirror `resolveElapsedGrace`'s and
    `escalateLapsedRequests`' own WHERE clauses — if those drift, this drifts
    with them and the probe goes blind, so they are pinned by tests naming both
    tables.

    BOUNDED, BECAUSE THIS ENDPOINT IS PUBLIC AND UNAUTHENTICATED. A bare
    `count(*)` over two tables on every anonymous probe is an amplifier the day
    those tables are not tiny; the answer only has to distinguish "none" from
    "some", so each scan stops at 50 rows.

    ⚠️ AND IT DISCLOSES SOMETHING, WHICH IS WORTH SAYING RATHER THAN GLOSSING.
    `graceOverdue: 1` on an unauthenticated endpoint tells anyone who asks that
    a release is stuck somewhere in Relay — and with one production owner,
    "somewhere" is a name. That class of disclosure already existed here
    (`transitioned` says a trigger armed in the last hour, and the route's own
    header claiming it "exposes only a timestamp, an age, and a boolean" went
    stale when those counts were added), and the alternative is the defect this
    closes: an operator who can see the probe is red but not which leg died.
    Owner-scoped identifiers are never returned. If this endpoint is ever
    tightened, tighten `transitioned`/`failures` in the same change — they are
    the same decision.
  */

  // A row is due the instant its window passes, and the cron is hourly, so
  // "due right now" is ordinary. Only still-due after a whole missed run plus
  // slack means the resolver is not running — same threshold, same reasoning as
  // the staleness check, so a single lost CAS race never pages anyone.
  const stuckSince = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000).toISOString();

  const res = await query<{
    ran_at: string;
    transitioned: number | null;
    failures: number | null;
    grace_overdue: number | null;
    escalation_overdue: number | null;
  }>(
    `SELECT ran_at, transitioned, failures,
            (SELECT count(*) FROM (
               SELECT 1 FROM release_state
                WHERE state = 'grace'
                  AND grace_ends_at IS NOT NULL
                  AND grace_ends_at <= $1
                  AND received_confirmations >= required_confirmations
                LIMIT 50) g) AS grace_overdue,
            (SELECT count(*) FROM (
               SELECT 1 FROM access_requests
                WHERE status = 'awaiting_owner'
                  AND expires_at <= $1
                LIMIT 50) e) AS escalation_overdue
       FROM scheduler_runs
      WHERE job = 'heartbeat'
      ORDER BY ran_at DESC
      LIMIT 1`,
    [stuckSince],
  );

  const row = res.rows[0];
  if (!row) {
    return {
      lastRunAt: null,
      ageSeconds: null,
      healthy: false,
      thresholdSeconds: STALE_AFTER_SECONDS,
      failures: null,
      transitioned: null,
      graceOverdue: 0,
      escalationOverdue: 0,
    };
  }

  const ageSeconds = Math.round((now.getTime() - new Date(row.ran_at).getTime()) / 1000);
  const failures = Number(row.failures ?? 0);
  const transitioned = Number(row.transitioned ?? 0);
  // A column this deploy does not know about must read as zero, not NaN: NaN > 0
  // is false, which would disable the check rather than trip it — the check
  // failing silently in the flattering direction is the defect being fixed.
  const graceOverdue = Number(row.grace_overdue ?? 0) || 0;
  const escalationOverdue = Number(row.escalation_overdue ?? 0) || 0;

  const fresh = ageSeconds <= STALE_AFTER_SECONDS;
  const didWork = !(failures > 0 && transitioned === 0);
  const nothingStuck = graceOverdue === 0 && escalationOverdue === 0;

  return {
    lastRunAt: row.ran_at,
    ageSeconds,
    healthy: fresh && didWork && nothingStuck,
    thresholdSeconds: STALE_AFTER_SECONDS,
    failures,
    transitioned,
    graceOverdue,
    escalationOverdue,
  };
}
