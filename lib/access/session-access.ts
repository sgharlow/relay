/**
 * Session-based release access — the Sprint D swap.
 *
 * TODAY: a recipient redeems an emailed code for a JWT scoped to
 * `(release_state.id, version)` and opens `/access?token=…`.
 * UNDER STANDBY: a claimed recipient signs into an account they already have,
 * the row is read fresh on every request, and **nothing secret is transmitted at
 * release time**.
 *
 * THE VERSION GUARANTEE DOES NOT WEAKEN — IT GETS STRONGER. That is the thing
 * people reasonably worry about when a token disappears, so it is worth being
 * precise. A JWT carries a SNAPSHOT of `release_state.version` which then has to
 * be compared against the row, and the window between issue and check is where
 * staleness lives. A session carries no version at all: the row is the only
 * source and it is read on every call, so a re-arm closes an open dashboard on
 * its next request by construction. There is no stale claim to leak because
 * there is no claim.
 *
 * ADDITIVE, NOT A CUTOVER. An unclaimed recipient keeps the emailed-code path
 * untouched. That is what makes this sprint's rollback reverting code with no
 * data change — and it is also why quorum must still count people who can act by
 * EITHER route until assurance ships.
 *
 * Feature: relay-standby
 * Requirements: 7.3, 7.7, J8
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';

export interface ResolvedRelease {
  recipientId: string;
  ownerId: string;
  releaseStateId: string;
  triggerType: string;
  state: string;
  released: boolean;
}

/**
 * Resolves the OPEN release a signed-in recipient has, if any.
 *
 * Returns `null` when this user is not a claimed recipient for anyone — which is
 * the normal case for an owner or a verifier, and must not be an error — and
 * also when nothing is happening, which is the normal case for everybody else.
 *
 * 🔴 THIS QUERY USED TO MATCH AN `armed` ROW, AND IT TOLD A CALM FAMILY MEMBER
 * THAT THEIR EMERGENCY ACCESS HAD BEEN WITHDRAWN. There was no state predicate:
 * the ORDER BY merely PREFERRED a released row, so an owner in perfect health
 * with every trigger armed still resolved here with `released: false`. The
 * caller reads that as "closed" and renders the graceful-close screen —
 * "Everything is back to normal. The vault has been re-armed" plus "You were
 * trusted with N items for under an hour" — to somebody for whom nothing had
 * ever opened. An `armed` row exists for every owner who has ever written an
 * access rule, and /access is linked from not-found for exactly this person, so
 * the steady state was the broken state.
 *
 * `IN ('pending','grace','released')` is not a new idea in this codebase:
 * standby-resolve.ts:165 already scopes to those three. This resolver was the
 * outlier.
 *
 * A CLOSED release is deliberately NOT resolvable here. After a genuine close
 * the row is re-armed, so state alone cannot separate "your access ended" from
 * "nothing ever happened" — that distinction needs evidence the person actually
 * had access, and it lives in closure.ts where the evidence is.
 *
 * `audit` is opt-in because resolving is not viewing. The dashboard render is the
 * auditable event (Req 7.7); a page that merely asks "is there anything?" should
 * not fill an owner's audit chain with noise. With the predicate above, a calm
 * visit now resolves nothing and so writes nothing — previously every such visit
 * appended a `recipient_dashboard_viewed` entry for a release that never opened.
 *
 * `ownerId` SELECTS among several. Absent, it returns the first of a
 * deterministic order rather than an arbitrary row — see `resolveReleasesForUser`
 * below, which is where the multi-owner story actually lives. Callers that can
 * carry a choice should pass one; callers that cannot get a stable default
 * instead of a coin flip.
 */
export async function resolveReleaseForUser(
  userId: string,
  opts: { audit?: boolean; ownerId?: string } = {},
): Promise<ResolvedRelease | null> {
  const all = await resolveReleasesForUser(userId);

  const resolved = opts.ownerId
    ? (all.find((r) => r.ownerId === opts.ownerId) ?? null)
    : (all[0] ?? null);

  if (!resolved) return null;

  if (opts.audit) {
    await writeAuditEntry(resolved.ownerId, {
      actor: `recipient:${resolved.recipientId}`,
      action: 'recipient_dashboard_viewed',
      entity: 'release_state',
      entityId: resolved.releaseStateId,
      detail: { released: resolved.released, via: 'standby_session' },
    });
  }

  return resolved;
}

/**
 * EVERY open release this user is standing by for.
 *
 * 🔴 THE SINGULAR RESOLVER ABOVE USED `LIMIT 1` WITH NO TIEBREAK, so a contact
 * standing by for two owners with simultaneous open releases saw an ARBITRARY
 * one — and had no way to reach the other. That was carried as a known defect
 * (PROJECT.yaml `deferred:` session-access-multi-owner-limit1) on the reasoning
 * that /standby lists every relationship separately and is the linked path, so
 * the collapsed case had a correct door. True, and not enough: the person who
 * arrives at /access from an emergency email lands on one owner's plan with
 * nothing on the page even hinting the other exists.
 *
 * Two owners in crisis at once is rare. It is also EXACTLY the situation this
 * product is for — an adult child standing by for both parents — and "rare"
 * describes how often it happens, not how much it matters when it does.
 *
 * ORDER IS DETERMINISTIC, which the old query was not. Released first, because
 * something that is already open outranks something that might open; then by
 * owner id, which is arbitrary but STABLE — the same person gets the same
 * default on every request rather than whatever the planner returned first.
 * Display order is the caller's business; this only has ids.
 */
export async function resolveReleasesForUser(userId: string): Promise<ResolvedRelease[]> {
  const res = await query<{
    recipient_id: string;
    owner_id: string;
    release_state_id: string;
    trigger_type: string;
    state: string;
    version: string;
  }>(
    `SELECT r.id AS recipient_id, r.owner_id,
            rs.id AS release_state_id, rs.trigger_type, rs.state, rs.version
       FROM recipients r
       JOIN release_state rs ON rs.owner_id = r.owner_id
      WHERE r.claimed_user_id = $1
        AND coalesce(r.standby_state, 'invited') <> 'revoked'
        AND rs.state IN ('pending', 'grace', 'released')
      ORDER BY CASE rs.state WHEN 'released' THEN 0 ELSE 1 END, r.owner_id`,
    [userId],
  );

  return (res?.rows ?? []).map((row) => ({
    recipientId: row.recipient_id,
    ownerId: row.owner_id,
    releaseStateId: row.release_state_id,
    triggerType: row.trigger_type,
    state: row.state,
    released: row.state === 'released',
  }));
}
