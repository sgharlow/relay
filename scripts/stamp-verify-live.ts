/**
 * scripts/stamp-verify-live.ts — record that the five walks actually ran.
 *
 * Runs as the last `&&` in `npm run verify:live`, so a stamp can only be written
 * when every walk before it exited 0. It is a side effect of success, never a
 * claim of it.
 *
 * WHY. `npm run verify:live` is the half of the release gate that catches what a
 * unit suite structurally cannot — D1's fail-closed boundary broke two walks on
 * 2026-08-18 while `npm run gate` was GREEN throughout, and only a deliberate
 * manual re-run found it. CLAUDE.md states the weakness plainly: "A gate somebody
 * has to remember is a gate on the days they remember." Nothing recorded when it
 * last ran, so nothing could notice it had stopped.
 *
 * THE STAMP IS THE HEARTBEAT AND ITS ABSENCE IS THE ALARM.
 * `lib/ops/verify-live-freshness.test.ts` fails when the newest entry ages past
 * the threshold. That is the dead-man shape the portfolio rules require of any
 * unattended-ish job whose success signal is a side effect: monitor the ABSENCE,
 * because a job that never runs produces no failure to alert on.
 *
 * WRITTEN BY THE SCRIPT, NEVER BY HAND. A stamp a person can type is a stamp that
 * records intent instead of execution — and this file exists precisely because
 * intent was already being recorded (in sprint reports) while the walks went
 * unrun. The log is append-only and carries the commit each run covered, so
 * "green, but against what?" has an answer.
 *
 * ⚠️ Writes to the REPO, not to the database. It needs no credentials of its own;
 * it runs after the walks that do.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half)
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { VERIFY_LIVE_LOG, type VerifyLiveRun } from '../lib/ops/verify-live-freshness';

function gitOrUnknown(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const entry: VerifyLiveRun = {
    at: new Date().toISOString(),
    commit: gitOrUnknown('rev-parse', '--short', 'HEAD'),
    branch: gitOrUnknown('branch', '--show-current'),
    /*
      Recorded because a walk that has grown while a doc has not is a documented
      failure here: e2e-factors printed 17 assertions while CLAUDE.md said 15.
      The stamp does not assert a count — each walk prints its own — it records
      that the chain completed, which is the only thing this script can honestly
      witness.
    */
    walks: ['stepup', 'multiowner', 'ui', 'reveal', 'factors'],
  };

  appendFileSync(VERIFY_LIVE_LOG, JSON.stringify(entry) + '\n', 'utf8');

  const lines = readFileSync(VERIFY_LIVE_LOG, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`\n✓ verify:live stamped — ${entry.at} @ ${entry.commit} (${lines.length} runs recorded)`);
  console.log(`  ${VERIFY_LIVE_LOG} — commit it with the work this run covered.`);
}

main();
