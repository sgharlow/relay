/**
 * POST /api/access/resend — a recipient asks for a fresh access code.
 *
 * THE GAP THIS CLOSES. A recipient's access lasts 24 hours, and the only way to
 * re-issue it was an owner-authenticated endpoint. The owner is, by the nature
 * of this product, the person in hospital. Hospital stays are days to weeks, so
 * a caregiver who got in on day one and came back on day three was locked out
 * with nobody able to help — during the emergency the product exists for.
 *
 * WHY THIS IS SAFE. It grants nothing new: a code is issued ONLY for a trigger
 * that is already RELEASED, meaning the owner configured it, a verifier
 * confirmed it, and the access already exists. This re-opens a door that is
 * already open to this person.
 *
 * The code is emailed to the address ON FILE, never to the address supplied.
 * Someone guessing a recipient's email therefore causes an email to the real
 * recipient and learns nothing. The response is identical either way, so this
 * cannot be used to discover who is named on a vault.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1
 */

import { NextResponse, type NextRequest } from 'next/server';

import { query } from '../../../../../lib/db/connection';
import { issueRecipientCode, formatCode } from '../../../../../lib/auth/recipient-code';
import { sendEmailBestEffort } from '../../../../../lib/notify/email';
import { getOwnerLabel } from '../../../../../lib/people/owner-label';
import { formatCaseId } from '../../../../../lib/release/case-id';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';

/** Tight: this sends mail to a third party on an unauthenticated request. */
const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'aresend'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many requests. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid request.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  // Deliberately identical whatever happens next — see the module comment.
  const ok = NextResponse.json({
    ok: true,
    message: 'If that address has active access, a new code is on its way.',
  });
  if (!email) return ok;

  const rows = await query<{
    recipient_id: string;
    recipient_name: string;
    recipient_email: string;
    release_state_id: string;
    owner_id: string;
    version: string;
  }>(
    `SELECT DISTINCT r.id AS recipient_id, r.name AS recipient_name, r.email AS recipient_email,
            rs.id AS release_state_id, rs.owner_id, rs.version
       FROM recipients r
       JOIN access_rules ar ON ar.recipient_id = r.id
       JOIN release_state rs
         ON rs.owner_id = ar.owner_id AND rs.trigger_type = ar.trigger_type
      WHERE lower(r.email) = lower($1)
        AND rs.state = 'released'
      LIMIT 1`,
    [email],
  );

  const row = rows.rows[0];
  if (!row) return ok;

  const code = formatCode(
    await issueRecipientCode({
      recipientId: row.recipient_id,
      releaseStateId: row.release_state_id,
      ownerId: row.owner_id,
      version: row.version,
    }),
  );

  const ownerLabel = await getOwnerLabel(row.owner_id);
  const caseId = formatCaseId(row.release_state_id);

  await sendEmailBestEffort({
    // The address on file, NOT the one supplied.
    to: row.recipient_email,
    subject: `Your new Relay access code (${caseId})`,
    text:
      `Hi ${row.recipient_name},\n\n` +
      `Here is a new code for the access ${ownerLabel} arranged for you.\n\n` +
      `Go to ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://relaystandby.com'}/access and enter:\n\n` +
      `    ${code}\n\n` +
      `Case ${caseId} · expires in 24 hours.\n\n` +
      `If you did not ask for this, someone entered your address on our site. Nothing has been ` +
      `opened, and you can ignore this message.\n`,
  });

  await writeAuditEntry(row.owner_id, {
    actor: `recipient:${row.recipient_id}`,
    action: 'access_code_resent',
    entity: 'release_state',
    entityId: row.release_state_id,
    detail: { requested: true },
  });

  return ok;
}
