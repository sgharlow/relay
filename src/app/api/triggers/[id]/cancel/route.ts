/**
 * POST /api/triggers/[id]/cancel — Owner cancels a reversible trigger in GRACE.
 *
 * Asserts the release_state belongs to the owner, is in GRACE, and is reversible
 * (non-estate), then transitions GRACE → CANCELLED.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.3
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../../lib/http/owner-route';
import { cancelTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';

type Ctx = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    const row = await cancelTrigger(auth.ownerId, params.id, new ReleaseStateMachine());
    return NextResponse.json({ state: row.state });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
