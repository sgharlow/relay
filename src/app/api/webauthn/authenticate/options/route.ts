/**
 * POST /api/webauthn/authenticate/options — start signing in with a passkey.
 *
 * Deliberately UNAUTHENTICATED and deliberately identifier-free. Discoverable
 * credentials mean the browser offers the right passkey and the person types
 * nothing — which matters most for the contact who may act once in five years.
 *
 * It also means this endpoint reveals nothing: it takes no email, looks nothing
 * up, and returns the same shape to everyone. There is no account to enumerate.
 *
 * RATE LIMITED SINCE 2026-08-15, because sealing a challenge now WRITES a nonce
 * row (single-use challenges, migration 029). Before that this endpoint was pure
 * computation and hammering it cost nothing; now each call inserts a row that
 * lives five minutes. The limit is generous for the real client — a browser that
 * offers a passkey picker, gets it dismissed, and tries again — and bounds an
 * unauthenticated write. It is not a security boundary (see rate-limit.ts) and
 * is not the only bound: rows are tiny, expire on a clock, and are swept.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { NextResponse, type NextRequest } from 'next/server';

import { beginAuthentication, sealChallenge } from '../../../../../../lib/auth/webauthn';
import { rateLimit, clientKey } from '../../../../../../lib/http/rate-limit';

const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = rateLimit(clientKey(req.headers, 'webauthn-auth'), LIMIT, WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'TooManyRequests', message: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const { options, challenge } = await beginAuthentication();

  return NextResponse.json({
    options,
    challengeToken: await sealChallenge(challenge, 'authentication'),
  });
}
