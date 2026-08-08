/**
 * POST /api/invitations — invite a recipient or verifier to claim their role
 * before any trigger fires (J4-R9).
 *
 * Returns the claim URL. Only a hash of the token is persisted, so this
 * response is the one and only time the token exists in readable form.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R11
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { assertOwns } from '../../../../lib/db/integrity';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { createInvitation, type PersonType } from '../../../../lib/people/invitations';
import { ValidationError } from '../../../../lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { personId, personType } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof personId !== 'string') {
      throw new ValidationError('personId is required', 'personId');
    }
    if (personType !== 'recipient' && personType !== 'verifier') {
      throw new ValidationError('personType must be recipient or verifier', 'personType');
    }

    // DSQL has no FKs — confirm the person belongs to this owner (R16.1).
    await assertOwns(auth.ownerId, personType === 'recipient' ? 'recipients' : 'verifiers', personId);

    const { token, expiresAt } = await createInvitation(auth.ownerId, {
      personId,
      personType: personType as PersonType,
    });

    await writeAuditEntry(auth.ownerId, {
      actor: `owner:${auth.ownerId}`,
      action: 'invitation_created',
      entity: personType === 'recipient' ? 'recipient' : 'verifier',
      entityId: personId,
      detail: { personType, expiresAt },
    });

    const base = process.env.NEXTAUTH_URL ?? '';
    return NextResponse.json({ claimUrl: `${base}/claim?token=${token}`, expiresAt }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
