/**
 * Which roster row a signed-in person is filling when they ask for access —
 * the third instance of the same pattern, after `session-access.ts` (recipient
 * decrypt) and `verifier-session.ts` (the verifier decision).
 *
 * THE GAP THIS CLOSES. `POST /api/access-requests` authenticated with a
 * RECIPIENT TOKEN, and recipient tokens are only minted by
 * `notifyRecipientsOfRelease` — after a release is already open. So the only
 * person who could ask for access was somebody who already had it, and J6 was
 * structurally unreachable: the owner's `/challenge` screen, the challenge-window
 * escalation, and J6-R9's covert-access deterrent were all built behind a door
 * with no handle. Found by writing the user manual, where the sentence "you can
 * ask them to open it" could not be written truthfully.
 *
 * 🚫 THE REJECTED ALTERNATIVE was an unauthenticated "enter your email to ask
 * for access" form. It would let a stranger trigger a challenge against any
 * owner by guessing addresses and — per J6-R9, which broadcasts every request to
 * the whole circle — turn that into a message to every contact they have. A
 * harassment vector and an enumeration oracle in one. This door needs a session,
 * and there are already two ways to hold one: claim, in calm, or redeem a
 * break-glass code, in a crisis.
 *
 * THE BAR IS `claimed`, NOT `confirmed` (ruled by Steve 2026-08-12). Break-glass
 * redemption sets `claimed`, so requiring `confirmed` would exclude the exact
 * person break-glass exists for — the one whose phone is gone during the
 * emergency. The request grants nothing by itself: it is a petition, capped at
 * three per 24h by `assertRequestAllowed`, answered by the owner first, and
 * escalated only to CONFIRMED verifiers who must still reach quorum. The bar
 * belongs where the outcome is decided, and that is downstream.
 *
 * RULE 1 (§3.7): resolved from the DATABASE, never from the session token. The
 * JWT says who the person is; whether they may ask, and on whose behalf, is a
 * question only the row answers — otherwise revocation would be delayed by the
 * token lifetime, and revocation is the control behind the coercion risk.
 *
 * Feature: relay-standby
 * Requirements: J6-R1, J6-R2, J4-R9
 */

import { query } from '../db/connection';

/**
 * The recipient row this user fills for this owner, or null.
 *
 * Null is the ordinary answer for an owner, a verifier-only contact, or somebody
 * asking about a vault they are not named on — and must never read as an error.
 */
export async function resolveRequesterFor(
  userId: string,
  ownerId: string,
): Promise<{ recipientId: string; ownerId: string } | null> {
  const res = await query<{ id: string }>(
    `SELECT id
       FROM recipients
      WHERE claimed_user_id = $1
        AND owner_id = $2
        AND coalesce(standby_state, 'invited') <> 'revoked'
      ORDER BY id
      LIMIT 1`,
    [userId, ownerId],
  );

  const row = res.rows[0];
  return row ? { recipientId: row.id, ownerId } : null;
}
