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
  */
  const res = await query<{
    ran_at: string;
    transitioned: number | null;
    failures: number | null;
  }>(
    `SELECT ran_at, transitioned, failures FROM scheduler_runs
      WHERE job = 'heartbeat'
      ORDER BY ran_at DESC
      LIMIT 1`,
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
    };
  }

  const ageSeconds = Math.round((now.getTime() - new Date(row.ran_at).getTime()) / 1000);
  const failures = Number(row.failures ?? 0);
  const transitioned = Number(row.transitioned ?? 0);

  const fresh = ageSeconds <= STALE_AFTER_SECONDS;
  const didWork = !(failures > 0 && transitioned === 0);

  return {
    lastRunAt: row.ran_at,
    ageSeconds,
    healthy: fresh && didWork,
    thresholdSeconds: STALE_AFTER_SECONDS,
    failures,
    transitioned,
  };
}
