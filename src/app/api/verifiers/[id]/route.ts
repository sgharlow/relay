/**
 * /api/verifiers/[id] — Owner verifier (PUT update, DELETE).
 * DELETE removes verifier_confirmations first (Req 3.7).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.2, 3.7
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { updateVerifier, deleteVerifier, validateVerifierInput } from '../../../../../lib/people/verifiers';

type Ctx = { params: { id: string } };

const NOT_FOUND = { error: 'NotFound', message: 'Verifier not found' };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateVerifierInput(body);
    const updated = await updateVerifier(auth.ownerId, params.id, input);
    if (!updated) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  await deleteVerifier(auth.ownerId, params.id);
  return NextResponse.json({ deleted: true });
}
