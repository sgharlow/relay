/**
 * Step-up authentication — proving somebody is still at the keyboard.
 *
 * THE DEFECT THIS CLOSES (PROJECT.yaml `deferred:`
 * step-up-reauth-on-sensitive-actions, opened by the 2026-08-14 six-lens audit).
 * Issuing fresh recovery codes, exporting the vault and closing the account all
 * ran on the ordinary 24-hour session. So a machine somebody walked away from
 * could be converted into PERMANENT control — a new recovery sheet outlives the
 * session that minted it and outlives a password change, because there is no
 * password — or into a full plaintext export of everything the product exists to
 * protect. Sign-out on every surface shrank the window; it did not close it.
 *
 * A SUDO WINDOW, NOT A PER-ACTION PROMPT. Five minutes of elevation covering the
 * sensitive screens, the shape GitHub and AWS already taught people. Re-prompting
 * per action reads as broken to somebody who exports, sees an error, and retries;
 * the window is bounded, revocable, and the actions inside it are audited.
 *
 * WHY ELEVATION IS A ROW AND NOT A CLAIM. A signed cookie proves we minted it and
 * cannot be withdrawn before it expires. Elevation must die the moment the person
 * says the device is not theirs, so the nonce lives in `auth_challenges` and
 * every check consults it. Sign-out, an epoch bump and account recovery all
 * revoke it — and the JWT is additionally bound to the session epoch, so a bump
 * invalidates outstanding elevation even if the revoke write never lands.
 *
 * IRREVERSIBLE ACTIONS SPEND IT. `requireStepUp` leaves the window open;
 * `requireStepUpOnce` burns the nonce, so closing an account consumes the
 * elevation that authorised it and a second close cannot ride the same proof.
 *
 * WHAT IT IS NOT. This is not a second factor at sign-in — that already exists
 * and this never replaces it. It is a freshness check: the factor you signed in
 * with, presented again, recently.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J13-R1, J13-R2
 */

import { SignJWT, jwtVerify } from 'jose';
import { isSecureOrigin } from '../app-url';
import { NextResponse } from 'next/server';

import { query } from '../db/connection';
import { readSessionEpoch } from './session-epoch';
import {
  newChallengeId,
  recordChallenge,
  burnChallenge,
  isChallengeLive,
  revokeChallenges,
} from './challenge-store';

/**
 * Five minutes. Long enough to export a large vault without being interrupted
 * (the export decrypts item by item in the browser and a hundred items takes
 * well under a minute), short enough that a walked-away-from machine is not a
 * standing grant.
 */
export const STEP_UP_TTL_SECONDS = 300;

/**
 * httpOnly, so script on the page cannot read it. That matters more here than
 * anywhere else in the product: elevation is the one credential whose theft
 * converts a session into permanent control, which is the exact escalation this
 * module exists to prevent.
 */
export const STEP_UP_COOKIE = 'relay_step_up';

const PURPOSE = 'step-up' as const;

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set');
  return new TextEncoder().encode(s);
}

export interface StepUpGrant {
  token: string;
  expiresAt: string;
}

/**
 * Records a nonce and seals it into a token bound to this user and to the
 * account's session epoch as it stands right now.
 *
 * Both bindings are load-bearing. Without `sub`, elevation minted by one account
 * would elevate another that got hold of the cookie. Without `epoch`, "sign out
 * everywhere" would leave a five-minute window open on the device somebody just
 * declared compromised.
 *
 * The epoch is read here rather than threaded in from the session, so no caller
 * can forget to pass it. That is deliberate: an optional security parameter is
 * one refactor away from being dropped, and this one fails OPEN when dropped.
 */
