/**
 * scripts/check-cadence.ts — did the scheduled monitors actually run?
 *
 * The live half of `lib/ops/cadence-wall.ts`. Counts SCHEDULED runs in the last
 * 24 hours for each watched workflow and fails when one is below its floor.
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

import { WATCHED, judgeAll, explain, floorFor } from '../lib/ops/cadence-wall.ts';

const REPO = process.env.GITHUB_REPOSITORY ?? 'sgharlow/relay';
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;
const WINDOW_HOURS = 24;

async function scheduledRunsInWindow(file: string, since: Date): Promise<number> {
  /*
    `created` filters server-side, so this reads one page rather than paginating
    the whole history. The API accepts a `>=YYYY-MM-DDTHH:MM:SSZ` range on
    `created`, and `per_page=100` is comfortably above a full day of a 15-minute
    cron even when it is delivering perfectly (96).

    ⚠️ `event=schedule` matters. A dispatch or push run says nothing about
    whether the cron is firing, and counting one would let a busy afternoon of
    manual testing hide a dead schedule.
  */
  const url =
    `${API}/repos/${REPO}/actions/workflows/${file}/runs` +
    `?event=schedule&per_page=100&created=%3E%3D${encodeURIComponent(since.toISOString())}`;

  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${file}`);
  }

  const body = (await res.json()) as { workflow_runs?: unknown[] };
  return (body.workflow_runs ?? []).length;
}

async function main(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);
  console.log(`cadence check — scheduled runs since ${since.toISOString()} (${WINDOW_HOURS}h)\n`);

  const counts: Record<string, number> = {};
  for (const w of WATCHED) {
    try {
      counts[w.file] = await scheduledRunsInWindow(w.file, since);
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
        `(floor ${floor}, designed ${w.nominalPerDay})`,
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
  console.log(`::error::Scheduled monitors below floor — ${findings.map((f) => `${f.file} ${f.observed}/24h`).join(', ')}`);
  console.log(`\n${explain(findings)}\n`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n✗ COULD NOT LOOK: ${String(err)}\n`);
  process.exitCode = 2;
});
