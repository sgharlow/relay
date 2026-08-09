/**
 * Recipient-scoped JWT issuance and verification.
 *
 * Issues HS256 JWTs that scope a Recipient session to a specific
 * Release_State instance and version. The version claim is used by the
 * Access_Dashboard to detect stale sessions (Requirement 15.3):
 * if the Release_State version advances after a token is issued the
 * server will reject subsequent requests from that token.
 *
 * SIGNING IS DELEGATED TO jose (2026-08-08). This was hand-rolled on Node's
 * `crypto` — three segments, an HMAC and a constant-time compare. It was, as
 * far as anyone could tell, correct. But this is the code that decides whether
 * a stranger holding a link may open someone's vault during an emergency, and
 * "as far as anyone could tell" is the wrong standard for it. jose v6 is
 * WebCrypto-backed and Promise-only, which is why this module's public
 * interface is async and why the swap had to land across every call site at
 * once rather than as an internals-only change.
 *
 * WHAT IS DELIBERATELY NOT DELEGATED. The structural, header and algorithm
 * checks still run first, in this order. Two reasons: the error messages are
 * pinned by 22 negative vectors and jose's own wording does not match them,
 * and a token that downgrades `alg` while carrying a garbage signature must be
 * refused for the *algorithm* specifically. Collapsing that into a generic
 * signature failure would make a deliberate downgrade attempt indistinguishable
 * from a corrupted link in the logs.
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.2, 17.2
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

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

function base64urlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

function getSecret(): Uint8Array {
  const secret = process.env.RECIPIENT_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error('RECIPIENT_JWT_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

/**
 * Restates jose's failures in this module's existing vocabulary.
 *
 * The messages are load-bearing. They are asserted by the negative vectors, and
 * more importantly they are what tells whoever reads a log the difference
 * between "this link timed out, send another" and "someone forged this".
 */
function translateJoseError(err: unknown): Error {
  const code = (err as { code?: string })?.code;

  if (code === 'ERR_JWT_EXPIRED' || err instanceof joseErrors.JWTExpired) {
    return new Error('Invalid token: token has expired');
  }
  if (
    code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
    err instanceof joseErrors.JWSSignatureVerificationFailed
  ) {
    return new Error('Invalid token: signature verification failed');
  }
  // Structural failures the pre-checks let through — a payload segment that is
  // not base64url JSON, typically. Mapped to the structural message rather than
  // the signature one, so a mangled link does not read as an attack.
  return new Error('Invalid token: payload is not valid base64url-encoded JSON');
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
export async function issueRecipientToken(
  recipientId: string,
  releaseStateId: string,
  version: bigint,
): Promise<string> {
  const secret = getSecret();

  // Epoch seconds computed here and passed explicitly, rather than letting jose
  // default them. Its defaults call `new Date()`, which does not route through
  // `Date.now` and so cannot be seen by the harness's `vi.spyOn(Date, 'now')`
  // clock. Passing the value keeps every existing time-travel test working
  // without a fake-timer rewrite or an injected-clock parameter in the API.
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    recipientId,
    releaseStateId,
    version: version.toString(10),
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(secret);
}

/**
 * Verifies a recipient token and returns its decoded payload.
 *
 * Checks, in this order:
 *  1. Token structure (three base64url-encoded segments)
 *  2. Algorithm claim is `HS256`
 *  3. HMAC signature is valid          (jose)
 *  4. Token has not expired            (jose)
 *  5. Required claims are present
 *
 * @param token - Compact JWS string to verify
 * @returns Decoded {@link RecipientTokenPayload}
 *
 * @throws {Error} with a descriptive message on any validation failure
 */
export async function verifyRecipientToken(token: string): Promise<RecipientTokenPayload> {
  // --- Structural check ---
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token: expected three dot-separated segments');
  }

  const [headerEncoded] = parts;

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

  const secret = getSecret();

  // --- Signature + expiry (jose) ---
  let payload: RecipientTokenPayload;
  try {
    // clockTolerance stays unset (0). jose compares `exp <= now - tolerance`,
    // which at zero is exactly the strict `exp <= now` rejection that the
    // "exp exactly equals now" vector depends on. Any tolerance here would
    // silently extend the life of every recipient token.
    const result = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      currentDate: new Date(Date.now()),
    });
    payload = result.payload as unknown as RecipientTokenPayload;
  } catch (err) {
    throw translateJoseError(err);
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
