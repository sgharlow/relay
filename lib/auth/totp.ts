/**
 * TOTP (Time-based One-Time Password) — adapter over the vetted `otplib` library.
 *
 * Implements RFC 6238 (TOTP) over RFC 4226 (HOTP) using HMAC-SHA1.
 * The shared secret is read from TOTP_SECRET environment variable (base32 or hex).
 *
 * Security remediation (docs/security-remediation-plan.md): the previous
 * hand-rolled HOTP/TOTP implementation was replaced by `otplib` behind the
 * exact same exported interface. Wire compatibility is pinned by the
 * unchanged tests in totp.test.ts plus the RFC 6238 known-answer vectors in
 * totp.adapter.test.ts: same 30s step, 6 digits, HMAC-SHA1, ±1-step skew
 * window, and the same base32/hex TOTP_SECRET handling.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { generateSync, verifySync, ScureBase32Plugin } from 'otplib';

// ---------------------------------------------------------------------------
// Wire-format constants — identical to the pre-remediation implementation.
// Do not widen the window silently (see docs/security-remediation-plan.md).
// ---------------------------------------------------------------------------

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step tolerance (handles clock skew)

const base32 = new ScureBase32Plugin();

/**
 * Decodes the TOTP secret from the environment variable into raw key bytes.
 * Supports both base32 (e.g., Google Authenticator export) and hex encoding.
 * The env var TOTP_SECRET is expected to be base32-encoded.
 */
function getTotpSecretBytes(): Uint8Array {
  const secret = process.env.TOTP_SECRET;
  if (!secret) throw new Error('TOTP_SECRET environment variable is not set');

  // Detect hex (all hex chars, even length) vs base32 — same rule as before.
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }

  return base32.decode(secret.toUpperCase().replace(/=+$/, ''));
}

/**
 * Generates the TOTP code for the current time window (or a given time).
 * Exposed for testing; production code uses `validateTotpCode`.
 */
export function generateTotpCode(atMs = Date.now()): string {
  return generateSync({
    secret: getTotpSecretBytes(),
    algorithm: 'sha1',
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
    epoch: Math.floor(atMs / 1000),
  });
}

/**
 * Validates a TOTP code against the current time window with ±TOTP_WINDOW step
 * tolerance for clock skew.
 *
 * @param code - 6-digit string provided by the user
 * @param atMs - epoch milliseconds (defaults to now; injectable for tests)
 * @returns true if the code matches any window within tolerance
 */
export function validateTotpCode(code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  // Resolve the secret before verifying so a missing TOTP_SECRET still
  // throws (not returns false) — same contract as the previous implementation.
  const secret = getTotpSecretBytes();

  const result = verifySync({
    secret,
    token: code,
    algorithm: 'sha1',
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
    epoch: Math.floor(atMs / 1000),
    // epochTolerance is in seconds: ±1 step of 30s ≡ the old ±1 window loop.
    epochTolerance: TOTP_WINDOW * TOTP_STEP_SECONDS,
  });

  return result.valid;
}
