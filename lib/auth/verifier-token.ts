/**
 * Verifier-scoped JWT issuance and verification.
 *
 * Mirrors lib/auth/recipient-token.ts: HS256 compact JWS signed with the
 * Node built-in `crypto` module, scoping a Verifier session to a specific
 * Release_State instance. The confirmation email link carries this token so a
 * verifier can confirm without an interactive login.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.3, 17.2
 */

import { createHmac, timingSafeEqual } from 'crypto';

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

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64url');
}

function base64urlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

function getSecret(): Buffer {
  const secret = process.env.VERIFIER_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error('VERIFIER_JWT_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

function sign(input: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

/** Issues a 72-hour HS256 JWT scoping a Verifier to one Release_State. */
export function issueVerifierToken(verifierId: string, releaseStateId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: ALGORITHM, typ: 'JWT' };
  const payload: VerifierTokenPayload = {
    verifierId,
    releaseStateId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = base64urlEncode(sign(signingInput, getSecret()));
  return `${signingInput}.${signature}`;
}

/** Verifies a verifier token and returns its payload, or throws. */
export function verifyVerifierToken(token: string): VerifierTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token: expected three dot-separated segments');
  }
  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecode(headerEncoded).toString('utf8'));
  } catch {
    throw new Error('Invalid token: header is not valid base64url-encoded JSON');
  }
  if (header['alg'] !== ALGORITHM) {
    throw new Error(`Invalid token: unsupported algorithm "${header['alg']}"`);
  }

  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const expectedSig = sign(signingInput, getSecret());
  let actualSig: Buffer;
  try {
    actualSig = base64urlDecode(signatureEncoded);
  } catch {
    throw new Error('Invalid token: signature segment is not valid base64url');
  }
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid token: signature verification failed');
  }

  let payload: VerifierTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadEncoded).toString('utf8'));
  } catch {
    throw new Error('Invalid token: payload is not valid base64url-encoded JSON');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Invalid token: token has expired');
  }
  if (!payload.verifierId) throw new Error('Invalid token: missing verifierId claim');
  if (!payload.releaseStateId) throw new Error('Invalid token: missing releaseStateId claim');

  return payload;
}
