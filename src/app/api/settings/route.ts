/**
 * PUT /api/settings — update the owner's check-in cadence (Req 4.1).
 * Body: { checkin_interval_days: number } (1–365).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { updateCheckinInterval } from '../../../../lib/release/release-list';

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const days = await updateCheckinInterval(auth.ownerId, Number((body as { checkin_interval_days?: unknown }).checkin_interval_days));
    return NextResponse.json({ checkin_interval_days: days });
  } catch (err) {
    return mapError(err);
  }
}
