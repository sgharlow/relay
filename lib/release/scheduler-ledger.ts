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
}

export async function recordSchedulerRun(summary: SweepSummary): Promise<void> {
  await query(
    `INSERT INTO scheduler_runs (job, evaluated, transitioned, failures)
     VALUES ('heartbeat', $1, $2, $3)`,
    [summary.evaluated, summary.transitioned, summary.failures],
  );
}

export async function getSchedulerHealth(now: Date = new Date()): Promise<SchedulerHealth> {
  const res = await query<{ ran_at: string }>(
    `SELECT ran_at FROM scheduler_runs
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
    };
  }

  const ageSeconds = Math.round((now.getTime() - new Date(row.ran_at).getTime()) / 1000);

  return {
    lastRunAt: row.ran_at,
    ageSeconds,
    healthy: ageSeconds <= STALE_AFTER_SECONDS,
    thresholdSeconds: STALE_AFTER_SECONDS,
  };
}
