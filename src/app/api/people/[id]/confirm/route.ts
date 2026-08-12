/**
 * POST /api/people/[id]/confirm — the owner asserts "I spoke to them, the phrase
 * matched", and DELETE — "it did not".
 *
 * This is the entire assurance model: one boolean, set out of band. The DELETE
 * half is the missing mismatch response (sprint plan N14) — a control that
 * detects an interception and then offers nobody a way to act on it is
 * decoration.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { confirmPerson, unconfirmPerson } from '../../../../../../lib/people/fingerprint';
import { ValidationError } from '../../../../../../lib/validation';

type Ctx = { params: Promise<{ id: string }> };

function personTypeOf(v: unknown): 'recipient' | 'verifier' {
  if (v !== 'recipient' && v !== 'verifier') {
    throw new ValidationError('personType must be recipient or verifier', 'personType');
  }
  return v;
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    await confirmPerson({
      ownerId: auth.ownerId,
      personId: (await params).id,
      personType: personTypeOf((body as Record<string, unknown>)?.personType),
    });
    return NextResponse.json({ confirmed: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    return mapError(err);
  }
}

/** The phrase did not match. Back to claimed, and recorded as a mismatch. */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    await unconfirmPerson({
      ownerId: auth.ownerId,
      personId: (await params).id,
      personType: personTypeOf((body as Record<string, unknown>)?.personType),
      reason: 'mismatch',
    });
    return NextResponse.json({ confirmed: false });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    return mapError(err);
  }
}
