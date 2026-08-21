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
 * 🔴 STANDING DOWN DID NOT COUNT AS BEING ALIVE, corrected 2026-08-21. This
 * called `requireOwner()` with no argument, so no liveness was recorded ([A4]),
 * and `standDownTrigger` does not stamp `last_active_at` either — only
 * `processCheckin` does. The consequence only appears on the path nobody walked:
 * a release the CRON armed, rather than one the owner started.
 *
 * The owner goes quiet past their interval. The sweep arms ARMED→PENDING→GRACE
 * and emails them and every verifier. They come back, see the card, and press
 * the prominent, default, correct control — "Stand down — re-arm". The row
 * returns to ARMED and `last_active_at` is untouched, so at the top of the next
 * hour they are still overdue, `runHeartbeatSweep` finds the same ARMED row and
 * arms it again, and every verifier is asked a second time whether this person
 * is incapacitated. Hourly, until they happened to press the OTHER button.
 *
 * J5's preamble names this exact failure as the one that destroys the product:
 * a false PENDING costs the verifiers' willingness to answer the real one.
 * Standing down a false alarm is the strongest "I am here" the product can
 * observe, so it is recorded as one.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.3, 4.5, 4.2, J5-R1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../../lib/http/owner-route';
import { standDownTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  // `req` is passed for the liveness stamp, not for a body — see the header.
  const auth = await requireOwner(req);
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
