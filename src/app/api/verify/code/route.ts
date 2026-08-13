/**
 * POST /api/verify/code — exchange a typed code for a verifier session.
 *
 * The code replaces a JWT that used to travel in the confirmation URL. On
 * success this mints exactly that JWT, so everything downstream — the decision
 * surface, the confirmation endpoint — is unchanged. The code is only a safer
 * way to obtain the same thing.
 *
 * PUBLIC AND UNAUTHENTICATED by necessity: a verifier has no account (J7-R1).
 * The defences are a short-lived high-entropy secret, per-code lockout, per-IP
 * throttling, and the fact that a verifier token grants no sight of any vault
 * contents — only the ability to answer one question.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  redeemVerifierCode,
  recordFailedAttempt,
  VerifierCodeError,
} from '../../../../../lib/auth/verifier-code';
import { issueVerifierToken } from '../../../../../lib/auth/verifier-token';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../../lib/http/owner-route';

/** Ten tries an hour is generous for typing and far too slow to guess with. */
const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'vcode'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const parsed = await readJson(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as { code?: unknown };

  const code = typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) {
    return NextResponse.json({ error: 'BadRequest', message: 'Enter the code from your email.' }, { status: 400 });
  }

  try {
    const { verifierId, releaseStateId } = await redeemVerifierCode(code);
    return NextResponse.json({ token: await issueVerifierToken(verifierId, releaseStateId) });
  } catch (err) {
    if (err instanceof VerifierCodeError) {
      // Count the miss against the code itself, so a targeted attack on one
      // known code is throttled even from rotating addresses. Only meaningful
      // when the code exists; the helper is silent otherwise.
      if (err.reason === 'invalid') await recordFailedAttempt(code);

      return NextResponse.json(
        { error: 'VerifierCodeError', reason: err.reason, message: err.message },
        { status: err.reason === 'locked' ? 429 : 400 },
      );
    }
    throw err;
  }
}
