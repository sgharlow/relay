/**
 * POST /api/triggers/[id]/confirm — Verifier confirmation.
 *
 * Auth: a scoped verifier JWT (Authorization: Bearer, or `verifier_token` in the
 * body) whose `releaseStateId` must match the path id. Idempotent. On reaching
 * quorum with an elapsed grace window the release advances to RELEASED; if the
 * grace window is still open the owner is notified (Req 6.6).
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.3, 6.4, 6.5, 6.6, 6.9
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyVerifierToken } from '../../../../../../lib/auth/verifier-token';
import { submitConfirmation, TriggerError } from '../../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';
import { notifyOwnerReleasePendingGraceById } from '../../../../../../lib/notify/notifications';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { verifier_token?: string; method?: string };

  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : body.verifier_token;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Verifier token required' }, { status: 401 });
  }

  let payload;
  try {
    payload = verifyVerifierToken(token);
  } catch {
    return NextResponse.json({ error: 'Forbidden', message: 'Invalid verifier token' }, { status: 403 });
  }

  // The token is scoped to one release_state — it must match the path.
  if (payload.releaseStateId !== params.id) {
    return NextResponse.json({ error: 'Forbidden', message: 'Token not scoped to this release' }, { status: 403 });
  }

  let outcome;
  try {
    outcome = await submitConfirmation({
      releaseStateId: payload.releaseStateId,
      verifierId: payload.verifierId,
      method: body.method,
      machine: new ReleaseStateMachine(),
      now: new Date(),
    });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  // Quorum met but grace still open → notify the owner (best-effort, Req 6.6).
  if (outcome.status === 'pending_grace' && outcome.ownerId) {
    await notifyOwnerReleasePendingGraceById(outcome.ownerId, outcome.triggerType);
  }

  return NextResponse.json({
    status: outcome.status,
    received: outcome.receivedConfirmations,
    required: outcome.requiredConfirmations,
  });
}
