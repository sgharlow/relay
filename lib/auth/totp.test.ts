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
import { generateTotpCode, validateTotpCode } from './totp';

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
