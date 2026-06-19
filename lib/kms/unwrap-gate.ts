/**
 * Recipient KMS-unwrap authorization gate (the Property 6 predicate).
 *
 * Kept out of the route handler because Next.js route modules may only export
 * HTTP method handlers + a fixed set of config symbols.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.4, 7.5
 */

import { query } from '../db/connection';

/**
 * Returns `allowed: true` IFF the release_state row named by the recipient's
 * scoped token is in state 'released' AND an access_rules row links
 * `recipientId` to `vaultItemId`. Also returns the release_state `owner_id`
 * (for owner-scoped audit) whenever the release_state row exists.
 */
export async function evaluateRecipientUnwrap(params: {
  recipientId: string;
  vaultItemId: string;
  releaseStateId: string;
}): Promise<{ allowed: boolean; ownerId: string | null }> {
  const rs = await query<{ state: string; owner_id: string }>(
    `SELECT state, owner_id FROM release_state WHERE id = $1 LIMIT 1`,
    [params.releaseStateId],
  );
  if (rs.rowCount === 0 || rs.rows.length === 0) {
    return { allowed: false, ownerId: null };
  }
  const ownerId = rs.rows[0].owner_id;
  if (rs.rows[0].state !== 'released') {
    return { allowed: false, ownerId };
  }

  const rule = await query<{ id: string }>(
    `SELECT id FROM access_rules
       WHERE recipient_id = $1 AND vault_item_id = $2
       LIMIT 1`,
    [params.recipientId, params.vaultItemId],
  );
  return { allowed: rule.rowCount !== 0, ownerId };
}
