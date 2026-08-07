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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateTotpCode,
  validateTotpCode,
  generateTotpSecret,
  generateTotpCodeFor,
  validateTotpCodeFor,
} from './totp';

// ---------------------------------------------------------------------------
// Setup — inject a known TOTP_SECRET for deterministic tests
// ---------------------------------------------------------------------------

// A well-known test secret used in RFC 4226 test vectors (base32 of "12345678901234567890")
const TEST_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

beforeEach(() => {
  process.env.TOTP_SECRET = TEST_SECRET_BASE32;
});

afterEach(() => {
  delete process.env.TOTP_SECRET;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTotpCode', () => {
  it('returns a 6-digit string', () => {
    const code = generateTotpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('is deterministic for the same time window', () => {
    const t = 1_700_000_015_000; // ms — mid-step
    const a = generateTotpCode(t);
    const b = generateTotpCode(t);
    expect(a).toBe(b);
  });

  it('produces different codes for different time steps', () => {
    const step1 = 1_700_000_000_000; // step boundary
    const step2 = step1 + 30_000;    // next step
    const c1 = generateTotpCode(step1);
    const c2 = generateTotpCode(step2);
    // Different steps should (almost always) produce different codes.
    // In the astronomically rare collision case this test would flake —
    // acceptable for a unit test.
    expect(c1).not.toBe(c2);
  });
});

describe('validateTotpCode', () => {
  it('accepts the code generated for the current step', () => {
    const now = Date.now();
    const code = generateTotpCode(now);
    expect(validateTotpCode(code, now)).toBe(true);
  });

  it('accepts a code from one step in the past (clock skew tolerance)', () => {
    const now = Date.now();
    const oneStepAgo = now - 30_000;
    const oldCode = generateTotpCode(oneStepAgo);
    expect(validateTotpCode(oldCode, now)).toBe(true);
  });

  it('accepts a code from one step in the future (clock skew tolerance)', () => {
    const now = Date.now();
    const oneStepAhead = now + 30_000;
    const futureCode = generateTotpCode(oneStepAhead);
    expect(validateTotpCode(futureCode, now)).toBe(true);
  });

  it('rejects a code from two steps in the past', () => {
    const now = Date.now();
    const twoStepsAgo = now - 60_000;
    const staleCode = generateTotpCode(twoStepsAgo);
    // The current step window is ±1, so 2 steps ago should be rejected.
    expect(validateTotpCode(staleCode, now)).toBe(false);
  });

  it('rejects a wrong 6-digit code', () => {
    const now = Date.now();
    const validCode = generateTotpCode(now);
    // Increment the last digit by 1 (mod 10) to get an invalid code
    const wrongCode = validCode
      .split('')
      .map((d, i) =>
        i === 5 ? String((Number(d) + 1) % 10) : d,
      )
      .join('');
    // Only test if the manipulation actually produced a different code
    if (wrongCode !== validCode) {
      expect(validateTotpCode(wrongCode, now)).toBe(false);
    }
  });

  it('rejects codes with non-digit characters', () => {
    expect(validateTotpCode('12345a', Date.now())).toBe(false);
    expect(validateTotpCode('      ', Date.now())).toBe(false);
    expect(validateTotpCode('', Date.now())).toBe(false);
  });

  it('rejects codes that are not exactly 6 digits', () => {
    expect(validateTotpCode('12345', Date.now())).toBe(false);
    expect(validateTotpCode('1234567', Date.now())).toBe(false);
  });

  it('rejects when TOTP_SECRET is missing', () => {
    delete process.env.TOTP_SECRET;
    expect(() => validateTotpCode('123456', Date.now())).toThrow(
      'TOTP_SECRET environment variable is not set',
    );
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

  it('SECURITY: the env secret does not validate a per-user code', () => {
    const userSecret = generateTotpSecret();
    const userCode = generateTotpCodeFor(userSecret, at);
    // TOTP_SECRET is set to TEST_SECRET_BASE32 by the beforeEach above.
    expect(validateTotpCode(userCode, at)).toBe(false);
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

describe('backward compatibility with the env secret', () => {
  const at = 1_760_000_000_000;

  it('generateTotpCode still delegates to TOTP_SECRET', () => {
    expect(generateTotpCode(at)).toBe(generateTotpCodeFor(TEST_SECRET_BASE32, at));
  });

  it('validateTotpCode still validates against TOTP_SECRET', () => {
    expect(validateTotpCode(generateTotpCode(at), at)).toBe(true);
  });

  it('generateTotpCode still throws when TOTP_SECRET is unset', () => {
    delete process.env.TOTP_SECRET;
    expect(() => generateTotpCode(at)).toThrow(/TOTP_SECRET/);
  });
});
