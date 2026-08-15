/**
 * POST /api/account/recovery-codes — issue a fresh recovery sheet.
 *
 * `issueRecoveryCodes` existed, worked, and had exactly one caller:
 * `/auth/recover`, which requires consuming a recovery code to get in. So an
 * owner who lost the sheet but still held their working authenticator had no
 * way to get another — and their NEXT lost or replaced phone would have locked
 * them out permanently, on a product whose whole promise is that access
 * survives the thing that goes wrong.
 *
 * The capability was reachable from code and from nowhere a person could stand.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { requireStepUp } from '../../../../../lib/auth/step-up';
import {
  issueRecoveryCodes,
  formatRecoveryCode,
  remainingRecoveryCodes,
} from '../../../../../lib/auth/recovery-code';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';

/** Reads a session, so it must never be prerendered at build time. */
export const dynamic = 'force-dynamic';

/**
 * GET — how many are left.
 *
 * 🔴 `remainingRecoveryCodes` was written, tested, and called by nothing, so an
 * owner could not find out. That is a SILENT CLIFF: recovery codes are the only
 * way back when the authenticator is gone, they are consumed one per use, and
 * the product said nothing as the sheet ran down. Somebody could be on their
 * last code and learn it at the exact moment it stops mattering — after they
 * have spent it and lost the phone.
 *
 * The count only, never a code. Codes are stored as hashes and are readable
 * exactly once, at issue.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json({ remaining: await remainingRecoveryCodes(auth.ownerId) });
}

/**
 * POST — mint a fresh sheet.
 *
 * STEP-UP GUARDED. A recovery sheet is the one artefact that outlives the
 * session that produced it: it is the way back in when the authenticator is
 * gone, so somebody who finds an unlocked machine and issues a new one has
 * PERMANENT control of the account, not a session's worth. There is no password
 * to change afterwards that would take it away. So the ordinary 24-hour session
 * is not enough — the person has to still be there.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const elevate = await requireStepUp(req, auth.ownerId);
  if (elevate) return elevate;

  const codes = await issueRecoveryCodes(auth.ownerId);

  // Regenerating invalidates the previous sheet, and someone doing it has
  // either lost the old one or believes it was exposed. Both belong in a log
  // the owner can read back.
  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'recovery_codes_regenerated',
    entity: 'user',
    entityId: auth.ownerId,
    detail: { count: codes.length },
  });

  // The only moment these exist in readable form. Nothing stores the plaintext,
  // so a second call mints a new set rather than re-showing this one.
  return NextResponse.json({ recoveryCodes: codes.map(formatRecoveryCode) });
}