export async function mintStepUp(args: { userId: string }): Promise<StepUpGrant> {
  const epoch = (await readSessionEpoch(args.userId)) ?? 0;

  const jti = newChallengeId();
  await recordChallenge({
    jti,
    purpose: PURPOSE,
    ttlSeconds: STEP_UP_TTL_SECONDS,
    userId: args.userId,
  });

  const token = await new SignJWT({ purpose: PURPOSE, epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(args.userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${STEP_UP_TTL_SECONDS}s`)
    .sign(secret());

  return { token, expiresAt: new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000).toISOString() };
}

/**
 * Verifies the seal and the epoch binding. Returns the nonce, or null.
 *
 * Split out so the two checks below share one definition of "well-formed, ours,
 * and not superseded" — a second copy of this reasoning is how one of them would
 * end up skipping the subject comparison.
 *
 * The epoch read DENIES on failure, matching `isSessionCurrent`: a database blip
 * drops elevation rather than honouring a token nobody can check.
 */
async function openStepUp(token: string | undefined, userId: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== PURPOSE) return null;
    if (payload.sub !== userId) return null;

    const current = await readSessionEpoch(userId);
    // A deleted user has no epoch and no elevation.
    if (current === null) return null;
    if (Number(payload.epoch ?? 0) < current) return null;

    return typeof payload.jti === 'string' ? payload.jti : null;
  } catch {
    return null;
  }
}

/** Is this request inside a live elevation window? Does not spend it. */
export async function hasStepUp(token: string | undefined, userId: string): Promise<boolean> {
  const jti = await openStepUp(token, userId);
  if (!jti) return false;
  return isChallengeLive(jti, PURPOSE);
}

/** Consumes the elevation. True exactly once per grant. */
export async function spendStepUp(token: string | undefined, userId: string): Promise<boolean> {
  const jti = await openStepUp(token, userId);
  if (!jti) return false;
  return burnChallenge(jti, PURPOSE);
}

/** Drops every live elevation this user holds. */
export async function revokeStepUp(userId: string): Promise<number> {
  return revokeChallenges(userId, PURPOSE);
}

// ---------------------------------------------------------------------------
// Route guard
// ---------------------------------------------------------------------------

/**
 * 403 rather than 401, deliberately.
 *
 * The session IS valid — answering 401 would send the client's generic handler
 * to the sign-in page and destroy the session it already has, which is both
 * wrong and the most annoying possible bug on a screen somebody reached because
 * they were worried. `error: 'StepUpRequired'` is the contract the account page
 * keys its re-prompt off; changing that string breaks it.
 */
export function stepUpRequired(): NextResponse {
  return NextResponse.json(
    {
      error: 'StepUpRequired',
      message: 'Confirm it is you before continuing.',
    },
    { status: 403 },
  );
}

/**
 * The cookie carrying elevation, or undefined.
 *
 * Tolerates a missing request object entirely. A guard is the wrong place to
 * throw: a handler invoked without a request — which route tests do, and which a
 * future refactor could reintroduce — must come out UNELEVATED, not crash with a
 * 500 that reads as a server fault rather than a refusal.
 */
export function readStepUpCookie(
  req: { cookies?: { get?: (name: string) => { value?: string } | undefined } } | undefined,
): string | undefined {
  return req?.cookies?.get?.(STEP_UP_COOKIE)?.value;
}

/**
 * Guard for a sensitive route. Returns a 403 to return, or null to proceed.
 *
 * Leaves the window open — see `requireStepUpOnce` for the irreversible case.
 */
export async function requireStepUp(
  req: Parameters<typeof readStepUpCookie>[0],
  userId: string,
): Promise<NextResponse | null> {
  if (await hasStepUp(readStepUpCookie(req), userId)) return null;
  return (await hasAnyStepUpFactor(userId)) ? stepUpRequired() : null;
}

/** Guard that CONSUMES the elevation. For actions with no undo. */
export async function requireStepUpOnce(
  req: Parameters<typeof readStepUpCookie>[0],
  userId: string,
): Promise<NextResponse | null> {
  if (await spendStepUp(readStepUpCookie(req), userId)) return null;
  return (await hasAnyStepUpFactor(userId)) ? stepUpRequired() : null;
}

/**
 * A GUARD NOBODY CAN SATISFY IS A LOCKOUT, so both guards above stand down for
 * an account that holds no re-presentable factor.
 *
 * That population is real and specific: a contact who claimed a standby role is
 * minted by `upsertUser` with no TOTP secret, and a passkey is stage two and
 * deferrable. They can still reach `/account`, and the promise on the privacy
 * page is that anybody can close their account and take their data out. Refusing
 * a person the ability to delete their own account because they cannot answer a
 * prompt they were never given would break that promise to protect a vault they
 * do not have.
 *
 * Nor would it protect anything. Their session was minted from a single-use code
 * and is worth exactly that; asking them to re-present nothing is theatre. The
 * moment they add a passkey — the one factor they can add — this engages, and
 * every owner has held a TOTP secret since signup existed.
 *
 * It FAILS CLOSED on error: an unreadable factor list is treated as "they have
 * one", so a database blip demands elevation rather than waiving it.
 */
async function hasAnyStepUpFactor(userId: string): Promise<boolean> {
  try {
    const f = await availableStepUpFactors(userId);
    return f.totp || f.passkey;
  } catch {
    return true;
  }
}

/**
 * Attaches elevation to a response.
 *
 * `secure` is conditional on the deployment being https, because a cookie marked
 * secure is silently dropped on plain http and `npm run dev` would then look
 * like a broken step-up prompt that never takes. Production is https, so the
 * flag is set where it counts. `sameSite: strict` because nothing cross-site
 * has any business presenting elevation.
 */
export function attachStepUp(res: NextResponse, token: string): NextResponse {
  res.cookies.set(STEP_UP_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureOrigin(),
    path: '/',
    maxAge: STEP_UP_TTL_SECONDS,
  });
  return res;
}

/** Removes it — used when elevation is spent or refused. */
export function clearStepUp(res: NextResponse): NextResponse {
  res.cookies.set(STEP_UP_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

// ---------------------------------------------------------------------------
// Which factors this account can actually re-present
// ---------------------------------------------------------------------------

export interface StepUpFactors {
  /** An authenticator app secret of their own — every self-serve signup has one. */
  totp: boolean;
  /** At least one registered passkey. */
  passkey: boolean;
}

/**
 * What the prompt should offer.
 *
 * A CONTACT WHO CLAIMED A STANDBY ROLE HAS NEITHER at first: they are minted by
 * `upsertUser` with no TOTP secret and passkeys are stage two and deferrable.
 * Their account also has no vault, no recovery sheet and nothing to export, so
 * the sensitive screens are empty for them — but a guard that cannot be
 * satisfied is a lockout, so the routes are explicit about that case rather than
 * leaving somebody stuck in front of a prompt they cannot answer.
 */
export async function availableStepUpFactors(userId: string): Promise<StepUpFactors> {
  const [u, c] = await Promise.all([
    query<{ totp_secret: string | null }>(`SELECT totp_secret FROM users WHERE id = $1 LIMIT 1`, [
      userId,
    ]),
    query<{ one: number }>(
      `SELECT 1 AS one FROM webauthn_credentials WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
  ]);

  return {
    totp: Boolean(u?.rows?.[0]?.totp_secret),
    passkey: (c?.rows?.length ?? 0) > 0,
  };
}
