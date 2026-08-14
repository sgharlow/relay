/**
 * What each guessable code is defended by, and why that is enough.
 *
 * 🔴 WRITTEN DURING THE PRE-RELEASE SECURITY REVIEW, 2026-08-13, because the
 * review found an asymmetry nothing recorded: three of the four guessable codes
 * carry a DB-backed `failed_attempts` budget, and the recovery code does not.
 *
 * That turns out to be FINE, and the reason is entropy rather than an oversight
 * — but it is fine by an accident of one constant, and nothing said so. A
 * recovery code is 10 characters over a 31-character alphabet: 2^49.5, about
 * 820 trillion combinations, roughly 26,000 years at a thousand guesses a
 * second. Shorten it to 6 "for usability" and it becomes 2^29.7 — under a
 * billion, brute-forceable in hours — with no attempt budget anywhere to notice.
 *
 * The in-memory limiter is NOT the defence here. Its own header says so: the
 * counter is per-instance, so a distributed attempt walks past it, and it "must
 * never be the only defence on anything that costs money or grants access."
 *
 * So each code below is pinned to the defence it actually relies on. Lowering a
 * length turns this red and makes the person doing it argue with the reason.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CASE_ID_ALPHABET } from '../release/case-id';
import { RECOVERY_CODE_LENGTH } from './recovery-code';
import { CODE_LENGTH as VERIFIER_CODE_LENGTH } from './verifier-code';
import { RECIPIENT_CODE_LENGTH } from './recipient-code';

const bits = (len: number) => Math.log2(CASE_ID_ALPHABET.length ** len);

describe('the alphabet', () => {
  /*
    31 characters, not 36: the confusable ones are absent so a code can be read
    aloud down a phone line without spelling out "is that a one or an I".
  */
  it('excludes the confusable characters', () => {
    for (const c of ['0', 'O', '1', 'I', 'U']) {
      expect(CASE_ID_ALPHABET.includes(c), `${c} is confusable and must not appear`).toBe(false);
    }
    expect(CASE_ID_ALPHABET.length).toBe(31);
  });
});

describe('codes defended by an attempt budget AND entropy', () => {
  /*
    These two are short enough to type comfortably because they do not have to
    carry the defence alone — each row counts its own failed attempts, so a
    targeted guess against one code is throttled at the database.
  */
  const budgeted: [string, number, string][] = [
    ['verifier', VERIFIER_CODE_LENGTH, 'db/migrations/015_verifier_codes.sql'],
    ['recipient', RECIPIENT_CODE_LENGTH, 'db/migrations/017_recipient_codes.sql'],
  ];

  for (const [name, len, migration] of budgeted) {
    it(`${name}: has a DB-backed failed_attempts column`, () => {
      expect(readFileSync(migration, 'utf8')).toMatch(/failed_attempts\s+INT/i);
    });

    it(`${name}: still carries meaningful entropy (${len} chars)`, () => {
      expect(bits(len)).toBeGreaterThanOrEqual(38);
    });
  }

  it('invitations are budgeted too', () => {
    expect(readFileSync('db/migrations/021_invitation_hardening.sql', 'utf8')).toMatch(
      /failed_attempts/i,
    );
  });
});

describe('the recovery code, which is defended by entropy ALONE', () => {
  /*
    No failed_attempts column exists for recovery_codes, and that is a deliberate
    consequence of the length rather than a gap — but it means the length IS the
    security control, so it gets a floor with the arithmetic attached.

    2^45 is the floor, not 2^49.5, so the constant has room to move for a real
    reason without silently crossing into brute-forceable. At 2^45 a thousand
    guesses a second is still ~1,100 years.
  */
  it('carries at least 2^45, because nothing else throttles it', () => {
    const b = bits(RECOVERY_CODE_LENGTH);
    expect(
      b,
      `A recovery code is ${RECOVERY_CODE_LENGTH} characters = 2^${b.toFixed(1)}. There is no ` +
        'failed_attempts budget on recovery_codes, and the in-memory rate limiter is per-instance ' +
        'and explicitly not a security boundary — so this length is the whole defence. Shortening ' +
        'it needs an attempt budget first.',
    ).toBeGreaterThanOrEqual(45);
  });

  /*
    🔴 THIS READ THE RAW FILE AND A COMMENT SET IT OFF, 2026-08-13. A note added
    to recovery-code.ts explaining that it has NO failed_attempts budget matched
    a grep for `failed_attempts` and failed the test — the guard concluded the
    budget existed from a sentence saying it does not.

    Comments are stripped now, which is what api-reachability.ts already
    established one layer over: a comment must never vouch for anything. And the
    match is narrowed to the column actually appearing in SQL, because that —
    not the phrase — is what a budget is.

    ⚠️ NOT RELAXED BY lib/ops/guess-watch.ts. That records a global, in-memory
    count of guesses that matched no row, and it refuses nothing, blocks nobody
    and gates no redemption. It is a signal, not a budget, so the floor below is
    still the whole defence and its justification is untouched.
  */
  it('and the absence of a budget is still true — if that changes, relax the floor', () => {
    const src = readFileSync('lib/auth/recovery-code.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(
      /failed_attempts\s*(=|\+|,|\)|FROM|SELECT|INT)/i.test(src),
      'recovery-code.ts now tracks failed attempts in SQL. Good — but this test still ' +
        'asserts an entropy floor justified by their ABSENCE. Re-read the reasoning above ' +
        'and adjust.',
    ).toBe(false);
  });

  /*
    A guess must also be scoped to an account. If redemption matched on the code
    hash alone, a single lucky guess would open whichever account happened to
    hold it, and the search space would be every code in the system at once
    rather than one account's ten.
  */
  it('redemption is scoped to an email, not to the code alone', () => {
    const src = readFileSync('lib/auth/recovery-code.ts', 'utf8');
    expect(src).toMatch(/code_hash\s*=\s*\$1/);
    expect(src).toMatch(/lower\(u\.email\)\s*=\s*lower\(\$2\)/);
  });

  it('a spent code cannot be replayed', () => {
    expect(readFileSync('lib/auth/recovery-code.ts', 'utf8')).toMatch(/used_at IS NULL/);
  });
});
