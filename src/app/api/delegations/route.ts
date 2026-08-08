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
import { detectRoleConcentration, type CirclePerson } from '../../../../lib/people/role-concentration';
import { listPeople } from '../../../../lib/people/people';
import { ValidationError } from '../../../../lib/validation';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const [delegations, people] = await Promise.all([
    query<{ id: string; delegate_user_id: string; status: string; granted_at: string | null }>(
      `SELECT id, delegate_user_id, status, granted_at
         FROM delegations WHERE owner_id = $1 AND revoked_at IS NULL`,
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

  return NextResponse.json({
    delegations: delegations.rows,
    concentrationWarning: detectRoleConcentration(circle),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
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
  const auth = await requireOwner();
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
