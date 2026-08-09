/**
 * POST /api/invitations/[token] — redeem an invitation.
 *
 * A recipient sees the SHAPE of their future grant: counts and categories,
 * never titles, never content (J4-R10). A verifier claims with no account at
 * all (J4-R11).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { NextResponse, type NextRequest } from 'next/server';

import { redeemInvitation, buildStandbyView } from '../../../../../lib/people/invitations';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { ValidationError } from '../../../../../lib/validation';

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const claim = await redeemInvitation((await params).token);

    await writeAuditEntry(claim.ownerId, {
      actor: `${claim.personType}:${claim.personId}`,
      action: 'invitation_claimed',
      entity: claim.personType,
      entityId: claim.personId,
      detail: { personType: claim.personType },
    });

    if (claim.personType === 'verifier') {
      // Verifiers hold no grant and must never see vault shape (R6.8).
      return NextResponse.json({ personType: 'verifier', claimed: true });
    }

    return NextResponse.json({
      personType: 'recipient',
      claimed: true,
      standby: await buildStandbyView(claim.ownerId, claim.personId),
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    throw err;
  }
}
