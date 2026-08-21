/**
 * One authoritative statement of J7-R1, and code that cites the current one.
 *
 * 🔴 FOUR LOAD-BEARING FILES CARRIED THE SUPERSEDED RULE AS THEIR RATIONALE
 * until 2026-08-21. J7-R1's FIRST amendment (2026-08-12) said a verifier who
 * never enrolled shall still decide via a single-use code. The SECOND
 * amendment, the same day, withdrew exactly that sentence: once §4.3 tightened
 * quorum to `confirmed`, a code mailed to an unconfirmed verifier bought a vote
 * with no effect — full credential risk, zero function.
 * `lib/notify/verifier-notice-class.ts` shipped the decision and mints
 * `not_counted` for them.
 *
 * VerifyClient.tsx was corrected on the day. `lib/release/quorum.ts` and
 * `src/app/api/verify/route.ts` were not, and quorum.ts is the module that
 * DEFINES eligibility — a reader of it would have concluded unconfirmed
 * verifiers are still mailed live codes and must be able to answer, which is
 * the opposite of the shipped classifier.
 *
 * This is the portfolio's one-authoritative-definition rule applied to a
 * requirement rather than to a column: the amendment lives in the journeys doc,
 * and no file may restate the version it replaced.
 *
 * Feature: relay-standby
 * Requirements: J7-R1 (second amendment)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Files whose comments explain themselves by citing J7-R1.
 *
 * 🔴 THE LIST USED TO CLAIM MORE THAN IT DELIVERED. Its comment read "it is
 * every place the withdrawn sentence was actually found", and the sprint report
 * said the guard "forbids the withdrawn wording standing unqualified across ALL
 * FOUR citing files". Replaying the WITHDRAWN patterns against the pre-fix
 * commit (5acb026) gives quorum.ts 2 matches, api/verify/route.ts 1, and
 * triggers.ts 0, VerifyClient.tsx 0 — so on two of the four the negative half
 * forbade nothing and passed vacuously. triggers.ts cited J7-R1 twice, which is
 * what the report saw, but it never restated the withdrawn PROMISE; it said
 * "anyone named may render a decision", which is loose rather than superseded.
 *
 * The list is right and the claim about it was not. The positive half below now
 * binds every file in it, so no entry can pass by saying nothing.
 */
const CITING_FILES = [
  'lib/release/quorum.ts',
  'lib/release/triggers.ts',
  'src/app/api/verify/route.ts',
  'src/app/(verify)/verify/VerifyClient.tsx',
];

/**
 * The withdrawn promise, in the shapes it was written in. Matched across line
 * breaks and collapsed whitespace, because these are wrapped block comments and
 * a reflow must not silently disarm the guard.
 */
const WITHDRAWN = [
  /never enrolled[^.]{0,80}single-use code/i,
  /who never claimed[^.]{0,60}decides via a single-use code/i,
  /FALLBACK IS NOT RETIRED, AND WILL NOT BE/i,
];

/** The words that mark a quotation of the old rule rather than a claim of it. */
const DISCLAIMER = /withdrew|withdrawn|second amendment|superseded|used to say|no longer/i;

/**
 * The rule currently in force, in each of the phrasings the four files use.
 *
 * ⚠️ `not_counted` alone is DELIBERATELY NOT IN HERE. It is an identifier that
 * appears in these files for ordinary reasons — a union member, a status string,
 * an audit action — so accepting it would let a file satisfy the positive half
 * without saying anything, which is the failure this half exists to catch.
 * Measured: with `not_counted` accepted, all four files pass at the pre-fix
 * commit 5acb026; without it, quorum.ts and triggers.ts both fail there, which
 * is the correct answer, and VerifyClient.tsx passes, which is also correct —
 * it was the one file corrected on the day.
 */
const SURVIVING =
  /no enrolment step at decision time|nobody (has to |ever )?ENROL|nobody enrols|second amendment|verifier-notice-class|quorum counts only confirmed/i;

/**
 * How much text either side of a match counts as "the same passage". Wide
 * enough to hold the sentence that introduces a quotation and the one that
 * explains it; far narrower than a file.
 */
const WINDOW = 400;

