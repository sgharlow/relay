/**
 * GET /api/people — one list, roles as attributes (J4-R1).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { listPeople } from '../../../../lib/people/people';

/**
 * Takes no request argument, so Next tries to prerender it at build time —
 * which means running a query with no session against no database. That made
 * the build depend on the cluster being reachable and on credentials being
 * present, which is why it failed the first time CI ran it on a clean machine
 * and passed on every developer laptop with a .env.local.
 *
 * The route was already dynamic in the built output; this makes the build
 * hermetic rather than changing what ships.
 */
export const dynamic = 'force-dynamic';


export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json({ people: await listPeople(auth.ownerId) });
}
