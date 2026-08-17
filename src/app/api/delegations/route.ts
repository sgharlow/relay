/**
 * /api/delegations — a helper with scoped setup rights on this vault.
 *
 * GET  → list, with the role-concentration warning if one applies (J3-R10)
 * POST → create a PENDING delegation; it activates only on recorded consent
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R8, J3-R10
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { query } from '../../../../lib/db/connection';
import { createDelegation, revokeDelegation } from '../../../../lib/people/delegation';
import { delegateActivityDigest } from '../../../../lib/people/approvals';
import { detectRoleConcentration, type CirclePerson } from '../../../../lib/people/role-concentration';
import { listPeople } from '../../../../lib/people/people';
import { ValidationError } from '../../../../lib/validation';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const [delegations, people] = await Promise.all([
    query<{ id: string; delegate_user_id: string; status: string; granted_at: string | null }>(
      /*
        🔴 `consent_artifacts` WAS WRITTEN AND READ BY NOTHING. `recordConsent`
        inserts the row and links it, and no query anywhere ever selected it
        back — so the consent screen's own promise, "This is kept as a record. It
        is what makes handing someone this help legitimate rather than simply
        convenient," was kept by the database and never by the product. An owner
        who wrote "signed form in the blue folder" had no way to read it again.

        LEFT JOIN, not JOIN: a pending delegation has no artifact yet, and an
        inner join would drop exactly the rows the screen exists to act on.
      */
      `SELECT d.id, d.delegate_user_id, d.status, d.granted_at,
              c.method AS consent_method, c.evidence_ref AS consent_evidence_ref
         FROM delegations d
         LEFT JOIN consent_artifacts c ON c.id = d.consent_artifact_id
        WHERE d.owner_id = $1 AND d.revoked_at IS NULL`,
      [auth.ownerId],
    ),
    listPeople(auth.ownerId),
  ]);

  // Delegate emails, so concentration is judged on the same normalised key the
  // people list uses.
  const delegateEmails = await query<{ email: string }>(
    `SELECT u.email FROM delegations d JOIN users u ON u.id = d.delegate_user_id
      WHERE d.owner_id = $1 AND d.status = 'active' AND d.revoked_at IS NULL`,
    [auth.ownerId],
  );
  const delegateSet = new Set(delegateEmails.rows.map((r) => r.email.trim().toLowerCase()));

  const circle: CirclePerson[] = people.map((p) => ({
    email: p.email,
    isDelegate: delegateSet.has(p.email.trim().toLowerCase()),
    isRecipient: p.roles.recipient,
    isVerifier: p.roles.verifier,
  }));

  /**
   * WHO CAN BE MADE A HELPER — and the reason there was no UI for this until
   * 2026-08-12. `POST` takes a `delegateUserId`, a raw UUID an owner has no way
   * to know, so the create path was unbuildable without first answering "which
   * users are even eligible".
   *
   * ⚠️ ONLY PEOPLE ALREADY IN THE CIRCLE WHO HAVE ACCEPTED. Delegation grants
   * setup rights over somebody's vault, so the candidate list is deliberately
   * the smallest one that serves the caregiver case: the adult child is already
   * a recipient on their parent's vault, and making them a helper ELEVATES a
   * known person rather than introducing a stranger. That means no invitation
   * path, no account minted as a side effect, and no email lookup that could be
   * used to discover whether an address has a Relay account.
   *
   * Revoked people are excluded in SQL. Someone the owner withdrew must not
   * reappear as a suggestion.
   */
  const candidates = await query<{
    user_id: string;
    name: string;
    email: string;
    person_type: string;
    standby_state: string | null;
  }>(
    `SELECT r.claimed_user_id AS user_id, r.name, r.email, 'recipient' AS person_type, r.standby_state
       FROM recipients r
      WHERE r.owner_id = $1 AND r.claimed_user_id IS NOT NULL
        AND coalesce(r.standby_state, 'invited') <> 'revoked'
      UNION
     SELECT v.claimed_user_id AS user_id, v.name, v.email, 'verifier' AS person_type, v.standby_state
       FROM verifiers v
      WHERE v.owner_id = $1 AND v.claimed_user_id IS NOT NULL
        AND coalesce(v.standby_state, 'invited') <> 'revoked'`,
    [auth.ownerId],
  );

  const alreadyDelegate = new Set(delegations.rows.map((d) => d.delegate_user_id));

  /**
   * 🔴 THE DELEGATION NEEDS ITS OWN NAME. Found by looking at the rendered page
   * 2026-08-12: the UI built its name lookup from `candidates`, and a person is
   * removed from that list the moment they become a delegate — so the row for
   * the helper you just added read "Your helper · not active yet", on the screen
   * where you are deciding whether to hand somebody setup rights over your
   * vault. Naming the wrong thing there is not cosmetic.
   */
  const byUser = new Map(candidates.rows.map((c) => [c.user_id, c]));

  /**
   * 🔴 J3-R8 HAD NO SURFACE. `delegateActivityDigest` was written, tested and
   * called by nothing, so "what was done on your behalf" — the single thing that
   * makes handing somebody setup rights reviewable rather than a leap of faith —
   * existed only as a function.
   *
   * Derived from the audit chain rather than a second log, exactly as the
   * function's own header requires: a separate activity table could drift from
   * the record, and then two sources would disagree about what a helper did.
   *
   * 90 days: long enough to cover the setup period a helper is actually for,
   * short enough that the list stays readable on the screen where an owner
   * decides whether to keep them.
   */
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const digest = await delegateActivityDigest(auth.ownerId, since);

  const activityByDelegation = new Map<string, { action: string; ts: string }[]>();
  for (const row of digest) {
    const id = row.actor.slice('delegate:'.length);
    const list = activityByDelegation.get(id) ?? [];
    list.push({ action: row.action, ts: row.ts });
    activityByDelegation.set(id, list);
  }

  return NextResponse.json({
    delegations: delegations.rows.map((d) => ({
      ...d,
      name: byUser.get(d.delegate_user_id)?.name ?? null,
      email: byUser.get(d.delegate_user_id)?.email ?? null,
      activity: activityByDelegation.get(d.id) ?? [],
    })),
    concentrationWarning: detectRoleConcentration(circle),
    candidates: candidates.rows
      .filter((c) => !alreadyDelegate.has(c.user_id))
      // The owner themselves can never be their own delegate (`createDelegation`
      // refuses it); filtered here too so it is never even offered.
      .filter((c) => c.user_id !== auth.ownerId),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { delegateUserId } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof delegateUserId !== 'string') {
      throw new ValidationError('delegateUserId is required', 'delegateUserId');
    }
    return NextResponse.json(await createDelegation(auth.ownerId, delegateUserId), { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { delegationId } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof delegationId !== 'string') {
      throw new ValidationError('delegationId is required', 'delegationId');
    }
    await revokeDelegation(auth.ownerId, delegationId);
    return NextResponse.json({ revoked: true });
  } catch (err) {
    return mapError(err);
  }
}
