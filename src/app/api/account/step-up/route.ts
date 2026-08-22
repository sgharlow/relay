/**
 * /api/account/step-up — prove it is still you.
 *
 * GET  — is this session elevated, and which factors can this account present?
 * POST — present a factor; on success the response carries the elevation cookie.
 * DELETE — drop elevation now (sign-out, or "I am done on this machine").
 *
 * THE FACTOR IS THE ONE THEY SIGNED IN WITH, presented again. TOTP for an owner,
 * a passkey for anyone who registered one. A RECOVERY CODE IS DELIBERATELY NOT
 * ACCEPTED: recovery codes are among the things step-up protects, so accepting
 * one to authorise issuing new ones is a circle, and somebody who is already
 * inside the account does not need a way back in.
 *
 * FAILURES ARE INDISTINGUISHABLE. A wrong code, an account with no secret, an
 * expired passkey challenge and a replayed one all answer the same 400. The
 * caller is already authenticated, so there is no account to enumerate here —
 * but the same discipline is kept because the alternative is a probe that tells
 * somebody which factor to attack.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J13-R1, J13-R2
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { rateLimit } from '../../../../../lib/http/rate-limit';
import { ValidationError } from '../../../../../lib/validation';
import {
  mintStepUp,
  hasStepUp,
  revokeStepUp,
  readStepUpCookie,
  attachStepUp,
  clearStepUp,
  availableStepUpFactors,
  STEP_UP_TTL_SECONDS,
} from '../../../../../lib/auth/step-up';
import { validateTotpCodeFor } from '../../../../../lib/auth/totp';
import { openChallenge, finishAuthentication } from '../../../../../lib/auth/webauthn';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { query } from '../../../../../lib/db/connection';

/** Reads a session and a cookie, so it must never be prerendered. */
export const dynamic = 'force-dynamic';

/**
 * Six attempts per five minutes. A person mistypes a six-digit code once or
 * twice; a script does not stop. Bounded per account rather than per IP because
 * the caller is authenticated, so the account is the thing worth protecting and
 * the thing an attacker cannot rotate.
 */
const ATTEMPT_LIMIT = 6;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Did this error mean "the factor did not check out", or did something break?
 *
 * 🔴 IT USED TO BE ONE UNANCHORED REGEX, AND IT MATCHED `ECONNREFUSED`.
 * The test was `/challenge|expired|used|verified|jwt|signature/i` against the
 * error MESSAGE, and `ECONNREFUSED` ends in the letters `used` — so the single
 * most common database and network error string in this stack was classified as
 * a failed proof. An owner trying to elevate during an outage was told *"That
 * did not match. Try again."*: the product blaming a person for its own fault,
 * on the screen in front of export, recovery-code reissue and account closure —
 * and the operator seeing a rise in step-up refusals rather than an outage.
 * Found on 2026-08-22 by the first test ever written against this handler, which
 * asserted an infrastructure error is NOT swallowed and went red.
 *
 * That half fails in the SAFE direction — a refusal, never an elevation — which
 * is why it survived: nothing an owner could report distinguishes it from a
 * mistyped code. That is what made it invisible, not what made it harmless.
 *
 * 🔴 AND THE SAME LINE BROKE THE HEADER'S OTHER PROMISE, in the direction that
 * is NOT safe. `finishAuthentication` refuses an unknown credential with *"That
 * passkey is not recognised."*, which matches none of those six words — so it
 * fell through to `mapError` and answered
 * `{error:"ValidationError", message:"That passkey is not recognised.",
 * field:"response"}` instead of the flat `StepUpFailed`. The header three
 * paragraphs above says in terms that a wrong code, an account with no secret,
 * an expired passkey challenge and a replayed one "all answer the same 400 …
 * because the alternative is a probe that tells somebody which factor to
 * attack". One of the four told them. The guarantee was stated in prose, was
 * carried by a word list nobody could check against the messages it had to
 * cover, and was false from the day it was written.
 *

 * STRUCTURE FIRST, STRING LAST. Both modules behind this path refuse with a
 * typed `ValidationError` — `openChallenge` for a replayed, expired or
 * misrouted nonce, `finishAuthentication` for an unrecognised or unverified
 * passkey — so the common cases are decided by TYPE and no longer by prose that
 * a library is free to reword. `jose` stamps every verification failure with an
 * `ERR_JW*`/`ERR_JOSE*` code. A `SyntaxError` is the client's own `response`
 * string failing to parse, which is a malformed proof and not a server fault;
 * it used to fall through to a 500.
 *
 * The message test remains as the backstop for `@simplewebauthn`'s internal
 * throws, which are plain `Error`s — but WORD-ANCHORED, which is the whole
 * correction: `\bused\b` cannot match inside `ECONNREFUSED`.
 *
 * ⚠️ The anchored list is still a heuristic and can still be wrong in one
 * direction — a TLS `certificate has expired` would read as a failed proof. That
 * is a refusal during an outage rather than an elevation during one, so it stays
 * on the safe side of the same line; do not widen it to buy tidiness.
 */
