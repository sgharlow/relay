/**
 * GET /api/approvals — the owner's pending delegate proposals (J3-R6).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { listPendingApprovals } from '../../../../lib/people/approvals';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json({ approvals: await listPendingApprovals(auth.ownerId) });
}
