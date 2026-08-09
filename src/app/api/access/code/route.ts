/**
 * POST /api/access/code — exchange a typed code for a recipient session.
 *
 * Mints the same recipient JWT the emailed link used to carry, so everything
 * downstream is unchanged. The code is only a safer way to obtain it: nothing
 * lands in browser history, referrer headers or proxy logs, and a forwarded
 * email no longer hands over access to a family member's credentials.
 *
 * A code whose release has since been re-armed returns `closed`, so the client
 * can show the graceful close rather than an error. The recipient did nothing
 * wrong — the good outcome happened.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1, J9-R4
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  redeemRecipientCode,
  recordFailedAttempt,
  RecipientCodeError,
} from '../../../../../lib/auth/recipient-code';
import { issueRecipientToken } from '../../../../../lib/auth/recipient-token';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';

const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'rcode'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  let body: { code?: unknown };
  try {
    body = (await req.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid request.' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) {
    return NextResponse.json({ error: 'BadRequest', message: 'Enter the code from your email.' }, { status: 400 });
  }

  try {
    const { recipientId, releaseStateId, version } = await redeemRecipientCode(code);
    return NextResponse.json({
      token: await issueRecipientToken(recipientId, releaseStateId, BigInt(version)),
    });
  } catch (err) {
    if (err instanceof RecipientCodeError) {
      if (err.reason === 'invalid') await recordFailedAttempt(code);
      return NextResponse.json(
        { error: 'RecipientCodeError', reason: err.reason, message: err.message },
        { status: err.reason === 'locked' ? 429 : 400 },
      );
    }
    throw err;
  }
}
