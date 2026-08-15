/**
 * POST /api/fire-drill — rehearse, in calm, with the people who would be asked.
 *
 * The owner-facing half of `lib/release/fire-drill.ts`. Read that file's header
 * for why an acknowledgement is the only reachability evidence this product can
 * actually produce, and why the drill is offered exclusively to verifiers who
 * can already sign in.
 *
 * ⚠️ THE RESPONSE NAMES THE PEOPLE IT DID NOT MAIL, and that is the more useful
 * half. A verifier who cannot answer a drill is a verifier who cannot answer a
 * release either; surfacing that as a named gap in calm is the entire point.
 *
 * Rate-limited on the account, like `/api/invitations`, because this is a second
 * route where an authenticated caller chooses the recipients of mail Relay sends
 * from its own domain — bounded by the roster, but a roster can be refilled.
 *
 * Feature: relay-standby
 * Requirements: J4-R13, J7-R5
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse, mapError } from '../../../../lib/http/owner-route';
import { rateLimit } from '../../../../lib/http/rate-limit';
import { runFireDrill } from '../../../../lib/release/fire-drill';

/** A rehearsal is not something anybody needs to run twice in an hour. */
const DRILL_BURST_LIMIT = 3;
const DRILL_BURST_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const limited = rateLimit(`fire-drill:${auth.ownerId}`, DRILL_BURST_LIMIT, DRILL_BURST_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: 'Too many requests',
        message:
          'You have run a few practice runs already. Give the people you named a chance to ' +
          'answer the last one before sending another.',
      },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const result = await runFireDrill(auth.ownerId);
    return NextResponse.json(result);
  } catch (err) {
    return mapError(err);
  }
}
