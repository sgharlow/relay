/**
 * /api/verify — the verifier's decision endpoint for somebody who is SIGNED IN.
 *
 * GET  → the decision context (counts and categories, never titles or content)
 * POST → confirm | deny | abstain
 *
 * The sibling `/api/verify/[token]` is unchanged and stays permanently: J7-R1
 * (amended 2026-08-12) guarantees no enrolment step at decision time, so a
 * verifier who never claimed still decides via a single-use code. This is the
 * claimed verifier's door, not a replacement for theirs.
 *
 * `buildVerifierContext` and `submitConfirmation` are untouched — both already
 * took a plain `releaseStateId` + `verifierId`, and the token was only ever how
 * those two ids were obtained. One authorization core, two doors, which is the
 * same split already applied to recipient decrypt and the closure summary.
 *
 * ⚠️ `requireOwner()` IS CALLED WITHOUT `req`, DELIBERATELY (§3.7 rule 8).
 * Passing it records deliberate activity, and answering someone else's emergency
 * must not extend the verifier's OWN dead-man's-switch. `/api/standby/leave`
 * makes the same choice for the same reason.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R3, J7-R5, J4-R9
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { resolveVerifierFor } from '../../../../lib/release/verifier-session';
import { buildVerifierContext } from '../../../../lib/release/verifier-context';
import { submitConfirmation, TriggerError } from '../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../lib/release/state-machine';
import { DECISIONS, type Decision } from '../../../../lib/release/verifier-decision';

/**
 * There is no link on this path, so the token route's "This link is no longer
 * valid" would be a lie of the same kind the graceful close was written to
 * remove. It says what actually happened.
 */
const NOTHING_OPEN = {
  error: 'Forbidden',
  message: 'There is no decision waiting for you right now.',
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const releaseStateId = req.nextUrl.searchParams.get('release') ?? undefined;
  const resolved = await resolveVerifierFor(auth.ownerId, { releaseStateId });
  if (!resolved) return NextResponse.json(NOTHING_OPEN, { status: 403 });

  try {
    return NextResponse.json(
      await buildVerifierContext(resolved.releaseStateId, resolved.verifierId),
    );
  } catch (err) {
    // A release that vanished between resolve and render reads as "nothing
    // waiting", exactly as the token path collapses a deleted release into its
    // own generic refusal. Anything else is a real failure and must stay one.
    if (err instanceof TriggerError && err.httpStatus === 404) {
      return NextResponse.json(NOTHING_OPEN, { status: 403 });
    }
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    decision?: string;
    releaseStateId?: string;
  };
  if (!DECISIONS.includes(body.decision as Decision)) {
    return NextResponse.json(
      { error: 'BadRequest', message: `decision must be one of: ${DECISIONS.join(', ')}` },
      { status: 400 },
    );
  }

  // Re-resolved rather than trusting anything the client sent. The id in the
  // body only narrows WHICH open release; whether this user may answer it at all
  // is decided here, against the row, on this request.
  const resolved = await resolveVerifierFor(auth.ownerId, {
    releaseStateId: body.releaseStateId,
  });
  if (!resolved) return NextResponse.json(NOTHING_OPEN, { status: 403 });

  try {
    const outcome = await submitConfirmation({
      releaseStateId: resolved.releaseStateId,
      verifierId: resolved.verifierId,
      decision: body.decision as Decision,
      machine: new ReleaseStateMachine(),
      now: new Date(),
    });
    return NextResponse.json({ status: outcome.status });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json(
        { error: 'TriggerError', message: err.message },
        { status: err.httpStatus },
      );
    }
    throw err;
  }
}
