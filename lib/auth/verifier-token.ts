/**
 * Verifier-scoped JWT issuance and verification.
 *
 * Mirrors lib/auth/recipient-token.ts: HS256 compact JWS scoping a Verifier
 * session to a specific Release_State instance. The confirmation email link
 * carries this token so a verifier can confirm without an interactive login.
 *
 * SIGNING IS DELEGATED TO jose (2026-08-08). It was hand-rolled on Node's
 * `crypto` — correct as far as anyone could tell, but "as far as anyone could
 * tell" is not the standard for the code that decides whether a stranger may
 * open someone's vault. jose v6 is WebCrypto-backed and Promise-only, which is
 * why this module's public interface is async; that change is the reason the
 * swap had to be coordinated across every call site at once.
 *
 * WHAT IS DELIBERATELY NOT DELEGATED. The structural, header and algorithm
 * checks below still run first, in this order, because the error contract is
 * pinned by tests and jose's own messages do not match it — and because a
 * downgraded-alg token carrying a garbage signature must be refused for the
 * *algorithm*, not the signature. Losing that precedence would turn a specific
 * refusal into a generic one and make an alg-downgrade attempt look like an
 * ordinary typo in the logs.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.3, 17.2
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export interface VerifierTokenPayload {
  /** UUID of the Verifier. */
  verifierId: string;
  /** UUID of the Release_State row this confirmation is scoped to. */
  releaseStateId: string;
  /** Issued-at — epoch seconds. */
  iat: number;
  /** Expiration — epoch seconds (72h after iat — covers a grace window). */
  exp: number;
}

const ALGORITHM = 'HS256';
const TOKEN_TTL_SECONDS = 72 * 60 * 60; // 72 hours

function base64urlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

function getSecret(): Uint8Array {
  const secret = process.env.VERIFIER_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error('VERIFIER_JWT_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

/** Issues a 72-hour HS256 JWT scoping a Verifier to one Release_State. */
export async function issueVerifierToken(
  verifierId: string,
  releaseStateId: string,
): Promise<string> {
  const secret = getSecret();

  // Epoch seconds computed here and passed explicitly. jose's no-argument
  // defaults call `new Date()`, which does NOT route through `Date.now` and so
  // is invisible to the harness's clock mocking. Passing the value keeps every
  // existing time-travel test working untouched.
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ verifierId, releaseStateId })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(secret);
}

/** Verifies a verifier token and returns its payload, or rejects. */
export async function verifyVerifierToken(token: string): Promise<VerifierTokenPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token: expected three dot-separated segments');
  }
  const [headerEncoded] = parts;

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecode(headerEncoded).toString('utf8'));
  } catch {
    throw new Error('Invalid token: header is not valid base64url-encoded JSON');
  }
  if (header['alg'] !== ALGORITHM) {
    throw new Error(`Invalid token: unsupported algorithm "${header['alg']}"`);
  }

  const secret = getSecret();

  let payload: VerifierTokenPayload;
  try {
    // clockTolerance stays unset (0): jose compares `exp <= now - tolerance`,
    // which at zero is exactly the strict `exp <= now` rejection the pinned
    // "exp exactly equals now" vector depends on.
    const result = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      currentDate: new Date(Date.now()),
    });
    payload = result.payload as unknown as VerifierTokenPayload;
  } catch (err) {
    throw translateJoseError(err);
  }

  if (!payload.verifierId) throw new Error('Invalid token: missing verifierId claim');
  if (!payload.releaseStateId) throw new Error('Invalid token: missing releaseStateId claim');

  return payload;
}

/**
 * Restates jose's failures in this module's existing vocabulary.
 *
 * The messages are load-bearing: 22 negative vectors assert on them, and they
 * are what distinguishes "your link expired, ask for another" from "this
 * signature is forged" when someone is reading a log during an emergency.
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
  // Anything structural jose rejected that the pre-checks let through — a
  // payload that is not base64url JSON, most often. Mapped to the structural
  // message rather than the signature one, because calling a malformed token
  // "forged" sends whoever reads it hunting for an attacker.
  return new Error('Invalid token: payload is not valid base64url-encoded JSON');
}
