/**
 * A guard that goes red on a date must be RUN on that date.
 *
 * 🔴 THE FINDING. Three guards in this repo are designed to turn red with no
 * code change — `gates.test.ts` when a gate's `ratify_by` passes,
 * `verify-live-freshness.test.ts` when the live walks go stale, and
 * `ladder-claim.test.ts` when a ladder claim's evidence ages past
 * `SCOPE_REQUIRED_AFTER_DAYS`. Until 2026-08-21 the only pipeline that ran them
 * fired on `push`, `pull_request` and `workflow_dispatch`, and nothing else.
 *
 * So a dead-man was being evaluated only when somebody touched the repo, which
 * is the one condition under which it has nothing to report. They worked
 * because pushes happened to be frequent. The first quiet fortnight — an owner
 * on holiday, a lane stalled — and all three become decoration at exactly the
 * moment they were meant to speak. The portfolio rule is explicit that a job
 * that never runs produces no failure to alert on; these ran, but only ever on
 * the days they were least needed.
 *
 * ⚠️ THIS IS A COVERAGE CHECK, NOT A LIVENESS CHECK — the same caveat
 * `alarm-of-record.test.ts` carries. It reads a workflow file. It cannot tell
 * whether GitHub actually fired the cron, and no unit suite can. What it
 * prevents is the silent version: a new dated guard added with nothing
 * scheduled to run it, or the scheduled run deleted while three headers go on
 * describing themselves as dead-men.
 *
 * HOW A GUARD DECLARES ITSELF DATED. By saying so in its own header, in the
 * words those three already used: "go red on a date" or "go red with no code
 * change". A structural detector — any test that calls `new Date()` — matches
 * two dozen files that merely compute an expiry relative to now, which is a
 * different thing and not something a schedule fixes.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = '.github/workflows/date-guards.yml';

/**
 * An author's declaration that their test turns red on the calendar rather than
 * on a diff. Both spellings are the ones already in the repo; neither was
 * invented for this check.
 */
const DECLARES_ITSELF_DATED = /go(?:es)? red (?:on a date|with no code change)/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SELF = 'lib/ops/date-guards-are-scheduled.test.ts';

const datedGuards = [...walk('lib'), ...walk('src')]
  .filter((f) => /\.test\.tsx?$/.test(f))
  // This file quotes both spellings in order to look for them, so without the
  // exclusion it detects itself and the vacuity check below passes on nothing.
  .filter((f) => f !== SELF)
  .filter((f) => DECLARES_ITSELF_DATED.test(readFileSync(f, 'utf8')));

describe('the dated guards', () => {
  it('are found at all, so this suite is not vacuous', () => {
    expect(
      datedGuards.length,
      'No test declares itself date-triggered any more. Either the three dead-men were ' +
        'deleted, or their headers were reworded and this detector now matches nothing — ' +
        'both of which make the scheduled run below pointless.',
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('something runs them without waiting for a push', () => {
  it(`${WORKFLOW} exists`, () => {
    expect(
      existsSync(join(process.cwd(), WORKFLOW)),
      `${WORKFLOW} is gone. The dated guards are back to being evaluated only when somebody ` +
        'pushes — i.e. never during the quiet period they exist to detect.',
    ).toBe(true);
  });

  const src = existsSync(join(process.cwd(), WORKFLOW))
    ? readFileSync(join(process.cwd(), WORKFLOW), 'utf8')
    : '';

  it('runs on a schedule, not only on demand', () => {
    expect(src).toContain('schedule:');
    expect(src, 'the workflow has a schedule: block with no cron in it').toMatch(/cron:\s*'/);
  });

  it('names every guard that declares itself dated', () => {
    const missing = datedGuards.filter((g) => !src.includes(g));
    expect(
      missing,
      missing.length
        ? 'These tests say in their own headers that they go red on a date, and the scheduled ' +
          `run does not invoke them:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
          `Add them to ${WORKFLOW}. A dated guard nothing runs on a schedule is a note.`
        : 'ok',
    ).toEqual([]);
  });

  /*
    The other direction. A workflow that invokes a path which no longer exists
    fails for a reason that reads like a broken pipeline rather than a renamed
    file, and the usual repair is to delete the line — which silently drops the
    guard.
  */
  it('does not name a guard that has been moved or deleted', () => {
    const named = [...src.matchAll(/((?:lib|src)\/[\w./[\]()-]+\.test\.tsx?)/g)].map((m) => m[1]);
    expect(named.length, 'the workflow invokes no test files at all').toBeGreaterThanOrEqual(3);
    const gone = named.filter((n) => !existsSync(join(process.cwd(), n)));
    expect(gone, `${WORKFLOW} names test files that do not exist: ${gone.join(', ')}`).toEqual([]);
  });
});
