/**
 * One authoritative statement of J7-R1, and code that cites the current one.
 *
 * 🔴 FOUR LOAD-BEARING FILES CARRIED THE SUPERSEDED RULE AS THEIR RATIONALE
 * until 2026-08-21. J7-R1's FIRST amendment (2026-08-12) said a verifier who
 * never enrolled shall still decide via a single-use code. The SECOND
 * amendment, the same day (docs/user-journeys.md:1386-1402), withdrew exactly
 * that sentence: once §4.3 tightened quorum to `confirmed`, a code mailed to an
 * unconfirmed verifier bought a vote with no effect — full credential risk,
 * zero function. `lib/notify/verifier-notice-class.ts` shipped the decision and
 * mints `not_counted` for them.
 *
 * VerifyClient.tsx was corrected on the day. `lib/release/quorum.ts`,
 * `lib/release/triggers.ts` (twice) and `src/app/api/verify/route.ts` were not,
 * and quorum.ts is the module that DEFINES eligibility — a reader of it would
 * have concluded unconfirmed verifiers are still mailed live codes and must be
 * able to answer, which is the opposite of the shipped classifier.
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
 * Files whose comments explain themselves by citing J7-R1. The list is the
 * point: it is every place the withdrawn sentence was actually found.
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

const flat = (file: string) => readFileSync(file, 'utf8').replace(/\s+/g, ' ');

describe('no file restates the withdrawn J7-R1 guarantee', () => {
  for (const file of CITING_FILES) {
    it(`${file} does not promise an unenrolled verifier a working code`, () => {
      const src = flat(file);
      for (const pattern of WITHDRAWN) {
        /*
          Each of these files now QUOTES the old sentence in order to explain
          why it is gone, which is the house convention — the history of an
          error stays in place. So the quotation is allowed and the assertion
          is about the claim standing unqualified: a match is only a failure if
          the file does not also say it was withdrawn.
        */
        if (pattern.test(src)) {
          expect(src, `${file} restates the withdrawn rule without recording that it was withdrawn`)
            .toMatch(/withdrew|withdrawn|second amendment|superseded|used to say|USED TO SAY/i);
        }
      }
    });
  }

  /*
    The positive half. A guard that only forbids wording passes on a file that
    says nothing at all, and "says nothing" is how the four drifted in the first
    place — the rule they depended on changed and they simply kept their old
    reason. quorum.ts is the module that defines eligibility, so it is the one
    that must carry the current statement.
  */
  it('quorum.ts states the surviving guarantee, not the withdrawn one', () => {
    const src = flat('lib/release/quorum.ts');
    expect(src).toMatch(/no enrolment step at decision time/i);
    expect(src).toMatch(/not_counted|verifier-notice-class/);
  });
});
