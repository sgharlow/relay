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
import { getOwnerLabel } from '../../../../../../lib/people/owner-label';

type Ctx = { params: Promise<{ id: string }> };

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
      requestId: (await params).id,
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
      [(await params).id, auth.ownerId],
    );
    if (ctx.rows[0]) {
      await notifyRequesterOfOutcome({
        to: ctx.rows[0].email,
        name: ctx.rows[0].name,
        outcome: result.status,
        // 🔴 THIS READ THE RAW EMAIL ADDRESS — the exact defect
        // lib/people/owner-label.ts was created to eliminate. It had one
        // remaining caller. A family member who asked for access got
        // "margaret.chen1948@gmail.com has declined", which is the strongest
        // phishing signal left in outbound mail, on the message most likely to
        // be read in distress. getOwnerLabel carries the
        // display_name → email → "Someone you know" precedence, so a family
        // cannot get a name in one message and a raw address in the next.
        ownerLabel: await getOwnerLabel(auth.ownerId),
        caseId: ctx.rows[0].case_id,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return mapError(err);
  }
}
