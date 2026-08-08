/**
 * POST /api/access-requests/[id]/respond — the owner answers the challenge.
 *
 * Deny leaves release_state untouched at ARMED and contacts no verifier.
 * Approve walks the EXISTING ARMED -> PENDING -> GRACE pair; it does not add an
 * eighth transition (J6-R4, J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R4, J6-R5
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { respondToChallenge } from '../../../../../../lib/release/challenge';
import { ReleaseStateMachine } from '../../../../../../lib/release/state-machine';
import { ValidationError } from '../../../../../../lib/validation';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { response } = (body ?? {}) as Record<string, unknown>;

  try {
    if (response !== 'approve' && response !== 'deny') {
      throw new ValidationError('response must be approve or deny', 'response');
    }

    return NextResponse.json(
      await respondToChallenge({
        requestId: params.id,
        ownerId: auth.ownerId,
        response,
        machine: new ReleaseStateMachine(),
        now: new Date(),
      }),
    );
  } catch (err) {
    return mapError(err);
  }
}
