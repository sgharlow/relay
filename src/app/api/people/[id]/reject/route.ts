/**
 * POST /api/people/[id]/reject — the phrase did not match (sprint plan N14).
 *
 * A separate route from `/confirm` rather than another verb on it, because the
 * two outcomes are not variations of each other. DELETE /confirm withdraws an
 * assertion the owner made earlier and leaves the person holding their slot;
 * this severs the binding entirely and treats the ticket channel as
 * compromised. Collapsing them behind one verb would make it possible to fire
 * the wrong one by getting a flag wrong.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { assertOwns } from '../../../../../../lib/db/integrity';
import { rejectClaim } from '../../../../../../lib/people/fingerprint';
import { ValidationError } from '../../../../../../lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const personType = (body as Record<string, unknown>)?.personType;

  try {
    if (personType !== 'recipient' && personType !== 'verifier') {
      throw new ValidationError('personType must be recipient or verifier', 'personType');
    }

    await assertOwns(
      auth.ownerId,
      personType === 'recipient' ? 'recipients' : 'verifiers',
      (await params).id,
    );

    await rejectClaim({
      ownerId: auth.ownerId,
      personId: (await params).id,
      personType,
    });

    return NextResponse.json({ rejected: true });
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
