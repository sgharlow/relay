/**
 * POST /api/triggers/[id]/initiate — Owner fires a trigger (ARMED → PENDING).
 *
 * The `[id]` dynamic segment here carries the TRIGGER TYPE (it shares Next.js's
 * slug name with the sibling confirm/cancel routes, which use it as a
 * release_state id — Next forbids differing slug names at one path position).
 *
 * Asserts the trigger's release_state is ARMED, transitions to PENDING, then
 * emails every verifier a scoped confirmation request (Req 6.2) — best-effort.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.3, 6.2
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../../lib/http/owner-route';
import { initiateTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';
import { listVerifiers } from '../../../../../../lib/people/verifiers';
import { notifyVerifiersForTrigger } from '../../../../../../lib/notify/notifications';
import { VALID_TRIGGER_TYPES } from '../../../../../../lib/rules/access-rules';

type Ctx = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const triggerType = params.id; // [id] carries the trigger type for initiate
  if (!VALID_TRIGGER_TYPES.includes(triggerType as never)) {
    return NextResponse.json({ error: 'BadRequest', message: 'Unknown trigger type' }, { status: 400 });
  }

  let row;
  try {
    row = await initiateTrigger(auth.ownerId, triggerType, new ReleaseStateMachine(), new Date());
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  // Notify verifiers (best-effort) — never lets a mail failure undo the transition.
  const verifiers = await listVerifiers(auth.ownerId);
  const notified = await notifyVerifiersForTrigger(
    verifiers.map((v) => ({ id: v.id, name: v.name, email: v.email })),
    triggerType,
    row.id,
  );

  return NextResponse.json({ state: row.state, releaseStateId: row.id, verifiersNotified: notified });
}
