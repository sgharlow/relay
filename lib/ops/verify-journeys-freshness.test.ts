/**
 * The dead-man for the SECOND chain — the one that shipped without one.
 *
 * ⚠️ THIS TEST IS DESIGNED TO GO RED WITH NO CODE CHANGE, on a date, exactly as
 * `verify-live-freshness.test.ts` and `gates.test.ts` are. When it fires it is
 * reporting that the three journey walks have stopped running, which is a finding
 * about this project rather than a bug in the suite. `explainJourneys()` prints
 * the honest fixes.
 *
 * THE FINDING THIS ENCODES (B14). D10 was closed on 2026-08-21 by BUILDING
 * `npm run verify:journeys`. `verify:live` had been given a stamp-and-dead-man on
 * 2026-08-19 — two days earlier, in this same directory, for this same reason —
 * and the new chain did not inherit it. So the repo held two chains of live
 * walks, one of which could go quiet without producing a single failure. A gap
 * closed by construction is closed until the thing constructed stops running.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half); B14
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import {
  VERIFY_JOURNEYS_LOG,
  JOURNEYS_STALE_AFTER_DAYS,
  assessJourneys,
  explainJourneys,
} from './verify-journeys-freshness';
import { STALE_AFTER_DAYS } from './verify-live-freshness';

const NOW = new Date('2026-08-29T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const entry = (at: string, commit = 'abc1234') =>
  JSON.stringify({
    at,
    commit,
    branch: 'master',
    walks: ['delegate (J3)', 'request (J6)', 'standdown (J9)'],
  });

describe('the journeys log is read by the same rules as the live one', () => {
  /*
    These four re-assert the shared contract THROUGH this chain's entry point.
    They are not duplicates of the live tests: they are what proves the reuse is
    real, so that a future edit which quietly gives this chain its own copy of
    `assess` fails here rather than drifting.
  */
  it('an empty or missing log is `never`, and says so distinctly', () => {
    expect(assessJourneys(null, NOW).state).toBe('never');
    expect(assessJourneys('', NOW).state).toBe('never');
  });

  it('a corrupt log is `unreadable`, never `never`', () => {
    expect(assessJourneys('not json at all', NOW)).toMatchObject({ state: 'unreadable' });
    expect(assessJourneys('{"commit":"abc"}', NOW)).toMatchObject({ state: 'unreadable' });
  });

  it('a future timestamp is unreadable, not maximally fresh', () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    expect(assessJourneys(entry(future), NOW)).toMatchObject({ state: 'unreadable' });
  });

  it('the newest entry decides, whatever order the file is in', () => {
    const outOfOrder = [entry(daysAgo(90)), entry(daysAgo(1)), entry(daysAgo(45))].join('\n');
    expect(assessJourneys(outOfOrder, NOW).state).toBe('fresh');
  });
});

describe('this chain holds its OWN threshold', () => {
  /*
    The whole point of a separate module. If someone later collapses the two
    chains onto one number, this fails and asks them to say why — the signup
    ceiling that forces the chains an hour apart has not gone away.
  */
  it('is longer than verify:live, because the two chains cannot share an hour', () => {
    expect(JOURNEYS_STALE_AFTER_DAYS).toBeGreaterThan(STALE_AFTER_DAYS);
  });

  it('is under a month, because two assertions here go red when a defect is fixed', () => {
    expect(JOURNEYS_STALE_AFTER_DAYS).toBeLessThanOrEqual(28);
  });

  it('applies its own threshold rather than the live one', () => {
    // Older than verify:live tolerates, younger than this chain does.
    const between = daysAgo(STALE_AFTER_DAYS + 1);
    expect(assessJourneys(entry(between), NOW).state).toBe('fresh');
    expect(assessJourneys(entry(daysAgo(JOURNEYS_STALE_AFTER_DAYS + 1)), NOW).state).toBe('stale');
  });
});

describe('every state explains itself with something actionable', () => {
  it('names the command, the credential and the hour-apart trap', () => {
    for (const f of [
      assessJourneys(null, NOW),
      assessJourneys(entry(daysAgo(99)), NOW),
    ]) {
      const msg = explainJourneys(f);
      expect(msg).toMatch(/npm run verify:journeys/);
      expect(msg).toMatch(/\.env\.local/);
      expect(msg).toMatch(/HOUR APART/);
    }
  });

  it('warns that a stale chain reports a fixed defect as a live one', () => {
    expect(explainJourneys(assessJourneys(entry(daysAgo(99)), NOW))).toMatch(/approve-before-first-rule/);
  });

  it('a corrupt log is not offered "just run it" as the fix', () => {
    expect(explainJourneys(assessJourneys('nonsense', NOW))).toMatch(/hand-edited/);
  });

  it('a fresh log reports its age', () => {
    expect(explainJourneys(assessJourneys(entry(daysAgo(1)), NOW))).toMatch(/last ran/);
  });
});

describe('THE DEAD-MAN — the journey walks have not gone quiet', () => {
  it(`verify:journeys has run within ${JOURNEYS_STALE_AFTER_DAYS} days`, () => {
    const contents = existsSync(VERIFY_JOURNEYS_LOG) ? readFileSync(VERIFY_JOURNEYS_LOG, 'utf8') : null;
    const f = assessJourneys(contents, new Date());

    expect(f.state, explainJourneys(f)).toBe('fresh');
  });
});
