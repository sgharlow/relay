/**
 * PUT /api/checkin — Owner heartbeat.
 *
 * Records activity and reverses any reversible trigger from PENDING/GRACE back
 * to ARMED. If an estate trigger is mid-release (PENDING/GRACE) it cannot be
 * reversed → 409 with an explicit message (Req 4.5).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.2, 4.5
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { processCheckin } from '../../../../lib/release/heartbeat';
import { ReleaseStateMachine } from '../../../../lib/release/state-machine';

export async function PUT(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const result = await processCheckin(auth.ownerId, new ReleaseStateMachine());

  if (result.blocked.length > 0) {
    return NextResponse.json(
      {
        error: 'IrreversibleRelease',
        message: `Release cannot be reversed for: ${result.blocked.join(', ')}`,
        reset: result.reset,
        blocked: result.blocked,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ checkedIn: true, reset: result.reset });
}
