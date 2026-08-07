/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Implements RFC 6238 (TOTP) over RFC 4226 (HOTP) using HMAC-SHA1.
 * Per-user secrets: each owner carries their own base32 secret in
 * users.totp_secret. The TOTP_SECRET env var is a legacy fallback for the
 * pre-signup dogfood account only.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { createHmac, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Base32 decoding (RFC 4648, no padding required)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const str = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of str) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

// ---------------------------------------------------------------------------
// HOTP (HMAC-based OTP, RFC 4226)
// ---------------------------------------------------------------------------

function hotp(secret: Buffer, counter: bigint, digits = 6): string {
  // Counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);

  const hmac = createHmac('sha1', secret).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = truncated % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

// ---------------------------------------------------------------------------
// TOTP (Time-based OTP, RFC 6238)
// ---------------------------------------------------------------------------

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step tolerance (handles clock skew)

/**
 * Decodes a secret string into raw bytes.
 * Supports both base32 (e.g., Google Authenticator export) and hex encoding.
 */
function decodeSecret(secret: string): Buffer {
  // Detect hex (all hex chars, even length) vs base32
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    return Buffer.from(secret, 'hex');
  }

  return base32Decode(secret);
}

/**
 * Decodes the legacy shared TOTP secret from the environment variable.
 *
 * Retained ONLY so the pre-signup dogfood account keeps authenticating. New
 * accounts carry their own `users.totp_secret`; see `generateTotpSecret`.
 */
function getTotpSecretBuffer(): Buffer {
  const secret = process.env.TOTP_SECRET;
  if (!secret) throw new Error('TOTP_SECRET environment variable is not set');

  return decodeSecret(secret);
}

/**
 * Generates a fresh, cryptographically random per-user secret, base32-encoded
 * for `otpauth://` URLs and authenticator apps.
 *
 * 20 bytes = 160 bits, the RFC 4226 recommended HMAC-SHA1 key length.
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
  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
  return hotp(decodeSecret(secret), counter, TOTP_DIGITS);
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

  const key = decodeSecret(secret);
  const currentStep = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));

  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    if (hotp(key, currentStep + BigInt(delta), TOTP_DIGITS) === code) {
      return true;
    }
  }

  return false;
}

/**
 * Generates the TOTP code for the current time window (or a given time) using
 * the legacy shared env secret.
 *
 * @deprecated Prefer `generateTotpCodeFor` with the owner's own secret.
 */
export function generateTotpCode(atMs = Date.now()): string {
  const secret = getTotpSecretBuffer();
  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
  return hotp(secret, counter, TOTP_DIGITS);
}

/**
 * Validates a TOTP code against the legacy shared env secret.
 *
 * @deprecated Prefer `validateTotpCodeFor` with the owner's own secret. This
 * path authenticates every caller against ONE secret and must never be used for
 * an account that has its own `users.totp_secret`.
 *
 * @param code - 6-digit string provided by the user
 * @param atMs - epoch milliseconds (defaults to now; injectable for tests)
 * @returns true if the code matches any window within tolerance
 */
export function validateTotpCode(code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  const secret = getTotpSecretBuffer();
  const currentStep = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));

  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = currentStep + BigInt(delta);
    if (hotp(secret, step, TOTP_DIGITS) === code) {
      return true;
    }
  }

  return false;
}
