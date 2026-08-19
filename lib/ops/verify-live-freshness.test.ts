/**
 * The dead-man for the half of the release gate nothing schedules.
 *
 * ⚠️ THIS TEST IS DESIGNED TO GO RED WITH NO CODE CHANGE, on a date, exactly as
 * `gates.test.ts` is. When it fires it is reporting that the five live walks have
 * stopped running — which is a real finding about this project, not a bug in the
 * suite. `explain()` prints the two honest fixes.
 *
 * WHY A DEAD-MAN AND NOT AN ALERT. The portfolio rule: any check whose success
 * signal is a side effect must have the ABSENCE of that signal monitored, because
 * a job that never runs produces no failure to alert on. Every prior attempt to
 * make `verify:live` reliable was a note telling somebody to remember it, and
 * CLAUDE.md already conceded the outcome — "a gate somebody has to remember is a
 * gate on the days they remember."
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  VERIFY_LIVE_LOG,
  STALE_AFTER_DAYS,
  assess,
  parseLog,
  explain,
} from './verify-live-freshness';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const entry = (at: string, commit = 'abc1234') =>
  JSON.stringify({ at, commit, branch: 'master', walks: ['stepup', 'multiowner', 'ui', 'reveal', 'factors'] });

describe('reading the run log', () => {
  it('an empty or missing log is `never`, and says so distinctly', () => {
    expect(assess(null, NOW).state).toBe('never');
    expect(assess('', NOW).state).toBe('never');
    expect(assess('\n  \n', NOW).state).toBe('never');
  });

  /**
   * The distinction that stops a monitor lying: a corrupt file must not read as
   * "nobody has ever run this", because the fixes are different and one of them
   * (run the walks) would leave the corruption in place.
   */
  it('a corrupt log is `unreadable`, never `never`', () => {
    expect(assess('not json at all', NOW)).toMatchObject({ state: 'unreadable' });
    expect(assess('{"commit":"abc"}', NOW)).toMatchObject({ state: 'unreadable' });
    expect(assess('{"at":"not-a-date","commit":"abc"}', NOW)).toMatchObject({ state: 'unreadable' });
    expect(assess('{"at":"2026-08-18T00:00:00Z"}', NOW)).toMatchObject({ state: 'unreadable' });
  });

  it('names the offending line, so the fix is findable', () => {
    const bad = [entry(daysAgo(1)), 'oops', entry(daysAgo(2))].join('\n');
    const r = parseLog(bad);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/line 2/);
  });

  it('a recent run is fresh', () => {
    const f = assess(entry(daysAgo(2)), NOW);
    expect(f.state).toBe('fresh');
    expect(f).toHaveProperty('ageDays');
  });

  it('an old run is stale', () => {
    expect(assess(entry(daysAgo(STALE_AFTER_DAYS + 1)), NOW).state).toBe('stale');
  });

  it('the newest entry decides, whatever order the file is in', () => {
    const outOfOrder = [entry(daysAgo(90)), entry(daysAgo(1)), entry(daysAgo(45))].join('\n');
    expect(assess(outOfOrder, NOW).state).toBe('fresh');
  });

  /**
   * A stamp dated in the future is a wrong clock or a hand-written entry. Reading
   * it as maximally fresh would be this log's worst possible failure: the monitor
   * would go permanently quiet on the strength of a lie.
   */
  it('a future timestamp is unreadable, not maximally fresh', () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    expect(assess(entry(future), NOW)).toMatchObject({ state: 'unreadable' });
  });

  it('a slightly-ahead clock is tolerated rather than treated as sabotage', () => {
    const abitahead = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(assess(entry(abitahead), NOW).state).toBe('fresh');
  });

  it('every state explains itself with something actionable', () => {
    expect(explain(assess(null, NOW))).toMatch(/npm run verify:live/);
    expect(explain(assess('nonsense', NOW))).toMatch(/hand-edited/);
    expect(explain(assess(entry(daysAgo(99)), NOW))).toMatch(/Two honest fixes/);
    expect(explain(assess(entry(daysAgo(1)), NOW))).toMatch(/last ran/);
  });
});

describe('THE DEAD-MAN — the live walks have not gone quiet', () => {
  it(`verify:live has run within ${STALE_AFTER_DAYS} days`, () => {
    const contents = existsSync(VERIFY_LIVE_LOG) ? readFileSync(VERIFY_LIVE_LOG, 'utf8') : null;
    const f = assess(contents, new Date());

    expect(f.state, explain(f)).toBe('fresh');
  });
});
