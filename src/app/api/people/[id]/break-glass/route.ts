/**
 * POST /api/people/[id]/break-glass — issue a break-glass code.
 *
 * Returned ONCE, in this response, and never retrievable again: only a hash is
 * stored. The owner writes it down or prints it.
 *
 * This is the one place the architecture knowingly puts a long-lived bearer
 * credential on paper (§8.1). It is bounded — single use, expiry, attempt
 * budget, audited, owner notified on use, and §4.3 keeps a break-glass-only
 * contact out of the count that authorizes a release — and it exists because the
 * alternative is excluding the contact who cannot hold a passkey.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { assertOwns } from '../../../../../../lib/db/integrity';
import { issueBreakGlass, formatBreakGlass } from '../../../../../../lib/people/break-glass';
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

    // DSQL has no FKs, so cross-owner references are refused in the application
    // layer or not at all — and this route skipped the check that every sibling
    // route makes. Issuing against another owner's person id was never
    // exploitable (redemption re-checks `owner_id`, so the code would be inert)
    // but it wrote junk rows and put a stranger's person id in this owner's
    // audit chain. Added 2026-08-12 for consistency with /api/invitations.
    await assertOwns(
      auth.ownerId,
      personType === 'recipient' ? 'recipients' : 'verifiers',
      (await params).id,
    );

    const { code, expiresAt } = await issueBreakGlass({
      ownerId: auth.ownerId,
      personId: (await params).id,
      personType,
    });

    return NextResponse.json({
      code: formatBreakGlass(code),
      expiresAt,
      shownOnce: true,
      warning:
        'Write this down and give it to them. We store only a hash, so we cannot show it again — and anyone holding it can take their place once.',
    });
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
