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
 * Resolves the release a signed-in recipient can currently open, if any.
 *
 * Returns `null` when this user is not a claimed recipient for anyone — which is
 * the normal case for an owner or a verifier, and must not be an error.
 *
 * `audit` is opt-in because resolving is not viewing. The dashboard render is the
 * auditable event (Req 7.7); a page that merely asks "is there anything?" should
 * not fill an owner's audit chain with noise.
 */
export async function resolveReleaseForUser(
  userId: string,
  opts: { audit?: boolean } = {},
): Promise<ResolvedRelease | null> {
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
      ORDER BY CASE rs.state WHEN 'released' THEN 0 ELSE 1 END
      LIMIT 1`,
    [userId],
  );

  const row = res.rows[0];
  if (!row) return null;

  const resolved: ResolvedRelease = {
    recipientId: row.recipient_id,
    ownerId: row.owner_id,
    releaseStateId: row.release_state_id,
    triggerType: row.trigger_type,
    state: row.state,
    released: row.state === 'released',
  };

  if (opts.audit) {
    await writeAuditEntry(row.owner_id, {
      actor: `recipient:${row.recipient_id}`,
      action: 'recipient_dashboard_viewed',
      entity: 'release_state',
      entityId: row.release_state_id,
      detail: { released: resolved.released, via: 'standby_session' },
    });
  }

  return resolved;
}
