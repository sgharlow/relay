/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Implements RFC 6238 (TOTP) over RFC 4226 (HOTP) using HMAC-SHA1.
 * The shared secret is read from TOTP_SECRET environment variable (base32 or hex).
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { createHmac } from 'crypto';

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
 * Decodes the TOTP secret from the environment variable.
 * Supports both base32 (e.g., Google Authenticator export) and hex encoding.
 * The env var TOTP_SECRET is expected to be base32-encoded.
 */
function getTotpSecretBuffer(): Buffer {
  const secret = process.env.TOTP_SECRET;
  if (!secret) throw new Error('TOTP_SECRET environment variable is not set');

  // Detect hex (all hex chars, even length) vs base32
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    return Buffer.from(secret, 'hex');
  }

  return base32Decode(secret);
}

/**
 * Generates the TOTP code for the current time window (or a given time).
 * Exposed for testing; production code uses `validateTotpCode`.
 */
export function generateTotpCode(atMs = Date.now()): string {
  const secret = getTotpSecretBuffer();
  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
  return hotp(secret, counter, TOTP_DIGITS);
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
