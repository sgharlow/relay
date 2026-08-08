/**
 * GET /api/people — one list, roles as attributes (J4-R1).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { listPeople } from '../../../../lib/people/people';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json({ people: await listPeople(auth.ownerId) });
}
