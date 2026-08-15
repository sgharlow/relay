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
import { requireStepUpOnce } from '../../../../lib/auth/step-up';
import { deleteAccount } from '../../../../lib/account/lifecycle';
import { MAX_DISPLAY_NAME_LENGTH } from '../../../../lib/auth/signup';
import { query } from '../../../../lib/db/connection';

/**
 * STEP-UP GUARDED, AND IT SPENDS THE ELEVATION. Typing an email address proves
 * somebody read the warning; it does not prove they are the owner, because the
 * address is on the screen they are already looking at. This is the one action
 * in the product with no undo and with third parties depending on the outcome —
 * everyone standing by loses their access the moment it completes.
 *
 * `requireStepUpOnce` rather than `requireStepUp`: the elevation that authorised
 * a deletion is consumed by it, so nothing else can ride the same proof.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
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

  // AFTER the typed confirmation, not before: a mistyped address would otherwise
  // burn the elevation and make somebody re-authenticate to fix a typo. Nothing
  // leaks by ordering it this way — the caller is already signed in as the owner
  // and is looking at their own address on the screen.
  const elevate = await requireStepUpOnce(req, auth.ownerId);
  if (elevate) return elevate;

  return NextResponse.json(await deleteAccount(auth.ownerId));
}

/**
 * PATCH /api/account — change the owner's display name.
 *
 * It was set once at signup and never editable again, which mattered more than
 * it looks: this is the name every recipient and verifier sees on the messages
 * that arrive during an emergency. A typo made at signup was permanent in the
 * one place it is read by the people it has to reassure.
 *
 * Requirements: J13-R1
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // Setting your name or issuing recovery codes is a person, present, deciding.
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const raw = (body as { displayName?: unknown }).displayName;
  if (typeof raw !== 'string') {
    return NextResponse.json(
      { error: 'ValidationError', message: 'displayName is required', field: 'displayName' },
      { status: 400 },
    );
  }

  /*
    🔴 WHITESPACE COLLAPSES, NOT JUST TRIMS, added 2026-08-13. `.trim()` removes
    line breaks from the ENDS and keeps every one in the middle — and this value
    becomes the SUBJECT LINE of the invitation Relay sends ("<name> asked you to
    be a trusted contact"), as well as the name shown to every contact. A subject
    is the one field in a message where an embedded newline has ever meant
    anything to a mail system, and the length cap below let one through easily.

    Same treatment as a contact's name (lib/validation.ts cleanPersonName), for
    the same reason and by the same rule: collapse whitespace, refuse on length.
  */
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    // Rejected rather than truncated: silently shortening the name someone will
    // be recognised by is worse than telling them it did not fit.
    return NextResponse.json(
      {
        error: 'ValidationError',
        message: `Name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`,
        field: 'displayName',
      },
      { status: 400 },
    );
  }

  // Empty clears it, falling back to the email address exactly as before a name
  // was ever set. The owner id comes from the session and never from the body.
  await query(`UPDATE users SET display_name = $1 WHERE id = $2`, [trimmed || null, auth.ownerId]);

  return NextResponse.json({ displayName: trimmed || null });
}
