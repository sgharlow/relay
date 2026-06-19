/**
 * POST /api/triggers/[id]/notify — re-send recipient access links for a RELEASED
 * trigger. `[id]` = release_state id. Owner-authenticated.
 *
 * Recipients are auto-notified the moment a release reaches RELEASED (in the
 * confirmation path); this endpoint re-issues those links on demand.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, 15.2
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../../lib/http/owner-route';
import { resendReleaseNotifications, TriggerError } from '../../../../../../lib/release/triggers';

type Ctx = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    const notified = await resendReleaseNotifications(auth.ownerId, params.id);
    return NextResponse.json({ notified });
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
