/**
 * Unit tests for TOTP implementation (lib/auth/totp.ts).
 *
 * Tests the RFC 6238 TOTP validation logic including:
 *  - Valid code acceptance
 *  - Invalid code rejection
 *  - Clock-skew tolerance (±1 step window)
 *  - Format validation (non-6-digit strings rejected)
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  generateTotpSecret,
  generateTotpCodeFor,
  validateTotpCodeFor,
} from './totp';
import * as totp from './totp';

// ---------------------------------------------------------------------------
// Setup — a known secret, passed explicitly
// ---------------------------------------------------------------------------

// A well-known test secret used in RFC 4226 test vectors (base32 of "12345678901234567890")
const TEST_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/*
  These used to run against the shared `process.env.TOTP_SECRET` through
  `generateTotpCode`/`validateTotpCode`. That path was retired on 2026-08-13 —
  it had no production caller and it kept a single environment variable able to
  authenticate any account without its own secret. The assertions are unchanged;
  only where the secret comes from has moved, from ambient state to an argument.
*/

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTotpCode', () => {
  it('returns a 6-digit string', () => {
    const code = generateTotpCodeFor(TEST_SECRET_BASE32);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('is deterministic for the same time window', () => {
    const t = 1_700_000_015_000; // ms — mid-step
    const a = generateTotpCodeFor(TEST_SECRET_BASE32, t);
    const b = generateTotpCodeFor(TEST_SECRET_BASE32, t);
    expect(a).toBe(b);
  });

  it('produces different codes for different time steps', () => {
    const step1 = 1_700_000_000_000; // step boundary
    const step2 = step1 + 30_000;    // next step
    const c1 = generateTotpCodeFor(TEST_SECRET_BASE32, step1);
    const c2 = generateTotpCodeFor(TEST_SECRET_BASE32, step2);
    // Different steps should (almost always) produce different codes.
    // In the astronomically rare collision case this test would flake —
    // acceptable for a unit test.
    expect(c1).not.toBe(c2);
  });
});

describe('validateTotpCode', () => {
  it('accepts the code generated for the current step', () => {
    const now = Date.now();
    const code = generateTotpCodeFor(TEST_SECRET_BASE32, now);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, code, now)).toBe(true);
  });

  it('accepts a code from one step in the past (clock skew tolerance)', () => {
    const now = Date.now();
    const oneStepAgo = now - 30_000;
    const oldCode = generateTotpCodeFor(TEST_SECRET_BASE32, oneStepAgo);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, oldCode, now)).toBe(true);
  });

  it('accepts a code from one step in the future (clock skew tolerance)', () => {
    const now = Date.now();
    const oneStepAhead = now + 30_000;
    const futureCode = generateTotpCodeFor(TEST_SECRET_BASE32, oneStepAhead);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, futureCode, now)).toBe(true);
  });

  it('rejects a code from two steps in the past', () => {
    const now = Date.now();
    const twoStepsAgo = now - 60_000;
    const staleCode = generateTotpCodeFor(TEST_SECRET_BASE32, twoStepsAgo);
    // The current step window is ±1, so 2 steps ago should be rejected.
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, staleCode, now)).toBe(false);
  });

  it('rejects a wrong 6-digit code', () => {
    const now = Date.now();
    const validCode = generateTotpCodeFor(TEST_SECRET_BASE32, now);
    // Increment the last digit by 1 (mod 10) to get an invalid code
    const wrongCode = validCode
      .split('')
      .map((d, i) =>
        i === 5 ? String((Number(d) + 1) % 10) : d,
      )
      .join('');
    // Only test if the manipulation actually produced a different code
    if (wrongCode !== validCode) {
      expect(validateTotpCodeFor(TEST_SECRET_BASE32, wrongCode, now)).toBe(false);
    }
  });

  it('rejects codes with non-digit characters', () => {
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, '12345a', Date.now())).toBe(false);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, '      ', Date.now())).toBe(false);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, '', Date.now())).toBe(false);
  });

  it('rejects codes that are not exactly 6 digits', () => {
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, '12345', Date.now())).toBe(false);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, '1234567', Date.now())).toBe(false);
  });

  /*
    WAS 'rejects when TOTP_SECRET is missing'. There is no longer an environment
    variable to be missing: the shared-secret entry points were removed on
    2026-08-13. What replaces it is the assertion below that they are gone —
    a test naming a retired mechanism is how a retired mechanism comes back.
  */
  it('has no entry point that authenticates without a caller-supplied secret', () => {
    for (const retired of ['generateTotpCode', 'validateTotpCode']) {
      expect(
        Object.keys(totp),
        `${retired} is exported again. It read a single process.env.TOTP_SECRET, ` +
          'which authenticated every account that had no secret of its own — ' +
          'i.e. every standby contact. See lib/auth/resolve-totp-secret.ts.',
      ).not.toContain(retired);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-user secrets (security patch, 2026-08-06)
//
// TOTP was a SINGLE SHARED SECRET read from process.env.TOTP_SECRET, so every
// owner authenticated against the same secret. Latent with one dogfooded owner;
// an account-takeover vulnerability the moment self-serve signup exists.
//
// Requirements: 17.1, J1-R3
// ---------------------------------------------------------------------------

describe('generateTotpSecret', () => {
  it('returns a base32 string of usable length', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
  });

  it('returns a different secret on every call', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });

  it('produces a secret that round-trips through generate/validate', () => {
    const s = generateTotpSecret();
    const at = 1_760_000_000_000;
    expect(validateTotpCodeFor(s, generateTotpCodeFor(s, at), at)).toBe(true);
  });
});

describe('per-user TOTP isolation', () => {
  const at = 1_760_000_000_000;

  it('SECURITY: one user’s code is rejected for another user’s secret', () => {
    const alice = generateTotpSecret();
    const bob = generateTotpSecret();

    const aliceCode = generateTotpCodeFor(alice, at);

    expect(validateTotpCodeFor(alice, aliceCode, at)).toBe(true);
    expect(validateTotpCodeFor(bob, aliceCode, at)).toBe(false);
  });

  it('SECURITY: holds across many independent secret pairs', () => {
    for (let i = 0; i < 25; i++) {
      const a = generateTotpSecret();
      const b = generateTotpSecret();
      expect(validateTotpCodeFor(b, generateTotpCodeFor(a, at), at)).toBe(false);
    }
  });

  it('SECURITY: the formerly-shared secret does not validate a per-user code', () => {
    // TEST_SECRET_BASE32 is the value that used to live in TOTP_SECRET. It is
    // now just another secret, and must have no special power over any account.
    const userSecret = generateTotpSecret();
    const userCode = generateTotpCodeFor(userSecret, at);
    expect(validateTotpCodeFor(TEST_SECRET_BASE32, userCode, at)).toBe(false);
  });

  it('still applies the ±1 step clock-skew tolerance per user', () => {
    const s = generateTotpSecret();
    const code = generateTotpCodeFor(s, at);
    expect(validateTotpCodeFor(s, code, at + 30_000)).toBe(true);
    expect(validateTotpCodeFor(s, code, at - 30_000)).toBe(true);
    expect(validateTotpCodeFor(s, code, at + 120_000)).toBe(false);
  });

  it('rejects malformed codes without consulting the secret', () => {
    const s = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 345']) {
      expect(validateTotpCodeFor(s, bad, at)).toBe(false);
    }
  });

  it('accepts a hex-encoded secret as well as base32', () => {
    const hex = '3132333435363738393031323334353637383930';
    expect(validateTotpCodeFor(hex, generateTotpCodeFor(hex, at), at)).toBe(true);
  });
});

