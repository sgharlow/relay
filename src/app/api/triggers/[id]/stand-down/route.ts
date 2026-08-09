/**
 * POST /api/triggers/[id]/stand-down — Owner reverses an in-progress release.
 *
 * The false-alarm control. Takes PENDING or GRACE back to ARMED using the
 * reverse edges that already exist in PERMITTED_TRANSITIONS; no new transition
 * is introduced.
 *
 * This is the counterpart to /cancel, and the important difference is that this
 * one is recoverable. CANCELLED is terminal — nothing transitions out of it —
 * so cancelling a false alarm used to retire the access rule permanently.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.3, 4.5
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../../lib/http/owner-route';
import { standDownTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    const row = await standDownTrigger(auth.ownerId, (await params).id, new ReleaseStateMachine());
    return NextResponse.json({ state: row.state });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
