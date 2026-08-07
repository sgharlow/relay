/**
 * /api/recipients — Owner recipients collection (GET list, POST create).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listRecipients, createRecipient, validateRecipientInput } from '../../../../lib/people/recipients';
import { assertWithinRecipientCap, EntitlementError } from '../../../../lib/billing/entitlements';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json({ recipients: await listRecipients(auth.ownerId) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateRecipientInput(body);
    // Free-tier cap, asserted server-side (J1-R7).
    await assertWithinRecipientCap(auth.ownerId);
    const recipient = await createRecipient(auth.ownerId, input);
    return NextResponse.json(recipient, { status: 201 });
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: 'EntitlementError', message: err.message, limit: err.limit, tier: err.tier },
        { status: 402 },
      );
    }
    return mapError(err);
  }
}
