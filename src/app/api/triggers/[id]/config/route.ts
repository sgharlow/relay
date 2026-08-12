/**
 * PUT /api/triggers/[id]/config — configure a trigger's N-of-M quorum.
 *
 * The `[id]` segment is the TRIGGER TYPE (shares the slug with confirm/cancel/
 * initiate). Body: { required_confirmations: N }. M is the owner's current
 * verifier count; setRequiredConfirmations validates 1 ≤ N ≤ M (Property 8) and
 * provisions/updates the release_state.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.9, 6.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { setRequiredConfirmations } from '../../../../../../lib/release/provisioning';
import { countEligibleVerifiers, assertQuorumSatisfiable } from '../../../../../../lib/release/quorum';
import { query } from '../../../../../../lib/db/connection';
import { getVerifierCount } from '../../../../../../lib/release/release-list';
import { isUserSelectableTriggerType } from '../../../../../../lib/domain/enums';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const triggerType = (await params).id;
  // Configuring an estate trigger's N-of-M is part of arming it, so it is
  // gated with the rest pending g2-counsel-opinion.
  if (!isUserSelectableTriggerType(triggerType)) {
    return NextResponse.json({ error: 'BadRequest', message: 'Unknown trigger type' }, { status: 400 });
  }

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const n = Number((body as { required_confirmations?: unknown }).required_confirmations);

  try {
    // M is who can ACTUALLY answer, not how many roster rows exist. A bare
    // COUNT(*) permits an unsatisfiable quorum -- require 2 from a circle where
    // only 1 person can act and the release simply never completes, with no
    // error anywhere. See lib/release/quorum.ts, including the staging note on
    // why unclaimed verifiers still count today.
    const [verifierRows, recipientRows] = await Promise.all([
      query<{ id: string; claimed_user_id: string | null; standby_state: string | null }>(
        `SELECT id, claimed_user_id, standby_state FROM verifiers WHERE owner_id = $1`,
        [auth.ownerId],
      ),
      query<{ claimed_user_id: string | null }>(
        `SELECT DISTINCT r.claimed_user_id
           FROM recipients r
           JOIN access_rules ar ON ar.recipient_id = r.id
          WHERE ar.owner_id = $1 AND ar.trigger_type = $2 AND r.claimed_user_id IS NOT NULL`,
        [auth.ownerId, triggerType],
      ),
    ]);

    const m = countEligibleVerifiers(verifierRows.rows, {
      recipientUserIds: recipientRows.rows.map((r) => r.claimed_user_id as string),
      ownerUserId: auth.ownerId,
    });

    assertQuorumSatisfiable(n, m);

    const row = await setRequiredConfirmations(auth.ownerId, triggerType, n, m);
    return NextResponse.json({ required_confirmations: row.required_confirmations, verifier_count: m });
  } catch (err) {
    return mapError(err);
  }
}
