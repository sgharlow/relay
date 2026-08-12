/**
 * POST /api/access-requests — a recipient asks for access.
 *
 * The OWNER is challenged first. Only if they do not answer inside the window
 * does this escalate to verifiers (J6-R2).
 *
 * Every recipient and verifier is told a request was made, whatever the
 * outcome: broadcasting it makes a covert access attempt impossible, which is
 * the deterrent that matters most in a family context (J6-R9).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R1, J6-R2, J6-R8, J6-R9, J6-R11
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { resolveRequesterFor } from '../../../../lib/access/requester-session';
import { verifyRecipientToken } from '../../../../lib/auth/recipient-token';
import { query } from '../../../../lib/db/connection';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { formatCaseId } from '../../../../lib/release/case-id';
import {
  assertRequestAllowed,
  challengeExpiry,
  sanitiseRequestReason,
  CHALLENGE_WINDOW_SECONDS,
  type TriggerType,
} from '../../../../lib/release/access-request';
import { ValidationError } from '../../../../lib/validation';
import {
  notifyOwnerOfAccessRequest,
  notifyCircleOfRequest,
} from '../../../../lib/notify/notifications';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const res = await query<Record<string, unknown>>(
    `SELECT ar.id, ar.trigger_type, ar.reason, ar.case_id, ar.expires_at,
            r.name AS recipient_name
       FROM access_requests ar
       LEFT JOIN recipients r ON r.id = ar.recipient_id
      WHERE ar.owner_id = $1 AND ar.status = 'awaiting_owner'`,
    [auth.ownerId],
  );

  return NextResponse.json({ requests: res.rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { recipient_token, trigger_type, reason, owner_id } = (body ?? {}) as Record<string, unknown>;

  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : recipient_token;

  /**
   * TWO DOORS, ONE AUTHORIZATION CORE — the same split already applied to
   * recipient decrypt and the verifier decision. Everything below keys on
   * `recipientId`; the only thing that changed is how it is obtained.
   *
   * 🔴 THE TOKEN DOOR WAS THE ONLY ONE, AND IT LED NOWHERE. Recipient tokens are
   * minted only after a release is already open, so the sole person who could
   * ask for access was one who already had it — and J6 was unreachable in a
   * product that had built the owner's challenge screen, the escalation and the
   * circle broadcast for it. Found by writing the user manual 2026-08-12.
   *
   * The token path is UNCHANGED and stays: an unclaimed recipient holding a live
   * access code is still a legitimate requester.
   */
  let payload: { recipientId: string } | null = null;

  if (typeof token === 'string') {
    try {
      payload = await verifyRecipientToken(token);
    } catch {
      return NextResponse.json({ error: 'Forbidden', message: 'Invalid recipient token' }, { status: 403 });
    }
  } else {
    // ⚠️ `requireOwner()` called WITHOUT `req`, deliberately (§3.7 rule 8).
    // Passing it records deliberate activity, and asking somebody else to open
    // their vault must not extend the requester's OWN dead-man's-switch.
    const auth = await requireOwner();
    if (isResponse(auth)) return auth;

    // Shape-checked here rather than left to the database: `owner_id` lands in a
    // UUID column, so a malformed value became a Postgres cast error and a 500 —
    // an outage-shaped response to a client mistake.
    if (typeof owner_id !== 'string' || !UUID_RE.test(owner_id)) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'owner_id is required' },
        { status: 400 },
      );
    }

    // §3.7 rule 1: the roster row decides, not the session token.
    const resolved = await resolveRequesterFor(auth.ownerId, owner_id);
    if (!resolved) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'You are not named on that vault.' },
        { status: 403 },
      );
    }
    payload = { recipientId: resolved.recipientId };
  }

  try {
    if (typeof trigger_type !== 'string' || !(trigger_type in CHALLENGE_WINDOW_SECONDS)) {
      throw new ValidationError('trigger_type is invalid', 'trigger_type');
    }

    const owner = await query<{ owner_id: string }>(
      `SELECT owner_id FROM recipients WHERE id = $1 LIMIT 1`,
      [payload.recipientId],
    );
    const ownerId = owner.rows[0]?.owner_id;
    if (!ownerId) {
      throw new ValidationError('Unknown recipient', 'recipient');
    }

    // Velocity limit: repeated asks must not be usable to wear an owner down.
    const recent = await query<{ created_at: string }>(
      `SELECT created_at FROM access_requests WHERE recipient_id = $1`,
      [payload.recipientId],
    );
    assertRequestAllowed(recent.rows);

    // Sanitised ONCE, and the same value is stored and mailed — so the owner
    // reading /challenge and the owner reading their inbox see the same text.
    const safeReason = sanitiseRequestReason(reason);

    const now = new Date();
    const caseId = formatCaseId(`${payload.recipientId}:${now.toISOString()}`);
    const inserted = await query<{ id: string }>(
      `INSERT INTO access_requests
         (owner_id, recipient_id, trigger_type, reason, case_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        ownerId,
        payload.recipientId,
        trigger_type,
        safeReason,
        caseId,
        challengeExpiry(trigger_type as TriggerType, now),
      ],
    );

    await writeAuditEntry(ownerId, {
      actor: `recipient:${payload.recipientId}`,
      action: 'access_requested',
      entity: 'access_request',
      entityId: inserted.rows[0].id,
      detail: { trigger_type },
    });

    // Challenge the OWNER first — the entire point of this flow (J6-R2).
    const [ownerRow, requester, circle] = await Promise.all([
      query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [ownerId]),
      query<{ name: string }>(`SELECT name FROM recipients WHERE id = $1 LIMIT 1`, [payload.recipientId]),
      query<{ email: string; name: string }>(
        `SELECT email, name FROM recipients WHERE owner_id = $1 AND id <> $2
         UNION ALL
         SELECT email, name FROM verifiers WHERE owner_id = $1`,
        [ownerId, payload.recipientId],
      ),
    ]);

    const requesterName = requester.rows[0]?.name ?? 'Someone you trust';
    const ownerLabel = ownerRow.rows[0]?.email ?? 'the vault owner';
    const expiresAt = challengeExpiry(trigger_type as TriggerType, now);

    const challenged = ownerRow.rows[0]
      ? await notifyOwnerOfAccessRequest({
          to: ownerRow.rows[0].email,
          requesterName,
          triggerType: trigger_type,
          reason: safeReason,
          caseId,
          expiresAt,
        })
      : false;

    // Social transparency — nothing happens quietly (J6-R9).
    await notifyCircleOfRequest(circle.rows, { requesterName, ownerLabel, caseId });

    return NextResponse.json(
      { id: inserted.rows[0].id, status: 'awaiting_owner', expiresAt, ownerChallenged: challenged },
      { status: 201 },
    );
  } catch (err) {
    return mapError(err);
  }
}
