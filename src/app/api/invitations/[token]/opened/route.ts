/**
 * POST /api/invitations/[token]/opened — the claim page loaded with this code.
 *
 * The middle of the Phase 0 funnel. Without it, "never arrived" and "arrived and
 * abandoned" are the same number, and they are different problems with different
 * fixes.
 *
 * Deliberately unauthenticated and deliberately silent: it always answers 204,
 * whether or not the code exists. Answering differently would turn a measurement
 * endpoint into an oracle for guessing invitation codes.
 *
 * Feature: relay-standby
 * Requirements: J4-R9
 */

import { NextResponse, type NextRequest } from 'next/server';

import { markInvitationOpened } from '../../../../../../lib/people/invitations';

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  await markInvitationOpened((await params).token);
  return new NextResponse(null, { status: 204 });
}
