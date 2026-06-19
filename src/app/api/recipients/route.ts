/**
 * /api/recipients — Owner recipients collection (GET list, POST create).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listRecipients, createRecipient, validateRecipientInput } from '../../../../lib/people/recipients';

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
    const recipient = await createRecipient(auth.ownerId, input);
    return NextResponse.json(recipient, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
