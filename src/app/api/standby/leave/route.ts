/**
 * POST /api/standby/leave — resign from a circle, or reject an invitation.
 *
 * Body: `{ personId, personType, reason? }`.
 *
 * A standby account is a free user with rights, and leaving is the most basic of
 * them. The owner's circle DEGRADES rather than shrinking silently: the roster
 * row survives, unbound and red, and their audit chain records which of the two
 * it was — "I do not know this person" may mean an invitation reached the wrong
 * inbox, which is a different thing for an owner to learn than "I am stepping
 * down".
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { resignFromCircle, type LeaveReason } from '../../../../../lib/people/resign';
import { ValidationError } from '../../../../../lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { personId, personType, reason } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof personId !== 'string' || (personType !== 'recipient' && personType !== 'verifier')) {
      throw new ValidationError('personId and personType are required', 'personId');
    }

    await resignFromCircle({
      userId: auth.ownerId,
      personId,
      personType,
      reason: reason === 'rejected' ? ('rejected' as LeaveReason) : ('resigned' as LeaveReason),
    });

    return NextResponse.json({ left: true });
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
