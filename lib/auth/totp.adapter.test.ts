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

import { describe, it, expect } from 'vitest';
import { generateTotpCodeFor, validateTotpCodeFor } from './totp';

// base32("12345678901234567890") — the RFC 4226/6238 reference secret
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
// hex("12345678901234567890") — same key bytes, hex-encoded
const RFC_SECRET_HEX = '3132333435363738393031323334353637383930';

/*
  🔴 THESE VECTORS USED TO PROVE A DEAD PATH. They ran against
  `generateTotpCode`/`validateTotpCode`, which read the shared
  `process.env.TOTP_SECRET` — a path retired on 2026-08-13 and, by then, one no
  production caller used. The RFC known-answers are the most valuable assertions
  in this file, so they move onto `generateTotpCodeFor`/`validateTotpCodeFor`:
  the functions sign-in actually calls. Same key, same expected digits, so a
  wrong conversion could not have passed.

  The secret is now an argument rather than ambient state, which is why the
  env harness is gone.
*/

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
    expect(generateTotpCodeFor(RFC_SECRET_BASE32, epochSeconds * 1000)).toBe(expected);
  });

  it.each(VECTORS)('validates the RFC code at T=%d', (epochSeconds, expected) => {
    expect(validateTotpCodeFor(RFC_SECRET_BASE32, expected, epochSeconds * 1000)).toBe(true);
  });
});

describe('totp adapter — hex-encoded TOTP_SECRET compatibility', () => {
  it('hex and base32 encodings of the same key produce the same code', () => {
    const atMs = 1_700_000_015_000;

    const fromBase32 = generateTotpCodeFor(RFC_SECRET_BASE32, atMs);
    const fromHex = generateTotpCodeFor(RFC_SECRET_HEX, atMs);

    expect(fromHex).toBe(fromBase32);
  });

  it('validates a base32-generated code under the hex form of the secret', () => {
    const atMs = 1_700_000_015_000;

    const code = generateTotpCodeFor(RFC_SECRET_BASE32, atMs);

    expect(validateTotpCodeFor(RFC_SECRET_HEX, code, atMs)).toBe(true);
  });
});

describe('totp adapter — skew window is exactly ±1 step (do not widen silently)', () => {
  it('accepts codes exactly one step away in both directions, rejects two', () => {
    const now = 1_700_000_015_000;
    const at = (ms: number) => generateTotpCodeFor(RFC_SECRET_BASE32, ms);

    expect(validateTotpCodeFor(RFC_SECRET_BASE32, at(now - 30_000), now)).toBe(true);
    expect(validateTotpCodeFor(RFC_SECRET_BASE32, at(now + 30_000), now)).toBe(true);
    expect(validateTotpCodeFor(RFC_SECRET_BASE32, at(now - 60_000), now)).toBe(false);
    expect(validateTotpCodeFor(RFC_SECRET_BASE32, at(now + 60_000), now)).toBe(false);
  });

  it('rejects a code from a different secret', () => {
    const now = 1_700_000_015_000;
    const code = generateTotpCodeFor(RFC_SECRET_BASE32, now);

    // NOTE: otplib enforces a >=16-byte secret guardrail (the hand-rolled
    // implementation accepted any length), so use a full 20-byte secret here.
    // Differs from RFC_SECRET_BASE32 in the final character only.
    const OTHER_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJR';
    // Guard against the astronomically unlikely 1-in-10^6 collision across
    // the three-window check by only asserting when codes actually differ.
    if (generateTotpCodeFor(OTHER_SECRET, now) !== code) {
      expect(validateTotpCodeFor(OTHER_SECRET, code, now)).toBe(false);
    }
  });
});
