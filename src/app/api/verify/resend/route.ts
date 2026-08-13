/**
 * POST /api/verify/resend — a verifier asks to be sent what they need, again.
 *
 * THE GAP THIS CLOSES. `/api/access/resend` exists because "the owner is, by
 * the nature of this product, the person in hospital" — a recipient locked out
 * mid-emergency had nobody able to help. The verifier had no such path at all,
 * and their code lasts 72 hours. That is worse in one specific way: a stalled
 * recipient inconveniences themselves, while a stalled verifier **blocks the
 * release for everyone**, including the recipient who is not stalled.
 *
 * It also serves the commoner case. Deliverability was measured broken on
 * 2026-08-11 (Outlook files us at SCL 5), so "I never got it" happens more often
 * than "it expired", and both arrive here.
 *
 * ⚠️ THIS DOES NOT RE-DERIVE WHO GETS A CODE. It classifies the person with the
 * same `classifyVerifiersForNotice` the release path uses and hands off to the
 * same `notifyOneVerifier`. A second copy of the adaptive-minting rule would be
 * a second copy of a security rule, and two copies of a security rule is how the
 * ends of a contract stop agreeing. So a passkey holder asking for a resend gets
 * another sign-in nudge and no credential; an unverified verifier gets the notice
 * saying their answer would not count; a revoked one gets nothing. Only the one
 * class that needs a code receives one.
 *
 * WHY THIS IS SAFE.
 *   * It grants nothing new. A code is issued ONLY against a release that is
 *     already `pending` or `grace` — the owner configured the trigger and
 *     something already started it — and only to somebody already on that
 *     owner's verifier roster.
 *   * The mail goes to the address ON FILE. Someone guessing a verifier's email
 *     causes an email to the real verifier and learns nothing.
 *   * The response is byte-identical in every case, including "no such person",
 *     so this cannot enumerate who is named on a vault.
 *   * Somebody who has ALREADY ANSWERED resolves to nothing. The question is
 *     closed for them, so there is nothing to resend.
 *   * Every send lands in the owner's audit log, so a spray is visible rather
 *     than silent.
 *
 * ⚠️ KNOWN LIMITATION, STATED NOT SOLVED. If the address is suppressed at the
 * ESP after an earlier hard bounce, this succeeds and delivers nothing — the
 * failure `feedback-esp-delivered-cannot-see-the-junk-folder` describes. The
 * answer to that is the owner-side reissue and quorum slack, not this endpoint.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2, J8-R1
 */

import { NextResponse, type NextRequest } from 'next/server';

import { query } from '../../../../../lib/db/connection';
import { classifyOrFailOpen } from '../../../../../lib/notify/verifier-notice-class';
import { notifyOneVerifier } from '../../../../../lib/notify/notifications';
import { getOwnerLabel } from '../../../../../lib/people/owner-label';
import { formatCaseId } from '../../../../../lib/release/case-id';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../../lib/http/owner-route';

/** Tight: this sends mail to a third party on an unauthenticated request. */
const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'vresend'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many requests. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const parsed = await readJson(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as { email?: unknown };

  const email = typeof body.email === 'string' ? body.email.trim() : '';

  // Deliberately identical whatever happens next, and deliberately vague about
  // WHAT was sent — because what a verifier needs depends on how they are set
  // up, and saying "a code is on its way" would be false for the people who
  // correctly receive no code.
  const ok = NextResponse.json({
    ok: true,
    message: 'If that address is expected on an open request, we have sent it what it needs.',
  });
  if (!email) return ok;

  const rows = await query<{
    verifier_id: string;
    verifier_name: string;
    verifier_email: string;
    release_state_id: string;
    owner_id: string;
    trigger_type: string;
  }>(
    `SELECT v.id AS verifier_id, v.name AS verifier_name, v.email AS verifier_email,
            rs.id AS release_state_id, rs.owner_id, rs.trigger_type
       FROM verifiers v
       JOIN release_state rs ON rs.owner_id = v.owner_id
      WHERE lower(v.email) = lower($1)
        AND rs.state IN ('pending', 'grace')
        AND coalesce(v.standby_state, 'invited') <> 'revoked'
        -- Already answered is not still waiting: same guard as the session
        -- resolver, because asking somebody the same question twice during an
        -- emergency reads as the product having lost their answer.
        AND NOT EXISTS (
          SELECT 1 FROM verifier_confirmations vc
           WHERE vc.release_state_id = rs.id AND vc.verifier_id = v.id
        )
      ORDER BY CASE rs.state WHEN 'pending' THEN 0 ELSE 1 END, rs.initiated_at NULLS LAST, rs.id
      LIMIT 1`,
    [email],
  );

  const row = rows.rows[0];
  if (!row) return ok;

  const classes = await classifyOrFailOpen([row.verifier_id]);
  const noticeClass = classes.get(row.verifier_id) ?? 'code';

  const sent = await notifyOneVerifier(
    {
      id: row.verifier_id,
      name: row.verifier_name,
      // The address ON FILE, not the one supplied. Identical here because the
      // lookup keyed on it, but stated explicitly so a future change to the
      // lookup cannot quietly turn this into a redirect.
      email: row.verifier_email,
    },
    {
      noticeClass,
      // The release's OWN trigger type. Hardcoding 'emergency' here would have
      // told a verifier the wrong thing about a caregiver or travel release —
      // and the trigger type is exactly what tells them how much is at stake.
      triggerType: row.trigger_type,
      releaseStateId: row.release_state_id,
      ownerId: row.owner_id,
      ownerLabel: await getOwnerLabel(row.owner_id),
      caseId: formatCaseId(row.release_state_id),
    },
  );

  if (sent) {
    await writeAuditEntry(row.owner_id, {
      actor: `verifier:${row.verifier_id}`,
      action: 'verifier_notice_resent',
      entity: 'release_state',
      entityId: row.release_state_id,
      // The class is recorded because it is the interesting fact: it says
      // whether a credential left the building or only a reminder did.
      detail: { requested: true, noticeClass },
    });
  }

  return ok;
}
