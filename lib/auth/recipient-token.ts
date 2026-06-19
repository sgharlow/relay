/**
 * Recipient-scoped JWT issuance and verification.
 *
 * Issues HS256 JWTs that scope a Recipient session to a specific
 * Release_State instance and version. The version claim is used by the
 * Access_Dashboard to detect stale sessions (Requirement 15.3):
 * if the Release_State version advances after a token is issued the
 * server will reject subsequent requests from that token.
 *
 * Implementation uses the Node.js built-in `crypto` module (no external
 * JWT library required). Tokens follow the compact JWS serialisation:
 *   base64url(header).base64url(payload).base64url(signature)
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.2, 17.2
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The claims embedded in a recipient session token. */
export interface RecipientTokenPayload {
  /** The UUID of the authenticated Recipient. */
  recipientId: string;
  /** The UUID of the Release_State row this session is scoped to. */
  releaseStateId: string;
  /**
   * The Release_State version at the time of issuance, serialised as a
   * decimal string to avoid JSON number precision loss (bigint).
   */
  version: string;
  /** Issued-at — epoch seconds (standard JWT claim). */
  iat: number;
  /** Expiration — epoch seconds (standard JWT claim). 24 hours after `iat`. */
  exp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'HS256';
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours (Requirement 17.2)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64url');
}

function base64urlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

function getSecret(): Buffer {
  const secret = process.env.RECIPIENT_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error('RECIPIENT_JWT_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

function sign(input: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issues a 24-hour HS256 JWT scoped to a specific Recipient session.
 *
 * @param recipientId   - UUID of the Recipient being granted access
 * @param releaseStateId - UUID of the Release_State row
 * @param version       - Current `version` bigint from the Release_State row;
 *                        serialised as a decimal string in the token claims
 * @returns Compact JWS string (header.payload.signature)
 *
 * @throws {Error} if `RECIPIENT_JWT_SECRET` is not set
 */
export function issueRecipientToken(
  recipientId: string,
  releaseStateId: string,
  version: bigint,
): string {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: ALGORITHM, typ: 'JWT' };
  const payload: RecipientTokenPayload = {
    recipientId,
    releaseStateId,
    version: version.toString(10),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const secret = getSecret();
  const signature = sign(signingInput, secret);
  const signatureEncoded = base64urlEncode(signature);

  return `${signingInput}.${signatureEncoded}`;
}

/**
 * Verifies a recipient token and returns its decoded payload.
 *
 * Checks:
 *  1. Token structure (three base64url-encoded segments)
 *  2. Algorithm claim is `HS256`
 *  3. HMAC signature is valid (constant-time comparison)
 *  4. Token has not expired (`exp` > current epoch seconds)
 *
 * @param token - Compact JWS string to verify
 * @returns Decoded {@link RecipientTokenPayload}
 *
 * @throws {Error} with a descriptive message on any validation failure
 */
export function verifyRecipientToken(token: string): RecipientTokenPayload {
  // --- Structural check ---
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token: expected three dot-separated segments');
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  // --- Decode header ---
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecode(headerEncoded).toString('utf8'));
  } catch {
    throw new Error('Invalid token: header is not valid base64url-encoded JSON');
  }

  if (header['alg'] !== ALGORITHM) {
    throw new Error(
      `Invalid token: unsupported algorithm "${header['alg']}" — expected ${ALGORITHM}`,
    );
  }

  // --- Verify signature (constant-time) ---
  const secret = getSecret();
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const expectedSig = sign(signingInput, secret);

  let actualSig: Buffer;
  try {
    actualSig = base64urlDecode(signatureEncoded);
  } catch {
    throw new Error('Invalid token: signature segment is not valid base64url');
  }

  if (
    expectedSig.length !== actualSig.length ||
    !timingSafeEqual(expectedSig, actualSig)
  ) {
    throw new Error('Invalid token: signature verification failed');
  }

  // --- Decode payload ---
  let payload: RecipientTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadEncoded).toString('utf8'));
  } catch {
    throw new Error('Invalid token: payload is not valid base64url-encoded JSON');
  }

  // --- Expiry check ---
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Invalid token: token has expired');
  }

  // --- Required claims presence ---
  if (!payload.recipientId) {
    throw new Error('Invalid token: missing recipientId claim');
  }
  if (!payload.releaseStateId) {
    throw new Error('Invalid token: missing releaseStateId claim');
  }
  if (payload.version === undefined || payload.version === null) {
    throw new Error('Invalid token: missing version claim');
  }

  return payload;
}
