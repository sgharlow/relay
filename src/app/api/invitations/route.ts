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
import { ValidationError } from '../../../../lib/validation';
import { inviteAndNotify } from '../../../../lib/people/invite';
import type { PersonType } from '../../../../lib/people/invitations';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { personId, personType, deliveryChannel } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof personId !== 'string') {
      throw new ValidationError('personId is required', 'personId');
    }
    if (personType !== 'recipient' && personType !== 'verifier') {
      throw new ValidationError('personType must be recipient or verifier', 'personType');
    }

    // DSQL has no FKs — confirm the person belongs to this owner (R16.1).
    await assertOwns(auth.ownerId, personType === 'recipient' ? 'recipients' : 'verifiers', personId);

    // Recorded on the invitation row, which is what makes Phase 0 readable: an
    // invitation with no channel cannot be attributed to an arm, and every
    // invitation the product issued carried none until 2026-08-12.
    const channel = deliveryChannel === 'owner' ? 'owner' : 'email';

    const { claimUrl, expiresAt, emailDelivered, claimCode } = await inviteAndNotify(
      auth.ownerId,
      personId,
      personType as PersonType,
      channel,
    );

    await writeAuditEntry(auth.ownerId, {
      actor: `owner:${auth.ownerId}`,
      action: 'invitation_created',
      entity: personType === 'recipient' ? 'recipient' : 'verifier',
      entityId: personId,
      detail: { personType, expiresAt },
    });

    // `claimCode` goes back to the owner deliberately: only a hash is stored, so
    // this response is the one moment it is readable, and the owner delivering it
    // by voice is the channel this architecture actually trusts.
    return NextResponse.json(
      { claimUrl, expiresAt, emailDelivered, claimCode, deliveryChannel: channel },
      { status: 201 },
    );
  } catch (err) {
    return mapError(err);
  }
}
