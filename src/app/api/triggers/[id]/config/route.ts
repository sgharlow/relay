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
import { getVerifierCount } from '../../../../../../lib/release/release-list';
import { VALID_TRIGGER_TYPES } from '../../../../../../lib/domain/enums';

type Ctx = { params: { id: string } };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const triggerType = params.id;
  if (!VALID_TRIGGER_TYPES.includes(triggerType as never)) {
    return NextResponse.json({ error: 'BadRequest', message: 'Unknown trigger type' }, { status: 400 });
  }

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const n = Number((body as { required_confirmations?: unknown }).required_confirmations);

  try {
    const m = await getVerifierCount(auth.ownerId);
    const row = await setRequiredConfirmations(auth.ownerId, triggerType, n, m);
    return NextResponse.json({ required_confirmations: row.required_confirmations, verifier_count: m });
  } catch (err) {
    return mapError(err);
  }
}
