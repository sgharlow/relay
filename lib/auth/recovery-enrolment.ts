/**
 * Enrolling a replacement authenticator during recovery.
 *
 * Deliberately mirrors `signup.ts`: a short-lived HMAC-signed token carries the
 * candidate TOTP secret between the two steps, and NOTHING is written until a
 * real authenticator produces a valid code against it. The same ordering
 * argument applies — an account whose secret is replaced before the new device
 * is proven is an account locked out by a half-finished recovery.
 *
 * Kept separate from signup rather than parameterised, because the two flows
 * have different token purposes and must not be interchangeable: a signup
 * enrolment token must never be replayable as a recovery token, or an attacker
 * who could start a signup could rewrite an existing account's authenticator.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1, 17.1
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { generateTotpSecret, validateTotpCodeFor } from './totp';
import { ValidationError } from '../validation';

export const RECOVERY_ENROLMENT_TTL_SECONDS = 15 * 60;

/** Distinct from signup's purpose so the two tokens can never be swapped. */
const TOKEN_PURPOSE = 'recovery-enrolment';

interface RecoveryClaims {
  purpose: string;
  userId: string;
  email: string;
  secret: string;
  exp: number;
}

function secretKey(): string {
  const key = process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('NEXTAUTH_SECRET is not set');
  return key;
}

function b64url(data: string | Buffer): string {
  return (typeof data === 'string' ? Buffer.from(data, 'utf8') : data).toString('base64url');
}

function sign(claims: RecoveryClaims): string {
  const payload = b64url(JSON.stringify(claims));
  const mac = createHmac('sha256', secretKey()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verify(token: string): RecoveryClaims {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) throw new ValidationError('That recovery session is not valid.', 'enrolmentToken');

  const expected = createHmac('sha256', secretKey()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ValidationError('That recovery session is not valid.', 'enrolmentToken');
  }

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecoveryClaims;
  if (claims.purpose !== TOKEN_PURPOSE) {
    throw new ValidationError('That recovery session is not valid.', 'enrolmentToken');
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new ValidationError('That recovery session expired. Start again.', 'enrolmentToken');
  }
  return claims;
}

export interface RecoveryEnrolment {
  enrolmentToken: string;
  totpSecret: string;
  otpauthUrl: string;
}

/** Issues a candidate secret. Writes nothing — the account is untouched. */
export function beginRecoveryEnrolment(userId: string, email: string): RecoveryEnrolment {
  const totpSecret = generateTotpSecret();

  return {
    enrolmentToken: sign({
      purpose: TOKEN_PURPOSE,
      userId,
      email,
      secret: totpSecret,
      exp: Math.floor(Date.now() / 1000) + RECOVERY_ENROLMENT_TTL_SECONDS,
    }),
    totpSecret,
    otpauthUrl:
      `otpauth://totp/Relay:${encodeURIComponent(email)}` +
      `?secret=${totpSecret}&issuer=Relay&algorithm=SHA1&digits=6&period=30`,
  };
}

/**
 * Validates a code against the candidate secret.
 *
 * Returns the user and the secret to install. The caller writes it — this
 * module stays pure so the ordering (prove, then write) is visible at the call
 * site rather than buried.
 */
export function completeRecoveryEnrolment(
  enrolmentToken: string,
  code: string,
): { userId: string; secret: string } {
  const claims = verify(enrolmentToken);

  if (!validateTotpCodeFor(claims.secret, code)) {
    throw new ValidationError('That code is not valid. Check your authenticator app.', 'code');
  }

  return { userId: claims.userId, secret: claims.secret };
}
