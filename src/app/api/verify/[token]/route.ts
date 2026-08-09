/**
 * /api/verify/[token] — the verifier's decision endpoint.
 *
 * GET  → the decision context (counts and categories only)
 * POST → confirm | deny | abstain
 *
 * No account, no password: a signed, scoped verifier token is the whole auth
 * story (J7-R1, J7-R2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1, J7-R2, J7-R3, J7-R5
 */

import { NextResponse, type NextRequest } from 'next/server';

import { verifyVerifierToken } from '../../../../../lib/auth/verifier-token';
import { buildVerifierContext } from '../../../../../lib/release/verifier-context';
import { submitConfirmation, TriggerError } from '../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../lib/release/state-machine';
import { DECISIONS, type Decision } from '../../../../../lib/release/verifier-decision';

type Ctx = { params: Promise<{ token: string }> };

async function payloadOr403(token: string) {
  try {
    // await inside the try, or the rejection escapes and a forged link 500s
    // instead of being quietly refused.
    return await verifyVerifierToken(token);
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const payload = await payloadOr403((await params).token);
  if (!payload) {
    return NextResponse.json({ error: 'Forbidden', message: 'This link is no longer valid' }, { status: 403 });
  }

  try {
    return NextResponse.json(
      await buildVerifierContext(payload.releaseStateId, payload.verifierId),
    );
  } catch (err) {
    // A validly signed link whose release state is gone — the owner deleted
    // their account, or the release was resolved — reads to the holder exactly
    // as a bad link does, and gets the same words. Deliberately indistinguish-
    // able from a forgery: a doctor opening this mid-emergency needs to know
    // the link is no good, not which of the two reasons applies.
    if (err instanceof TriggerError && err.httpStatus === 404) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'This link is no longer valid' },
        { status: 403 },
      );
    }
    // Anything else is a real failure and must stay one. Swallowing it here
    // would show every verifier "your link expired" during an outage while
    // nothing paged anyone.
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const payload = await payloadOr403((await params).token);
  if (!payload) {
    return NextResponse.json({ error: 'Forbidden', message: 'This link is no longer valid' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { decision?: string };
  if (!DECISIONS.includes(body.decision as Decision)) {
    return NextResponse.json(
      { error: 'BadRequest', message: `decision must be one of: ${DECISIONS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const outcome = await submitConfirmation({
      releaseStateId: payload.releaseStateId,
      verifierId: payload.verifierId,
      decision: body.decision as Decision,
      machine: new ReleaseStateMachine(),
      now: new Date(),
    });
    return NextResponse.json({ status: outcome.status });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