function isFailedProof(err: unknown): boolean {
  if (err instanceof ValidationError) return true;
  if (err instanceof SyntaxError) return true;

  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^ERR_(JW|JOSE)/.test(code)) return true;

  return (
    err instanceof Error &&
    /\b(challenge|expired|already used|verified|signature|assertion)\b/i.test(err.message)
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const [elevated, factors] = await Promise.all([
    hasStepUp(readStepUpCookie(req), auth.ownerId),
    availableStepUpFactors(auth.ownerId),
  ]);

  return NextResponse.json({ elevated, factors, windowSeconds: STEP_UP_TTL_SECONDS });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const limited = rateLimit(`step-up:${auth.ownerId}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: 'TooManyRequests',
        message: 'Too many attempts. Wait a few minutes and try again.',
      },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { totpCode, response, challengeToken } = (body ?? {}) as Record<string, unknown>;

  try {
    let proved = false;

    if (typeof totpCode === 'string' && totpCode.trim() !== '') {
      const u = await query<{ totp_secret: string | null }>(
        `SELECT totp_secret FROM users WHERE id = $1 LIMIT 1`,
        [auth.ownerId],
      );
      const secret = u.rows[0]?.totp_secret;
      proved = Boolean(secret) && validateTotpCodeFor(secret as string, totpCode.trim());
    } else if (typeof challengeToken === 'string' && response) {
      const expectedChallenge = await openChallenge(challengeToken, 'authentication');
      const parsed = typeof response === 'string' ? JSON.parse(response) : response;
      const { userId } = await finishAuthentication({
        response: parsed as never,
        expectedChallenge,
      });
      // The assertion proves SOMEBODY holds a registered passkey. It has to be
      // the person whose session this is, or a passkey on any other account
      // would elevate this one.
      proved = userId === auth.ownerId;
    }

    if (!proved) {
      return NextResponse.json(
        { error: 'StepUpFailed', message: 'That did not match. Try again.' },
        { status: 400 },
      );
    }

    const grant = await mintStepUp({ userId: auth.ownerId });

    // Elevation is the moment somebody could take the vault out or lock the
    // owner out of it. The owner reads this chain; it belongs in it.
    await writeAuditEntry(auth.ownerId, {
      actor: `owner:${auth.ownerId}`,
      action: 'step_up_granted',
      entity: 'user',
      entityId: auth.ownerId,
      detail: { factor: typeof totpCode === 'string' && totpCode ? 'totp' : 'passkey' },
    });

    return attachStepUp(
      NextResponse.json({ elevated: true, expiresAt: grant.expiresAt }),
      grant.token,
    );
  } catch (err) {
    // A replayed or expired passkey challenge arrives as a ValidationError from
    // openChallenge and must not be told apart from a wrong code.
    if (isFailedProof(err)) {
      return NextResponse.json(
        { error: 'StepUpFailed', message: 'That did not match. Try again.' },
        { status: 400 },
      );
    }
    return mapError(err);
  }
}

/** Ends elevation everywhere, not just in this browser. */
export async function DELETE(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  await revokeStepUp(auth.ownerId);
  return clearStepUp(NextResponse.json({ elevated: false }));
}
