/**
 * The 1-of-4 fact, re-measured — and tied to the sentence customers read.
 *
 * See `lib/ops/paywall-scope.ts` for why this exists. In short: the claim that
 * `assertCanRelease` guards exactly one of the four ARMED → PENDING paths decides
 * E4.1 (ruled), E4.2 (the 2026-10-01 paywall flip) and what `/terms` promises a
 * paying owner — and until 2026-08-30 it was prose in seven places and measured
 * by nothing.
 *
 * ⚠️ WHAT THIS CANNOT DO, said so its green is not read as wider than it is: it
 * cannot tell whether the ruling is RIGHT. That was Steve's, and this only holds
 * the repository to it.
 *
 * Feature: relay-h0-mvp
 * Requirements: E4.1, E4.2, E4.3
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import {
  RELEASE_ENTRY_POINTS,
  NOT_A_RELEASE_PATH,
  CHANGESET_ARTEFACTS,
  hasArmedToPending,
  callsAssertCanRelease,
  parseTermsClaim,
} from './paywall-scope';

const read = (f: string): string => readFileSync(f, 'utf8');

/** Every production module under lib/release — the only place a release begins. */
const releaseModules = readdirSync('lib/release')
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => `lib/release/${f}`);

/** Derived, not declared: which of them actually transition ARMED → PENDING. */
const transitions = releaseModules.filter((f) => hasArmedToPending(read(f)));

