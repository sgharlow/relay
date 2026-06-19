/**
 * /api/recipients/[id] — Owner recipient (PUT update, DELETE).
 * DELETE cascade-deletes the recipient's access_rules first (Req 3.6).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1, 3.6
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import {
  updateRecipient,
  deleteRecipient,
  validateRecipientInput,
} from '../../../../../lib/people/recipients';

type Ctx = { params: { id: string } };

const NOT_FOUND = { error: 'NotFound', message: 'Recipient not found' };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateRecipientInput(body);
    const updated = await updateRecipient(auth.ownerId, params.id, input);
    if (!updated) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  await deleteRecipient(auth.ownerId, params.id);
  return NextResponse.json({ deleted: true });
}
