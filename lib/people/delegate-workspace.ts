/**
 * What a helper can see about the vault they are helping with.
 *
 * THE GAP THIS CLOSES. The delegate half of J3 was built as a security layer
 * with no surface above it: `enqueueApproval` was called by nothing, so the
 * owner's approvals queue could never fill; `GET /api/vault/items` took no
 * `?ownerId=`, so a helper who added an item could not see it afterwards; and
 * nothing anywhere told a person they had been made a helper. Appointing one
 * therefore achieved nothing, which is what the 2026-08-12 reassessment found.
 *
 * ⚠️ EVERY READ HERE IS NARROWER THAN THE OWNER'S. A helper sees the items they
 * personally entered and nothing else (J3-R4) — not a filtered view of the
 * vault, but a different question asked of it. The owner's own list is reached
 * by a different function on a different route, so there is no argument to get
 * wrong that would widen this one.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R4, J3-R6, J3-R8
 */

import { query } from '../db/connection';
import { formatOwnerLabel } from './owner-label';

export interface HelpedVault {
  ownerId: string;
  /** What to call them — the same precedence every other surface uses. */
  ownerLabel: string;
  delegationId: string;
  scopes: string[];
}

/**
 * The vaults this person is an ACTIVE helper on.
 *
 * `pending` is excluded deliberately: a delegation with no recorded consent
 * grants nothing (J3-R2), and showing it as a workspace would invite somebody to
 * start working in a place they cannot yet write to.
 */
export async function listVaultsIHelp(userId: string): Promise<HelpedVault[]> {
  const res = await query<{
    id: string;
    owner_id: string;
    scopes: string[] | null;
    display_name: string | null;
    email: string | null;
  }>(
    `SELECT d.id, d.owner_id, d.scopes, u.display_name, u.email
       FROM delegations d
       JOIN users u ON u.id = d.owner_id
      WHERE d.delegate_user_id = $1
        AND d.status = 'active'
        AND d.revoked_at IS NULL
      ORDER BY u.display_name NULLS LAST, u.email`,
    [userId],
  );

  return res.rows.map((r) => ({
    ownerId: r.owner_id,
    ownerLabel: formatOwnerLabel(r.display_name, r.email),
    delegationId: r.id,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
  }));
}

export interface EnteredItem {
  id: string;
  title: string;
  type: string;
  category: string | null;
  created_at: string;
}

/**
 * Only what this delegation entered (J3-R4).
 *
 * Both `owner_id` AND `created_by_delegate_id` are in the WHERE clause. Either
 * alone would be a bug of a different shape — owner alone shows a helper the
 * whole vault, delegation alone would leak across vaults if a delegation id were
 * ever reused — so both are stated rather than one being inferred from the
 * other.
 */
export async function listItemsIEntered(
  ownerId: string,
  delegationId: string,
): Promise<EnteredItem[]> {
  const res = await query<EnteredItem>(
    `SELECT id, title, type, category, created_at
       FROM vault_items
      WHERE owner_id = $1 AND created_by_delegate_id = $2
      ORDER BY created_at DESC`,
    [ownerId, delegationId],
  );
  return res.rows;
}

/** Proposals this delegation has made that the owner has not answered yet. */
export async function listMyPendingProposals(
  ownerId: string,
  delegationId: string,
): Promise<{ id: string; kind: string; payload: Record<string, unknown>; created_at: string }[]> {
  const res = await query<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, kind, payload, created_at
       FROM approvals
      WHERE owner_id = $1 AND proposed_by_delegation_id = $2 AND status = 'pending'
      ORDER BY created_at DESC`,
    [ownerId, delegationId],
  );
  return res.rows;
}
