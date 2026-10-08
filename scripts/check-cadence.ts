/**
 * scripts/check-cadence.ts — did the scheduled monitors actually run?
 *
 * The live half of `lib/ops/cadence-wall.ts`. Counts each watched workflow's
 * COUNTED runs in the last 24 hours — the events its `countedEvents` names:
 * scheduled for both, plus dispatched for the canary since 2026-10-08, when its
 * cadence moved to a local dispatcher — and fails when one is below its floor.
 *
 * NO CREDENTIALS BEYOND THE RUNNER'S OWN. It reads the Actions API with
 * `GITHUB_TOKEN`, which every workflow gets for free and which needs no scope
 * beyond the default for a public repo. Like `scripts/canary.ts`, it imports one
 * dependency-free module so the job needs no `npm ci` — a watchdog with a build
 * step is a watchdog with a way to fail silently.
 *
 * Usage:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-cadence.ts
 *
 * Exit codes:
 *   0  every watched schedule is above its floor
 *   1  one or more below — the monitoring is degraded or absent
 *   2  could not look (API error). Deliberately NOT 0: a watchdog that cannot
 *      see is not a watchdog that is happy.
 *
 * Feature: relay-h0-mvp
 * Requirements: B11, B12.i
 */

import { WATCHED, judgeAll, explain, floorFor, countRuns, type WatchedSchedule } from '../lib/ops/cadence-wall.ts';

const REPO = process.env.GITHUB_REPOSITORY ?? 'sgharlow/relay';
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;
const WINDOW_HOURS = 24;

async function countedRunsInWindow(w: WatchedSchedule, since: Date): Promise<number> {
  /*
    One request per counted event, filtered server-side by `event` and `created`,
    so each reads one page: `per_page=100` is above a full day of any one event
    even at the designed rate (96). Asking per event rather than for all runs is
    what keeps that true now that the canary has two sources — together they can
    exceed 100 in a day, and a truncated page would undercount a healthy canary.

    WHICH events count is not decided here: it is `w.countedEvents`, the one
    definition in cadence-wall.ts that the off-GitHub heartbeat reads too. A
    `push` run never counts, and neither does a dispatch of the scheduler
    monitor, which nothing dispatches on a cadence.
  */
  const runs: { event?: unknown; created_at?: unknown }[] = [];
  for (const event of w.countedEvents) {
    const url =
      `${API}/repos/${REPO}/actions/workflows/${w.file}/runs` +
      `?event=${event}&per_page=100&created=%3E%3D${encodeURIComponent(since.toISOString())}`;

    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
    });

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for ${w.file} (${event})`);
    }

    const body = (await res.json()) as { workflow_runs?: { event?: unknown; created_at?: unknown }[] };
    runs.push(...(body.workflow_runs ?? []));
  }
  return countRuns(runs, w.countedEvents, since);
}

async function main(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);
  console.log(`cadence check — counted runs since ${since.toISOString()} (${WINDOW_HOURS}h)\n`);

  const counts: Record<string, number> = {};
  for (const w of WATCHED) {
    try {
      counts[w.file] = await countedRunsInWindow(w, since);
    } catch (err) {
      console.error(`\n✗ COULD NOT LOOK: ${String(err instanceof Error ? err.message : err)}`);
      console.error('  A watchdog that cannot read is not a watchdog that is happy — exiting 2.\n');
      process.exitCode = 2;
      return;
    }
    const floor = floorFor(w);
    const n = counts[w.file];
    console.log(
      `  ${n >= floor ? 'OK ' : '🔴 '} ${w.file.padEnd(26)} ${String(n).padStart(3)} runs ` +
        `(floor ${floor}, designed ${w.nominalPerDay}; counts ${w.countedEvents.join(' + ')})`,
    );
  }

  const findings = judgeAll(counts);
  console.log('');

  if (!findings.length) {
    console.log(`::notice::${explain(findings)}`);
    return;
  }

  /*
    One `::error::` line so the annotation is readable, then the full explanation
    as plain output. GitHub truncates annotations, and the register pointer is
    the part an operator most needs.
  */
  console.log(`::error::Monitors below their run floor — ${findings.map((f) => `${f.file} ${f.observed}/24h`).join(', ')}`);
  console.log(`\n${explain(findings)}\n`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n✗ COULD NOT LOOK: ${String(err)}\n`);
  process.exitCode = 2;
});
