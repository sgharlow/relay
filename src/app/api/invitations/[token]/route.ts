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

import { buildStandbyView } from '../../../../../lib/people/invitations';
import { claimStandbyRole } from '../../../../../lib/people/claim';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { ValidationError } from '../../../../../lib/validation';

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    // If they are already someone here — an owner, or already standing by for
    // somebody else — this claim LINKS a second relationship. Minting a new
    // account would sever every standby link they already hold (§3.7 rule 2).
    // Absence of a session is the normal case, not an error.
    const existing = await getOwnerSession().catch(() => null);

    const claim = await claimStandbyRole({
      token: (await params).token,
      existingUserId: existing?.ownerId,
    });

    if (claim.personType === 'verifier') {
      // Verifiers hold no grant and must never see vault shape (R6.8).
      return NextResponse.json({
        personType: 'verifier',
        claimed: true,
        linkedExisting: claim.linkedExisting,
      });
    }

    return NextResponse.json({
      personType: 'recipient',
      claimed: true,
      linkedExisting: claim.linkedExisting,
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
