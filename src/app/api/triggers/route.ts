/**
 * GET /api/triggers — Owner release-state summary for the Triggers screen.
 *
 * Returns the owner's release_state rows, their check-in cadence, and whether
 * this is a demo account (gates the Simulate control).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.1, 5.1, 9.1
 */

import { NextResponse } from 'next/server';
import { getOwnerSession } from '../../../../lib/auth/session';
import { listReleaseStates, getCheckinInterval } from '../../../../lib/release/release-list';

// Authenticated + DB-backed — never statically prerender.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  let ownerId: string;
  let isDemo: boolean;
  try {
    ({ ownerId, isDemo } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  const [releaseStates, checkinIntervalDays] = await Promise.all([
    listReleaseStates(ownerId),
    getCheckinInterval(ownerId),
  ]);

  return NextResponse.json({ releaseStates, checkinIntervalDays, isDemo });
}
