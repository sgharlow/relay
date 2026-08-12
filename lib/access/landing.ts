/**
 * Where does this person belong after signing in?
 *
 * THE DEFECT THIS CLOSES, found on production 2026-08-12: the passkey button
 * redirected to a hardcoded `/start`, so a standby contact who signed in with
 * the passkey they had just enrolled landed on "Start your vault" inside the
 * OWNER shell — a sidebar of Vault / Import / People / Rules / Triggers. They
 * signed in to check on someone and were shown an onboarding funnel for a
 * product they were not there to buy. The TOTP form meanwhile hardcoded
 * `/vault`. Two sign-in paths, two different guesses, neither of which asked
 * who the person actually was.
 *
 * A destination cannot be a constant, because a user is not one kind of person.
 * §3.7 established that the same human may be an owner, a standby for several
 * others, or both at once, so this resolves the answer from the database:
 *
 *   holds a vault        -> /vault    owner mode is their primary home
 *   stands by for anyone -> /standby  the reason they signed in
 *   neither              -> /start    genuinely new; onboarding is correct
 *
 * Vault before standby is deliberate for the both-hats case: an owner has
 * ongoing work in owner mode, whereas standby is a place you visit when
 * something has happened — and the sidebar link makes it one click away.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, 17.1
 */

import { query } from '../db/connection';
import { resolveStandbyFor } from './standby-resolve';

export type Landing = '/vault' | '/standby' | '/start';

/**
 * Resolved from the DATABASE, never from the session token — the same rule
 * /api/standby follows (§3.7 rule 1). A JWT minted before someone was named as
 * a recipient would otherwise keep sending them to the wrong place until it
 * expired.
 *
 * Membership comes from `resolveStandbyFor` rather than a second count query of
 * my own. Who counts as a standby is a contract — which roster tables, which
 * `standby_state` values survive — and re-expressing it here would create a
 * second definition free to drift from the one the dashboard uses. Then this
 * could route someone to a page that renders nothing for them.
 */
export async function resolveLanding(userId: string): Promise<Landing> {
  const own = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vault_items WHERE owner_id = $1`,
    [userId],
  );
  if (Number(own.rows[0]?.n ?? 0) > 0) return '/vault';

  const standby = await resolveStandbyFor({ userId });
  if (standby.relationships.length > 0) return '/standby';

  return '/start';
}
