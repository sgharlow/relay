/**
 * Adapter-specific tests for the otplib-backed TOTP implementation
 * (lib/auth/totp.ts). ADDITIVE to totp.test.ts — the pre-existing tests are
 * the compatibility harness and are intentionally untouched.
 *
 * Pins wire compatibility of the adapter to the RFC 6238 Appendix B
 * known-answer vectors (SHA-1, secret "12345678901234567890", 30s step,
 * truncated to the 6 low-order digits of the 8-digit reference codes), plus
 * the hex-secret encoding path that the previous hand-rolled implementation
 * supported.
 *
 * Security remediation: docs/security-remediation-plan.md
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateTotpCode, validateTotpCode } from './totp';

// base32("12345678901234567890") — the RFC 4226/6238 reference secret
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
// hex("12345678901234567890") — same key bytes, hex-encoded
const RFC_SECRET_HEX = '3132333435363738393031323334353637383930';

beforeEach(() => {
  process.env.TOTP_SECRET = RFC_SECRET_BASE32;
});

afterEach(() => {
  delete process.env.TOTP_SECRET;
});

describe('totp adapter — RFC 6238 known-answer vectors (SHA-1, 6 digits)', () => {
  // [epoch seconds, 6-digit code] — low-order 6 digits of the RFC's 8-digit codes
  const VECTORS: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it.each(VECTORS)('generates the RFC code at T=%d', (epochSeconds, expected) => {
    expect(generateTotpCode(epochSeconds * 1000)).toBe(expected);
  });

  it.each(VECTORS)('validates the RFC code at T=%d', (epochSeconds, expected) => {
    expect(validateTotpCode(expected, epochSeconds * 1000)).toBe(true);
  });
});

describe('totp adapter — hex-encoded TOTP_SECRET compatibility', () => {
  it('hex and base32 encodings of the same key produce the same code', () => {
    const atMs = 1_700_000_015_000;

    process.env.TOTP_SECRET = RFC_SECRET_BASE32;
    const fromBase32 = generateTotpCode(atMs);

    process.env.TOTP_SECRET = RFC_SECRET_HEX;
    const fromHex = generateTotpCode(atMs);

    expect(fromHex).toBe(fromBase32);
  });

  it('validates a base32-generated code under the hex form of the secret', () => {
    const atMs = 1_700_000_015_000;

    process.env.TOTP_SECRET = RFC_SECRET_BASE32;
    const code = generateTotpCode(atMs);

    process.env.TOTP_SECRET = RFC_SECRET_HEX;
    expect(validateTotpCode(code, atMs)).toBe(true);
  });
});

describe('totp adapter — skew window is exactly ±1 step (do not widen silently)', () => {
  it('accepts codes exactly one step away in both directions, rejects two', () => {
    const now = 1_700_000_015_000;
    expect(validateTotpCode(generateTotpCode(now - 30_000), now)).toBe(true);
    expect(validateTotpCode(generateTotpCode(now + 30_000), now)).toBe(true);
    expect(validateTotpCode(generateTotpCode(now - 60_000), now)).toBe(false);
    expect(validateTotpCode(generateTotpCode(now + 60_000), now)).toBe(false);
  });

  it('rejects a code from a different secret', () => {
    const now = 1_700_000_015_000;
    const code = generateTotpCode(now);

    // NOTE: otplib enforces a >=16-byte secret guardrail (the hand-rolled
    // implementation accepted any length), so use a full 20-byte secret here.
    process.env.TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJR';
    // Guard against the astronomically unlikely 1-in-10^6 collision across
    // the three-window check by only asserting when codes actually differ.
    if (generateTotpCode(now) !== code) {
      expect(validateTotpCode(code, now)).toBe(false);
    }
  });
});
