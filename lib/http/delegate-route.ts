/**
 * Delegate scope enforcement for owner-scoped routes.
 *
 * Every check here is a security boundary, enforced server-side. Hiding a
 * control in the UI is not enforcement — the API is the boundary (J3-R11).
 *
 * Note what is NOT here: there is no delegate path to `/api/triggers/*` at all.
 * Those routes keep using `requireOwner()` unchanged, so a delegate simply
 * cannot reach them rather than being checked and refused (J3-R5).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R4, J3-R5, J3-R6, J3-R11
 */

import { NextResponse } from 'next/server';

import { getOwnerSession } from '../auth/session';
import { getActiveDelegation, type DelegateScope } from '../people/delegation';
import { IntegrityError } from '../db/integrity';

export interface ActorContext {
  /** The vault whose data is being acted on. */
  ownerId: string;
  /** The human actually making the request. */
  actingUserId: string;
  isDelegate: boolean;
  delegationId: string | null;
  scopes: DelegateScope[];
}

/**
 * Resolves who is acting, and on whose vault.
 *
 * A delegate targets another owner's vault via `?ownerId=`; an active
 * delegation must exist for that exact pair, or the request is refused.
 */
export async function resolveActor(
  targetOwnerId?: string | null,
): Promise<ActorContext | NextResponse> {
  let session: { ownerId: string };
  try {
    session = await getOwnerSession();
  } catch (res) {
    return res as NextResponse;
  }

  const actingUserId = session.ownerId;

  // Acting on your own vault is the ordinary case — no delegation involved.
  if (!targetOwnerId || targetOwnerId === actingUserId) {
    return {
      ownerId: actingUserId,
      actingUserId,
      isDelegate: false,
      delegationId: null,
      scopes: [],
    };
  }

  const delegation = await getActiveDelegation(actingUserId, targetOwnerId);
  if (!delegation) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'No active delegation for this vault' },
      { status: 403 },
    );
  }

  return {
    ownerId: targetOwnerId,
    actingUserId,
    isDelegate: true,
    delegationId: delegation.id,
    scopes: delegation.scopes,
  };
}

export function requireScope(ctx: ActorContext, scope: DelegateScope): void {
  // The owner holds every capability over their own vault.
  if (!ctx.isDelegate) return;

  if (!ctx.scopes.includes(scope)) {
    throw new IntegrityError('UNAUTHORIZED', `Delegate is not permitted to ${scope}`);
  }
}

/**
 * A delegate may read back only what they personally entered (J3-R4).
 *
 * Fails closed: a row without provenance is treated as not-theirs rather than
 * assumed safe.
 */
export function assertDelegateMayRead(
  ctx: ActorContext,
  item: { created_by_delegate_id?: string | null },
): void {
  if (!ctx.isDelegate) return;

  const enteredBy = item.created_by_delegate_id ?? null;
  if (enteredBy === null || enteredBy !== ctx.delegationId) {
    throw new IntegrityError(
      'UNAUTHORIZED',
      'Delegate may not read items they did not enter',
    );
  }
}
