/**
 * scripts/stamp-verify-journeys.ts — record that the three journey walks ran.
 *
 * Runs as the last `&&` in `npm run verify:journeys`, so a stamp can only be
 * written when every walk before it exited 0. It is a side effect of success,
 * never a claim of it. The sibling of `stamp-verify-live.ts`, for the chain that
 * shipped without one.
 *
 * WHY. D10 (the journey sweep) was closed on 2026-08-21 by BUILDING these three
 * walks. Building a check is not running it, and nothing here scheduled them or
 * aged them — so from 2026-08-22 the walks could have been dead and the register
 * would still have read closed. `verify:live` had already been given exactly this
 * dead-man two days earlier; the second chain simply did not inherit it.
 *
 * WRITTEN BY THE SCRIPT, NEVER BY HAND — with exactly one exception, which is the
 * same exception `verify-live-runs.jsonl` carries and is made on the same terms.
 * Its first line is BACKFILLED and says so in the row itself (`backfilled: true`
 * plus a `source` quoting the evidence). The evidence is
 * `PROJECT.yaml → deferred.the-journey-sweep-is-stale.closed`, which records all
 * three walks running green on 2026-08-21, and commit `d710b06`, whose message
 * records the runs that found and fixed a parallel-transform flake in them. The
 * timestamp is that commit's authored time — the closest defensible moment; the
 * run preceded it.
 *
 * ⚠️ The bar for that exception is narrow and worth stating, because "backfill it"
 * is the obvious way to make a red dead-man green and is almost always wrong. A
 * backfill is legitimate only when a DATED, THIRD-PARTY record of the run already
 * exists — here, the register entry that closed D10 — and it is illegitimate the
 * moment the justification becomes "I am fairly sure it ran." A stamp written
 * from memory records intent, and this whole mechanism exists because a chain was
 * recorded as closed on the strength of intent.
 *
 * ⚠️ Writes to the REPO, not to the database. It needs no credentials of its own;
 * it runs after the walks that do.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half); B14
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { VERIFY_JOURNEYS_LOG, type VerifyJourneysRun } from '../lib/ops/verify-journeys-freshness';

function gitOrUnknown(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const entry: VerifyJourneysRun = {
    at: new Date().toISOString(),
    commit: gitOrUnknown('rev-parse', '--short', 'HEAD'),
    branch: gitOrUnknown('branch', '--show-current'),
    /*
      The journeys, not the script names, because the journey is what a reader of
      this log is asking about. Each walk prints its own assertion count; this
      records that the chain completed, which is the only thing this script can
      honestly witness.
    */
    walks: ['delegate (J3)', 'request (J6)', 'standdown (J9)'],
  };

  appendFileSync(VERIFY_JOURNEYS_LOG, JSON.stringify(entry) + '\n', 'utf8');

  const lines = readFileSync(VERIFY_JOURNEYS_LOG, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`\n✓ verify:journeys stamped — ${entry.at} @ ${entry.commit} (${lines.length} runs recorded)`);
  console.log(`  ${VERIFY_JOURNEYS_LOG} — commit it with the work this run covered.`);
}

main();
