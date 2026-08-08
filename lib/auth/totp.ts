/**
 * TOTP (Time-based One-Time Password) — RFC 6238 over RFC 4226, HMAC-SHA1.
 *
 * TWO SECURITY CHANGES ARE COMBINED HERE, from two independent lines of work:
 *
 *  1. **Vetted primitives** (exp/security-remediation, 2026-07-03). The
 *     hand-rolled HOTP/TOTP internals are replaced by otplib behind the exact
 *     same wire format: 30s step, 6 digits, SHA-1, ±1-step skew. Hand-rolled
 *     crypto is a liability even when it is correct.
 *
 *  2. **Per-user secrets** (2026-08-06). Every owner authenticated against one
 *     shared `TOTP_SECRET`, so a code minted for one account was valid for
 *     every account — latent with a single dogfooded owner, account takeover
 *     the moment self-serve signup existed.
 *
 * Those two changes rewrote the same lines, so this file is a deliberate
 * re-application rather than a merge: otplib internals underneath, per-user
 * secrets on top. Losing either would be a regression.
 *
 * `TOTP_SECRET` survives only as a fallback for accounts that predate signup
 * (`users.totp_secret IS NULL`). Once every account carries its own, retire it.
 *
 * Note: otplib enforces a >=16-byte secret minimum that the hand-rolled code
 * lacked — strictly tighter, and satisfied by both the 20-byte env secret and
 * `generateTotpSecret()`.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { randomBytes } from 'crypto';
import { generateSync, verifySync, ScureBase32Plugin } from 'otplib';

// ---------------------------------------------------------------------------
// Wire-format constants — identical to the pre-remediation implementation.
// Do not widen the window silently (see docs/security-remediation-plan.md).
// ---------------------------------------------------------------------------

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step tolerance (handles clock skew)

/** No I, O, U, 0 or 1 would be nice for humans, but base32 is RFC 4648. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32 = new ScureBase32Plugin();

/**
 * Decodes a secret string into raw key bytes.
 * Supports both base32 (e.g. an authenticator export) and hex.
 */
function decodeSecret(secret: string): Uint8Array {
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }
  return base32.decode(secret.toUpperCase().replace(/=+$/, ''));
}

/**
 * The legacy shared secret. Retained ONLY so the pre-signup dogfood account
 * keeps authenticating; new accounts carry their own `users.totp_secret`.
 */
function getTotpSecretBytes(): Uint8Array {
  const secret = process.env.TOTP_SECRET;
  if (!secret) throw new Error('TOTP_SECRET environment variable is not set');
  return decodeSecret(secret);
}

/**
 * Generates a fresh, cryptographically random per-user secret, base32-encoded
 * for `otpauth://` URLs and authenticator apps.
 *
 * 20 bytes = 160 bits, the RFC 4226 recommended HMAC-SHA1 key length, and
 * comfortably above otplib's 16-byte floor.
 */
export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);

  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

/** Generates the TOTP code for a specific secret and time window. */
export function generateTotpCodeFor(secret: string, atMs = Date.now()): string {
  return generateSync({
    secret: decodeSecret(secret),
    algorithm: 'sha1',
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
    epoch: Math.floor(atMs / 1000),
  });
}

/**
 * Validates a TOTP code against a specific secret, with ±TOTP_WINDOW step
 * tolerance for clock skew.
 *
 * This is the per-user entry point. Every owner has their own secret, so a code
 * minted for one account never validates against another.
 */
export function validateTotpCodeFor(secret: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  const result = verifySync({
    secret: decodeSecret(secret),
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

/**
 * Generates a code from the legacy shared env secret.
 *
 * @deprecated Prefer `generateTotpCodeFor` with the owner's own secret.
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
 * Validates against the legacy shared env secret.
 *
 * @deprecated Prefer `validateTotpCodeFor`. This path authenticates every
 * caller against ONE secret and must never be used for an account that has its
 * own `users.totp_secret`.
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
    epochTolerance: TOTP_WINDOW * TOTP_STEP_SECONDS,
  });

  return result.valid;
}