describe('the paywall guards exactly the release paths it is recorded as guarding', () => {
  it('finds transitions at all, so this guard is not vacuous', () => {
    expect(
      transitions.length,
      'no ARMED -> PENDING transition found in lib/release. Either the call was respelled ' +
        '(fix the pattern in paywall-scope.ts) or the release path moved — and this check has ' +
        'been passing on zero, which is worse than failing.',
    ).toBeGreaterThan(0);
  });

  it('every ARMED -> PENDING site is a declared release path, or is excluded with a reason', () => {
    const declared = new Set(RELEASE_ENTRY_POINTS.map((p) => p.file));
    const undeclared = transitions.filter((f) => !declared.has(f) && !(f in NOT_A_RELEASE_PATH));

    expect(
      undeclared,
      undeclared.length
        ? 'A new way to open a release exists and nothing has ruled on whether it is ' +
            'billing-gated:\n' +
            undeclared.map((f) => `  ${f}`).join('\n') +
            '\n\nAdd it to RELEASE_ENTRY_POINTS with `billingGated` and the reasoning, or to ' +
            'NOT_A_RELEASE_PATH with an argued reason. Do not do either without knowing which — ' +
            'E4.2 is decided on this count, and `/terms` states it to customers.'
        : 'ok',
    ).toEqual([]);
  });

  it('every declared release path still exists and still transitions', () => {
    // The other direction: a declared path that has gone means the ruling now
    // covers something that is not there, and the count on /terms is wrong.
    for (const p of RELEASE_ENTRY_POINTS) {
      expect(existsSync(p.file), `${p.file} is declared a release path and does not exist`).toBe(
        true,
      );
      expect(
        hasArmedToPending(read(p.file)),
        `${p.file} is declared a release path (fired by ${p.firedBy}) but no longer holds an ` +
          'ARMED -> PENDING transition. If the path was retired, remove it here and correct ' +
          'the count on /terms in the same commit.',
      ).toBe(true);
    }
  });

  it('exactly the declared paths are billing-gated, and no others', () => {
    /*
      🔴 THE ASSERTION THE WHOLE FILE IS FOR. Not "one is gated" — WHICH one.
      A future change that gated the missed-check-in sweep instead of Initiate
      would keep the count at 1 and invert the ruling entirely.
    */
    const actual = RELEASE_ENTRY_POINTS.filter((p) => callsAssertCanRelease(read(p.file))).map(
      (p) => p.file,
    );
    const expected = RELEASE_ENTRY_POINTS.filter((p) => p.billingGated).map((p) => p.file);

    expect(
      actual,
      'The set of billing-gated release paths has changed.\n' +
        `  recorded: ${expected.join(', ') || '(none)'}\n` +
        `  measured: ${actual.join(', ') || '(none)'}\n\n` +
        'E4.1 was ruled on 2026-08-30: Initiate only. A path that is NOT the owner deliberately ' +
        'pressing a button is a path the owner may be unable to take, and gating it means a ' +
        'lapsed card silently blocks a release for someone who has gone quiet. If this change ' +
        'is intended, it is a re-ruling — update RELEASE_ENTRY_POINTS, /terms and guide §2.7 in ' +
        'the same commit.',
    ).toEqual(expected);
  });

  it('an import of assertCanRelease is not mistaken for a call', () => {
    // The cheapest wrong way to satisfy the check above.
    expect(callsAssertCanRelease("import { assertCanRelease } from '../billing/entitlements';")).toBe(
      false,
    );
    expect(callsAssertCanRelease('await assertCanRelease(ownerId);')).toBe(true);
    expect(callsAssertCanRelease('assertCanRelease(ownerId)')).toBe(true);
  });

  it('/terms tells a customer the same numbers the code measures', () => {
    /*
      🔴 THE HALF THAT REACHES A PERSON. `/terms` says a lapsed subscription
      "does not switch off the part that matters" and states the count. If the
      code changes and the page does not, the page becomes a false promise to a
      paying owner — and nobody reads a terms page twice.

      Same idiom as `beta-flag.test.ts`, which ties the flag to the user guide.
    */
    const claim = parseTermsClaim(read('src/app/terms/page.tsx'));
    expect(
      claim,
      '/terms no longer states how many release paths the paywall guards. It was added there ' +
        'on 2026-08-30 by the E4.1 ruling precisely because silence on this is the expensive ' +
        'kind. If the wording moved, point this parser at the new sentence — do not delete ' +
        'the check.',
    ).toBeTruthy();

    expect(claim!.total, '/terms names a different number of release paths than lib/release has').toBe(
      RELEASE_ENTRY_POINTS.length,
    );
    expect(
      claim!.guarded,
      '/terms tells customers a different number of paths are billing-gated than the code gates',
    ).toBe(RELEASE_ENTRY_POINTS.filter((p) => p.billingGated).length);
  });

  it('the number-word parser is not the thing that is broken', () => {
    // A parser returning null on everything would make the test above vacuous.
    expect(parseTermsClaim('guards exactly ONE of the four ARMED -> PENDING paths')).toEqual({
      guarded: 1,
      total: 4,
    });
    expect(parseTermsClaim('guards exactly TWO of the four ARMED -> PENDING')).toEqual({
      guarded: 2,
      total: 4,
    });
    expect(parseTermsClaim('nothing of the sort')).toBeNull();
  });

  it('every exclusion argues for itself', () => {
    // The ~40-character bar every allowlist in lib/ops uses.
    for (const [file, reason] of Object.entries(NOT_A_RELEASE_PATH)) {
      expect(reason.length, `${file}: the exclusion reason is too short to be a reason`).toBeGreaterThan(
        40,
      );
    }
  });

  it('the pre-written flip change-set still describes this repository', () => {
    /*
      E4.3 is a commit that will be made in October against a document written in
      August. A change-set naming files that have since moved is worse than no
      change-set: it is a checklist that reads as complete while missing a step.
    */
    expect(existsSync('docs/paywall-flip-changeset.md')).toBe(true);
    const missing = CHANGESET_ARTEFACTS.filter((f) => !existsSync(f));
    expect(
      missing,
      missing.length
        ? 'docs/paywall-flip-changeset.md names files that no longer exist:\n' +
            missing.map((f) => `  ${f}`).join('\n') +
            '\n\nThe flip is a one-commit change-set executed months after it was written. ' +
            'Correct the document now, while the move is still remembered.'
        : 'ok',
    ).toEqual([]);
  });

  it('the skipped test the flip un-skips is still there to un-skip', () => {
    // The change-set's step 2 is "remove `.skip`". If the test were deleted, the
    // flip would ship with nothing asserting that free tier cannot release.
    const src = read('lib/billing/entitlements.test.ts');
    expect(
      /it\.skip\(\s*['"]blocks release on free/.test(src),
      'lib/billing/entitlements.test.ts no longer holds the skipped `blocks release on free` ' +
        'test. That test IS the paywall assertion — the flip commit un-skips it. If it was ' +
        'removed, the flip would turn enforcement on with nothing proving it works.',
    ).toBe(true);
  });
});