/**
 * Returns the offending passage if `src` states the withdrawn rule as its own
 * claim, or `null` if every occurrence is disclaimed in the same passage.
 *
 * 🔴 THE EXCULPATION USED TO BE FILE-SCOPED, and that made the guard
 * unfailable. The rule was: a WITHDRAWN match is only a failure if the file
 * does not ALSO match the disclaimer ANYWHERE. Correcting the four files put
 * the word "withdrawn" permanently into all four, so from that commit onward
 * every one of them was exculpated in advance — somebody could reintroduce the
 * promise verbatim, in any of the files this guard names, and it would pass.
 * "The guard that fails if somebody reintroduces the pattern" was exactly what
 * did not ship.
 *
 * Scoping the exculpation to the match's own neighbourhood keeps the house
 * convention — the history of an error stays in place, quoted — while making
 * the guard fail on a fresh unqualified claim in a file whose history section
 * sits a screen away. Pure, so it is proven against planted text below rather
 * than only against whatever the repo happens to contain today.
 */
export function restatesWithdrawnRule(src: string): string | null {
  const flat = src.replace(/\s+/g, ' ');
  for (const pattern of WITHDRAWN) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    for (const m of flat.matchAll(global)) {
      const at = m.index ?? 0;
      const passage = flat.slice(Math.max(0, at - WINDOW), at + m[0].length + WINDOW);
      if (!DISCLAIMER.test(passage)) return passage;
    }
  }
  return null;
}

const read = (file: string) => readFileSync(file, 'utf8');

describe('no file restates the withdrawn J7-R1 guarantee', () => {
  for (const file of CITING_FILES) {
    it(`${file} does not promise an unenrolled verifier a working code`, () => {
      expect(
        restatesWithdrawnRule(read(file)),
        `${file} restates the withdrawn rule without recording, in the same passage, that it was withdrawn`,
      ).toBeNull();
    });

    /*
      The positive half, and it now binds EVERY file rather than quorum.ts
      alone. A guard that only forbids wording passes on a file that says
      nothing at all, and "says nothing" is how these drifted in the first
      place — the rule they depended on changed and they simply kept their old
      reason. A file that cites J7-R1 must cite the version currently in force.
    */
    it(`${file} cites the surviving guarantee, not a bare J7-R1`, () => {
      const flat = read(file).replace(/\s+/g, ' ');
      expect(flat).toMatch(/J7-R1/);
      expect(flat).toMatch(SURVIVING);
    });
  }

  /*
    quorum.ts DEFINES eligibility, so it carries the full statement rather than
    a pointer to one.
  */
  it('quorum.ts states the surviving guarantee in full', () => {
    const flat = read('lib/release/quorum.ts').replace(/\s+/g, ' ');
    expect(flat).toMatch(/no enrolment step at decision time/i);
    expect(flat).toMatch(/not_counted|verifier-notice-class/);
  });
});

/*
  Proven to fail on a planted violation, per the house rule in CLAUDE.md — three
  checks in this repo have passed on the very defect they were written for, and
  this one had already joined them. Planted text, not a planted file, so the
  proof runs on every suite rather than on the day somebody remembers.
*/
describe('the guard can actually fail', () => {
  const OFFENCE =
    'A verifier who never enrolled shall still decide via a single-use code, permanently.';

  it('catches the withdrawn promise standing on its own', () => {
    expect(restatesWithdrawnRule(OFFENCE)).not.toBeNull();
  });

  it('allows the promise QUOTED in the passage that withdraws it', () => {
    expect(
      restatesWithdrawnRule(`This used to say: "${OFFENCE}" The second amendment withdrew it.`),
    ).toBeNull();
  });

  /*
    THE REGRESSION THIS FILE EXISTS TO PREVENT, and the one the shipped guard
    could not see. A file that explains the history at the top and then makes
    the withdrawn claim again 2,000 characters lower must FAIL. Under the
    file-scoped exculpation it passed, because the word "withdrawn" appeared
    somewhere in the file.
  */
  it('catches a fresh claim in a file whose history section is far above it', () => {
    const src = `The first amendment was withdrawn on 2026-08-12.${' filler.'.repeat(300)}${OFFENCE}`;
    expect(restatesWithdrawnRule(src)).not.toBeNull();
  });

  it('says nothing about a file that never mentions the rule', () => {
    expect(restatesWithdrawnRule('export const x = 1;')).toBeNull();
  });
});
