/**
 * POST /api/triggers/[id]/initiate — Owner fires a trigger (ARMED → PENDING).
 *
 * The `[id]` dynamic segment here carries the TRIGGER TYPE (it shares Next.js's
 * slug name with the sibling confirm and stand-down routes, which use it as a
 * release_state id — Next forbids differing slug names at one path position).
 * /cancel was a third such sibling until it was retired on 2026-08-21.
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
import {
  notifyVerifiersForTrigger,
  toVerifierContact,
} from '../../../../../../lib/notify/notifications';
import { isUserSelectableTriggerType } from '../../../../../../lib/domain/enums';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const triggerType = (await params).id; // [id] carries the trigger type for initiate
  // This is the route that FIRES a release, and an estate release is permanent
  // by design (Property 7) with no correction path. estate is withdrawn from the
  // product permanently (g2-counsel-opinion declined 2026-08-14); this is defence
  // in depth behind the creation gate, so a rule predating that decision still
  // cannot be fired.
  if (!isUserSelectableTriggerType(triggerType)) {
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
    verifiers.map(toVerifierContact),
    triggerType,
    row.id,
    auth.ownerId,
  );

  return NextResponse.json({ state: row.state, releaseStateId: row.id, verifiersNotified: notified });
}