/*
  WAS 'backward compatibility with the env secret' — three tests pinning that
  `generateTotpCode`/`validateTotpCode` still delegated to process.env.
  Compatibility with a retired credential path is not a property worth keeping;
  after the conversion the three assertions had also become tautologies, each
  comparing an expression with itself. Replaced by the one property that
  matters now.
*/
describe('the shared secret is gone from the module, not merely unused', () => {
  it('reads no environment variable at all', () => {
    const src = readFileSync('lib/auth/totp.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(
      src,
      'lib/auth/totp.ts reads process.env. The only secret this module should ' +
        'ever see is one its caller passed in.',
    ).not.toContain('process.env');
  });
});

// ---------------------------------------------------------------------------
// Secret decoding — the shapes that actually reach production
// ---------------------------------------------------------------------------

describe('secret decoding robustness', () => {
  // Every fixture in this file is 16 or 32 base32 characters, i.e. a whole
  // number of bytes. A secret is not obliged to be, and the strict decoder
  // rejected any that was not — so the env-fallback sign-in path threw on
  // production while this suite stayed green.
  const NON_ALIGNED_SECRET = 'BKJ4XQZL7MNRTS2WVA6PQRSTUVWX'; // 28 chars = 140 bits

  it('accepts a base32 secret whose length is not a whole number of bytes', () => {
    const at = 1_700_000_015_000;
    const code = generateTotpCodeFor(NON_ALIGNED_SECRET, at);

    expect(code).toMatch(/^\d{6}$/);
    expect(validateTotpCodeFor(NON_ALIGNED_SECRET, code, at)).toBe(true);
  });

  it('returns false instead of throwing when the secret is below the 128-bit floor', () => {
    // The shape actually deployed as TOTP_SECRET: 20 *characters* of base32,
    // which is 12 bytes — not the 20 *bytes* generateTotpSecret produces, and
    // under otplib's 16-byte minimum. Bytes were confused for characters when
    // the variable was set, and a lenient library accepted it at the time.
    // It must now fail closed, not throw.
    const TOO_SHORT = 'BKJ4XQZL7MNRTS2WVA6P'; // 20 chars = 12 usable bytes

    expect(() => validateTotpCodeFor(TOO_SHORT, '123456')).not.toThrow();
    expect(validateTotpCodeFor(TOO_SHORT, '123456')).toBe(false);
  });

  it('returns false instead of throwing when the secret is unusable', () => {
    // Fail closed. A malformed secret must reject the sign-in, not surface an
    // exception that NextAuth reflects back to the caller as an error string.
    expect(() => validateTotpCodeFor('not valid base32 !!!', '123456')).not.toThrow();
    expect(validateTotpCodeFor('not valid base32 !!!', '123456')).toBe(false);
  });

  it('returns false instead of throwing when the secret is empty', () => {
    expect(validateTotpCodeFor('', '123456')).toBe(false);
  });
});
