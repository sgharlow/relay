/**
 * Owner self-serve signup with mandatory TOTP enrolment.
 *
 * Two phases, no pending row. `beginSignup` writes nothing: it mints a fresh
 * per-user secret and returns it inside a short-lived, HMAC-signed enrolment
 * token. `completeSignup` validates a real authenticator code against the
 * secret carried by that token and only then INSERTs the account.
 *
 * That ordering matters twice over. `users.status` is constrained to
 * ('active','suspended') so a 'pending' row is not representable — but more
 * importantly, an account that exists before MFA is proven is an account that
 * exists without MFA (Req 17.1).
 *
 * The secret travelling in the token is not a new exposure: the same secret is
 * already in the QR code on the user's screen.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { query } from '../db/connection';
import { generateTotpSecret, validateTotpCodeFor } from './totp';
import { ValidationError } from '../validation';
import { issueRecoveryCodes, formatRecoveryCode } from './recovery-code';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mirrors the `authSub` derivation in lib/auth/auth-options.ts. Kept identical
 * on purpose: a signup that writes a different auth_sub creates a row sign-in
 * cannot find, and upsertUser then inserts a duplicate for the same email.
 */
export function authSubFor(email: string): string {
  return `credentials:${email}`;
}

/** Long enough to scan a QR and type a code; short enough to be disposable. */
export const ENROLMENT_TTL_SECONDS = 15 * 60;

/** Guards against a token minted for another flow being replayed here. */
const TOKEN_PURPOSE = 'signup-enrolment';

interface EnrolmentClaims {
  purpose: string;
  email: string;
  secret: string;
  /** Carried through enrolment so step two needs no second form. */
  displayName?: string;
  exp: number;
}

function base64urlEncode(data: string | Buffer): string {
  return (typeof data === 'string' ? Buffer.from(data, 'utf8') : data).toString('base64url');
}

function getSigningSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

function signEnrolment(claims: EnrolmentClaims): string {
  const payload = base64urlEncode(JSON.stringify(claims));
  const sig = base64urlEncode(createHmac('sha256', getSigningSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyEnrolment(token: string): EnrolmentClaims {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new ValidationError('That enrolment session is not valid. Start again.', 'token');
  }

  const [payload, sigPart] = parts;
  const expected = createHmac('sha256', getSigningSecret()).update(payload).digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(sigPart, 'base64url');
  } catch {
    throw new ValidationError('That enrolment session is not valid. Start again.', 'token');
  }

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ValidationError('That enrolment session is not valid. Start again.', 'token');
  }

  let claims: EnrolmentClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('That enrolment session is not valid. Start again.', 'token');
  }

  if (claims.purpose !== TOKEN_PURPOSE) {
    throw new ValidationError('That enrolment session is not valid. Start again.', 'token');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw new ValidationError('That enrolment session expired. Start again.', 'token');
  }

  return claims;
}

/**
 * A display name is OPTIONAL and capped, never required.
 *
 * Every message about an owner used to print their raw email address, which on
 * a trust product is the strongest phishing signal in the outbound mail. But
 * demanding a name at signup adds a field to the one screen standing between an
 * ad click and an account, so it is asked for and never insisted on — an owner
 * without one falls back to their email, exactly as before.
 */
export const MAX_DISPLAY_NAME_LENGTH = 80;

export function validateSignupInput(body: unknown): { email: string; displayName?: string } {
  const raw = (body as { email?: unknown })?.email;
  if (typeof raw !== 'string') throw new ValidationError('email is required', 'email');

  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError('email is not a valid address', 'email');

  const rawName = (body as { displayName?: unknown })?.displayName;
  const displayName = typeof rawName === 'string' ? rawName.trim() : undefined;
  if (displayName && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new ValidationError(
      `name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`,
      'displayName',
    );
  }

  return displayName ? { email, displayName } : { email };
}

async function emailIsTaken(email: string): Promise<boolean> {
  const res = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return res.rows.length > 0;
}

export async function beginSignup(
  email: string,
  displayName?: string,
): Promise<{
  enrolmentToken: string;
  totpSecret: string;
  otpauthUrl: string;
}> {
  if (await emailIsTaken(email)) {
    throw new ValidationError('An account already exists for this email', 'email');
  }

  const totpSecret = generateTotpSecret();

  const enrolmentToken = signEnrolment({
    purpose: TOKEN_PURPOSE,
    email,
    secret: totpSecret,
    ...(displayName ? { displayName } : {}),
    exp: Math.floor(Date.now() / 1000) + ENROLMENT_TTL_SECONDS,
  });

  const otpauthUrl =
    `otpauth://totp/Relay:${encodeURIComponent(email)}` +
    `?secret=${totpSecret}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;

  return { enrolmentToken, totpSecret, otpauthUrl };
}

export async function completeSignup(
  enrolmentToken: string,
  code: string,
): Promise<{ ownerId: string; recoveryCodes: string[] }> {
  const claims = verifyEnrolment(enrolmentToken);

  if (!validateTotpCodeFor(claims.secret, code)) {
    throw new ValidationError('That code is not valid. Check your authenticator app.', 'code');
  }

  // Re-check: the address may have been claimed during enrolment.
  if (await emailIsTaken(claims.email)) {
    throw new ValidationError('An account already exists for this email', 'email');
  }

  // auth_sub MUST match what authorize() derives, or sign-in will not find this
  // row and upsertUser will insert a duplicate for the same email.
  const inserted = await query<{ id: string }>(
    `INSERT INTO users (email, auth_sub, status, totp_secret, display_name)
     VALUES ($1, $2, 'active', $3, $4)
     RETURNING id`,
    [claims.email, authSubFor(claims.email), claims.secret, claims.displayName ?? null],
  );

  const ownerId = inserted.rows[0].id;

  // Issued at signup because this is the only moment the owner is guaranteed to
  // be looking. Relay has no password, so without these a lost or replaced
  // phone used to mean a permanently unreachable vault — for an older owner
  // over a few years, the expected case rather than an edge one.
  //
  // Best-effort: an account that exists without recovery codes can regenerate
  // them, whereas failing the signup after the row is committed would leave an
  // account nobody can finish creating.
  let recoveryCodes: string[] = [];
  try {
    recoveryCodes = (await issueRecoveryCodes(ownerId)).map(formatRecoveryCode);
  } catch (err) {
    process.stderr.write(`[signup] recovery code issue failed for ${ownerId}: ${String(err)}\n`);
  }

  return { ownerId, recoveryCodes };
}
