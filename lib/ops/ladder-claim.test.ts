/**
 * The ladder guard is proven by planting each violation, not by passing once.
 *
 * A guard asserted only against the happy path is a guard that has never been
 * shown to fail, and this repo has been bitten by exactly that: a check whose
 * planted violation passed because the phrase it looked for appeared inside a
 * longer word. So every rule in `assessLadderClaim` gets a case here that
 * deliberately breaks it, and asserts both that the verdict turns red AND that
 * the message names the thing that is wrong — a red verdict with an unhelpful
 * message is a guard that costs more than it saves.
 *
 * The last two tests read the REAL `PROJECT.yaml`. Those are the ones that
 * actually bind; everything above them proves they mean something.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  assessLadderClaim,
  RUNGS,
  SCOPE_REQUIRED_AFTER_DAYS,
  type LadderClaim,
} from './ladder-claim';

const TODAY = new Date('2026-08-20T00:00:00Z');

/** A claim with everything right, which each test below then breaks in one way. */
function goodClaim(): LadderClaim {
  return {
    ladder: 'dogfooded',
    ladder_evidence: {
      as_of: '2026-08-10',
      basis: 'all ten journeys walked against production as a new self-serve account',
      record: 'docs/user-journeys.md',
    },
  };
}

const alwaysExists = () => true;

function assess(claim: LadderClaim, recordExists = alwaysExists) {
  return assessLadderClaim(claim, { today: TODAY, recordExists });
}

describe('the control: a well-formed claim passes', () => {
  it('is ok, so every red below is caused by the plant and not by the fixture', () => {
    const v = assess(goodClaim());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.ageDays).toBe(10);
  });
});

describe('the rung itself', () => {
  it('rejects a missing ladder', () => {
    const c = goodClaim();
    delete c.ladder;
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('no `ladder:` value');
  });

  it('rejects a rung that is not on the ladder', () => {
    const c = goodClaim();
    c.ladder = 'production-ready';
    const v = assess(c);
    expect(v.ok).toBe(false);
    // The message must list the real rungs, or the reader cannot fix it.
    expect(v.problems.join('\n')).toContain('revenue-proven');
  });

  it('rejects a near-miss rung, which is the realistic typo', () => {
    const c = goodClaim();
    c.ladder = 'dogfood';
    expect(assess(c).ok).toBe(false);
  });

  it('accepts every rung it claims to know', () => {
    for (const rung of RUNGS) {
      const c = goodClaim();
      c.ladder = rung;
      expect(assess(c).ok, `${rung} should be a valid rung`).toBe(true);
    }
  });
});

describe('the evidence block', () => {
  it('rejects a claim with no evidence at all', () => {
    const c = goodClaim();
    delete c.ladder_evidence;
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('no `ladder_evidence:` block');
    expect(v.ageDays).toBeNull();
  });

  it('rejects evidence that is not a mapping', () => {
    const c = goodClaim();
    c.ladder_evidence = 'we dogfooded it, trust me';
    expect(assess(c).ok).toBe(false);
  });

  it('rejects a missing as_of', () => {
    const c = goodClaim();
    delete (c.ladder_evidence as Record<string, unknown>).as_of;
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('as_of');
  });

  it('rejects an as_of that is not a real date', () => {
    const c = goodClaim();
    (c.ladder_evidence as Record<string, unknown>).as_of = 'June 2026';
    expect(assess(c).ok).toBe(false);
  });

  it('rejects a date-shaped string that is not a real day', () => {
    // 2026-02-31 parses in JS and silently becomes March; the round-trip catches it.
    const c = goodClaim();
    (c.ladder_evidence as Record<string, unknown>).as_of = '2026-02-31';
    expect(assess(c).ok).toBe(false);
  });

  it('rejects a missing basis', () => {
    const c = goodClaim();
    delete (c.ladder_evidence as Record<string, unknown>).basis;
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('basis');
  });

  it('rejects a missing record', () => {
    const c = goodClaim();
    delete (c.ladder_evidence as Record<string, unknown>).record;
    expect(assess(c).ok).toBe(false);
  });

  it('rejects a record naming a file that does not exist', () => {
    const v = assess(goodClaim(), () => false);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('does not exist');
  });
});

describe('the clock', () => {
  it('rejects evidence dated in the future', () => {
    const c = goodClaim();
    (c.ladder_evidence as Record<string, unknown>).as_of = '2026-09-01';
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('in the future');
    expect(v.ageDays).toBe(-12);
  });

  it('requires a scope once the demonstration has aged past the threshold', () => {
    const c = goodClaim();
    (c.ladder_evidence as Record<string, unknown>).as_of = '2026-06-27';
    const v = assess(c);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toContain('scope');
    // The message has to offer the two honest ways out, or it reads as "delete the test".
    expect(v.problems.join('\n')).toContain('Re-demonstrate');
  });

  it('accepts an aged demonstration once the scope is written', () => {
    const c = goodClaim();
    const ev = c.ladder_evidence as Record<string, unknown>;
    ev.as_of = '2026-06-27';
    ev.scope = 'historical: describes the 2026-06-27 dogfood, not the system as it stands today';
    expect(assess(c).ok).toBe(true);
  });

  it('does not require a scope while the demonstration is still fresh', () => {
    const c = goodClaim();
    (c.ladder_evidence as Record<string, unknown>).as_of = '2026-08-19';
    expect(assess(c).ok).toBe(true);
  });

  it('fires exactly one day after the threshold, not on it', () => {
    const onTheLine = goodClaim();
    const past = goodClaim();
    const asOfDaysAgo = (n: number) =>
      new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);

    (onTheLine.ladder_evidence as Record<string, unknown>).as_of =
      asOfDaysAgo(SCOPE_REQUIRED_AFTER_DAYS);
    (past.ladder_evidence as Record<string, unknown>).as_of =
      asOfDaysAgo(SCOPE_REQUIRED_AFTER_DAYS + 1);

    expect(assess(onTheLine).ok, 'exactly at the threshold is still fine').toBe(true);
    expect(assess(past).ok, 'one day past it is not').toBe(false);
  });
});

describe('the real PROJECT.yaml', () => {
  const RAW = readFileSync(join(process.cwd(), 'PROJECT.yaml'), 'utf8');

  it('still declares a ladder in a shape this guard can read', () => {
    /*
      The blind-guard check. If PROJECT.yaml stops carrying these keys — renamed,
      restructured, moved into a sub-mapping — every assertion below would pass
      vacuously on `undefined`, and this file would go on reporting green about a
      claim it can no longer see.
    */
    const doc = parse(RAW) as Record<string, unknown>;
    expect(doc, 'PROJECT.yaml lost its `ladder:` key').toHaveProperty('ladder');
    expect(
      doc,
      'PROJECT.yaml lost its `ladder_evidence:` block — the thing that makes the rung checkable',
    ).toHaveProperty('ladder_evidence');
  });

  it('makes a claim that carries its own evidence, judged against the real clock', () => {
    const doc = parse(RAW) as LadderClaim;
    const verdict = assessLadderClaim(doc, {
      // The real clock on purpose: this check tracks actual time, and is meant to
      // go red one day with no code change if the claim is left un-re-read.
      today: new Date(),
      recordExists: (p) => existsSync(join(process.cwd(), p)),
    });

    expect(
      verdict.problems,
      verdict.problems.length
        ? 'The claim this project makes about itself does not hold up:\n\n' +
          verdict.problems.map((p) => `  - ${p}`).join('\n\n')
        : 'ok',
    ).toEqual([]);
  });
});
