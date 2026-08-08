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
import { query } from '../../../../../../lib/db/connection';
import { notifyRequesterOfOutcome } from '../../../../../../lib/notify/notifications';

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

    const result = await respondToChallenge({
      requestId: params.id,
      ownerId: auth.ownerId,
      response,
      machine: new ReleaseStateMachine(),
      now: new Date(),
    });

    // Tell the requester either way. A dead-end is its own failure (J6-R10).
    const ctx = await query<{ email: string; name: string; case_id: string }>(
      `SELECT r.email, r.name, ar.case_id
         FROM access_requests ar
         JOIN recipients r ON r.id = ar.recipient_id
        WHERE ar.id = $1 AND ar.owner_id = $2
        LIMIT 1`,
      [params.id, auth.ownerId],
    );
    const owner = await query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 LIMIT 1`,
      [auth.ownerId],
    );

    if (ctx.rows[0]) {
      await notifyRequesterOfOutcome({
        to: ctx.rows[0].email,
        name: ctx.rows[0].name,
        outcome: result.status,
        ownerLabel: owner.rows[0]?.email ?? 'They',
        caseId: ctx.rows[0].case_id,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return mapError(err);
  }
}
