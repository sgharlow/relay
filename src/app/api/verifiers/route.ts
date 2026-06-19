/**
 * /api/verifiers — Owner verifiers collection (GET list, POST create).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.2
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listVerifiers, createVerifier, validateVerifierInput } from '../../../../lib/people/verifiers';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json({ verifiers: await listVerifiers(auth.ownerId) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateVerifierInput(body);
    const verifier = await createVerifier(auth.ownerId, input);
    return NextResponse.json(verifier, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
