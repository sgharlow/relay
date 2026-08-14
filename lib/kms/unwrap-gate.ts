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
import { isDelayElapsed } from '../rules/release-delay';

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
  const rs = await query<{
    state: string;
    owner_id: string;
    released_at: string | null;
    trigger_type: string;
  }>(
    `SELECT state, owner_id, released_at, trigger_type FROM release_state WHERE id = $1 LIMIT 1`,
    [params.releaseStateId],
  );
  if (rs.rowCount === 0 || rs.rows.length === 0) {
    return { allowed: false, ownerId: null };
  }
  const ownerId = rs.rows[0].owner_id;
  if (rs.rows[0].state !== 'released') {
    return { allowed: false, ownerId };
  }

  /*
    🔴 THE trigger_type SCOPE WAS MISSING HERE, added 2026-08-13. The session
    decrypt door (lib/access/dashboard.ts) filters access_rules by the released
    trigger; this token path did not, so a recipient granted an item ONLY under
    trigger B could decrypt it during trigger A's release — access trigger A
    never granted. Req 7.1/7.2 scope a recipient's access to their rules FOR THE
    RELEASED trigger_type, and decrypt-session.test.ts's own header requires
    "everything after the door" to be identical between the two routes. The
    unfiltered LIMIT 1 could also pick a rule carrying the wrong
    release_after_days, mis-applying the staged delay. One door, one predicate.
  */
  const rule = await query<{ id: string; release_after_days: number | null }>(
    `SELECT id, release_after_days FROM access_rules
       WHERE recipient_id = $1 AND vault_item_id = $2 AND trigger_type = $3
       LIMIT 1`,
    [params.recipientId, params.vaultItemId, rs.rows[0].trigger_type],
  );
  if (rule.rowCount === 0 || rule.rows.length === 0) return { allowed: false, ownerId };

  /*
    🔴 THE STAGED DELAY WAS NOT ENFORCED HERE, added 2026-08-13. This gate asked
    only whether a rule existed, so `release_after_days` — offered on /rules,
    stored, and documented in the manual as holding a rule back — opened the item
    in the first minute along with everything else. See lib/rules/release-delay.ts.
  */
  if (!isDelayElapsed(rule.rows[0].release_after_days, rs.rows[0].released_at)) {
    return { allowed: false, ownerId };
  }

  return { allowed: true, ownerId };
}
