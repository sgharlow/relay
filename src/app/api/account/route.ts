/**
 * DELETE /api/account — close the account (J13).
 *
 * Honours the privacy page exactly: everything the owner put in is removed, and
 * the append-only audit log is retained as the one stated exception. The
 * promise and the implementation have to agree, so this follows the document
 * rather than the other way round.
 *
 * Requires the owner to type their own email address as confirmation. This is
 * irreversible, there is no undo, and a misplaced click should not be able to
 * destroy a family's continuity plan.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R2
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse } from '../../../../lib/http/owner-route';
import { deleteAccount } from '../../../../lib/account/lifecycle';
import { query } from '../../../../lib/db/connection';

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const confirmEmail = (body as { confirmEmail?: unknown }).confirmEmail;
  const owner = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [
    auth.ownerId,
  ]);
  const actual = owner.rows[0]?.email;

  if (typeof confirmEmail !== 'string' || !actual || confirmEmail.trim().toLowerCase() !== actual.toLowerCase()) {
    return NextResponse.json(
      { error: 'ConfirmationRequired', message: 'Type your email address exactly to confirm.' },
      { status: 400 },
    );
  }

  return NextResponse.json(await deleteAccount(auth.ownerId));
}
