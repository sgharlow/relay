/**
 * POST /api/fire-drill/ack — "I got this".
 *
 * The verifier's half of the rehearsal, and the only place in this product where
 * a HUMAN, rather than a mail provider, tells us they were reached.
 *
 * IT REQUIRES A SESSION, DELIBERATELY. A bare link that recorded an
 * acknowledgement on being clicked would be forgeable by anyone holding the URL
 * and would happily record a pass from a mail scanner that prefetched it — a
 * false green built to look like the cure for false greens. The whole feature is
 * worth nothing if this endpoint can be satisfied by anything other than the
 * person signing in.
 *
 * One press answers every owner still waiting to hear from this person; asking
 * somebody to acknowledge the same thing three times is how a rehearsal stops
 * being run.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { acknowledgePendingDrills } from '../../../../../lib/release/fire-drill';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Authenticates a USER — the caller here is a verifier signed into their own
  // standby account, not the owner of a vault. See the note on requireOwner.
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  try {
    const acknowledged = await acknowledgePendingDrills(auth.ownerId);
    return NextResponse.json({ acknowledged });
  } catch (err) {
    return mapError(err);
  }
}
