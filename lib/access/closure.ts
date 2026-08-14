/**
 * The graceful close (J9-R4).
 *
 * A recipient whose access has been closed used to see "This access link is
 * invalid or has expired." Correct, safe, and the wrong thing to show someone
 * who dropped everything to help during a family emergency. It reads as a
 * malfunction or an accusation, and it is the last thing the product ever says
 * to them — J9 is the referral moment, and this was its final screen.
 *
 * WHO IS TOLD, AND WHY THAT IS SAFE. The graceful message is shown ONLY to a
 * bearer whose token passes signature verification. That token was minted by us
 * for one specific (recipient, release_state, version); holding a validly signed
 * one is proof of having been granted access, so telling that person their
 * access has since closed reveals nothing they did not already know. Anything
 * that fails verification — forged, malformed, truncated, expired-by-`exp` —
 * still gets the flat generic error, because for an unknown bearer even the
 * existence of a vault is not ours to confirm.
 *
 * WHAT IS DISCLOSED. Only facts about the bearer's own session: how many items
 * they were granted, which ones they actually opened, and when. Items they were
 * never granted are never counted or named, and no secret material is touched —
 * this module never reads ciphertext, wrapped keys, or KMS ids.
 *
 * Feature: relay-h0-mvp
 * Requirements: J9-R4, 7.8
 */

import { query } from '../db/connection';
import { verifyRecipientToken } from '../auth/recipient-token';

export interface ClosureItem {
  /** Item label — the recipient already saw this while access was open. */
  title: string;
  openedAt: string;
}

export interface ClosureSummary {
  /** Items the recipient was granted under this release. */
  grantedCount: number;
  /** The ones they actually opened, most recent first. */
  opened: ClosureItem[];
  /** ISO timestamp of their first activity, or null if they never looked. */
  firstSeenAt: string | null;
  /** ISO timestamp of their last activity, or null. */
  lastSeenAt: string | null;
  /** Whole hours between first and last activity; 0 for a single visit. */
  hoursOfAccess: number;
}

interface TokenPayload {
  recipientId: string;
  releaseStateId: string;
  version: string;
}

/**
 * Builds the closure summary for a validly-signed but no-longer-current token.
 *
 * Returns null when the token does not verify — the caller must then fall back
 * to the flat generic error. Never throws for an untrusted bearer.
 */
export async function getClosureSummary(token: string): Promise<ClosureSummary | null> {
  let payload: TokenPayload;
  try {
    payload = (await verifyRecipientToken(token)) as unknown as TokenPayload;
  } catch {
    return null; // Unverified bearer — say nothing.
  }
  return summaryFor(payload.recipientId, payload.releaseStateId);
}

/**
 * The same summary for a CLAIMED recipient who is signed in.
 *
 * THE DEFECT THIS CLOSES, seen on production 2026-08-12: when the owner checked
 * back in, the session path fell through to "This access link is invalid or has
 * expired." There is no link on this path — and that sentence is the exact one
 * the graceful close exists to replace, shown to somebody who dropped everything
 * during an emergency. J9 is the differentiator; getting its last screen wrong
 * on the primary path undoes the journey it was built for.
 *
 * 🔴 IT MUST ANSWER "DID THIS PERSON ACTUALLY HAVE ACCESS?", NOT "IS THERE A ROW?"
 * This used to delegate to resolveReleaseForUser, which matched any release_state
 * for the owner regardless of state — so a recipient for whom nothing had ever
 * opened got a full closure summary, complete with an item count and a duration.
 * Now that resolveReleaseForUser correctly ignores non-open rows, delegating to
 * it would fail the opposite way: after a genuine close the row is re-armed, so
 * the real J9 case would resolve nothing and fall back to the flat error.
 *
 * State cannot answer this question in either direction. Evidence can: the
 * audit log records what this recipient actually did, it is append-only and
 * hash-chained, and a person who never had access has nothing in it. So the
 * closure screen is now gated on an audit entry showing this recipient viewed a
 * dashboard or opened an item — which is precisely the claim the screen makes.
 *
 * Returns null for a user who is not a claimed recipient, and for one who never
 * had access — both of which read as "say nothing", exactly as an unverifiable
 * token does.
 */
export async function getClosureSummaryForUser(userId: string): Promise<ClosureSummary | null> {
  // The most recent release this person demonstrably had open, by their own
  // footprint in the owner's chain. `recipient_dashboard_viewed` is written only
  // when a release actually resolved; `vault_item_decrypted` requires a released
  // state and a matching access rule (Property 6). Neither can exist for someone
  // who was never given anything.
  const evidence = await query<{ recipient_id: string; release_state_id: string }>(
    `SELECT r.id AS recipient_id, rs.id AS release_state_id
       FROM recipients r
       JOIN release_state rs ON rs.owner_id = r.owner_id
       JOIN audit_log a ON a.owner_id = r.owner_id
                       AND a.actor = 'recipient:' || r.id
                       AND a.action IN ('recipient_dashboard_viewed', 'vault_item_decrypted')
      WHERE r.claimed_user_id = $1
        AND coalesce(r.standby_state, 'invited') <> 'revoked'
      ORDER BY a.ts DESC
      LIMIT 1`,
    [userId],
  );

  const row = evidence.rows[0];
  if (!row) return null;
  return summaryFor(row.recipient_id, row.release_state_id);
}

async function summaryFor(
  recipientId: string,
  releaseStateId: string,
): Promise<ClosureSummary | null> {
  const payload = { recipientId, releaseStateId };
  const rs = await query<{ owner_id: string; trigger_type: string; version: string }>(
    `SELECT owner_id, trigger_type, version FROM release_state WHERE id = $1 LIMIT 1`,
    [payload.releaseStateId],
  );
  if (rs.rowCount === 0 || rs.rows.length === 0) return null;
  const { owner_id: ownerId, trigger_type: triggerType } = rs.rows[0];

  // Scope of the grant. Counted from access_rules rather than from anything the
  // recipient sent, so a tampered token cannot inflate it.
  const granted = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM access_rules
      WHERE owner_id = $1 AND recipient_id = $2 AND trigger_type = $3`,
    [ownerId, payload.recipientId, triggerType],
  );
  const grantedCount = Number(granted.rows[0]?.n ?? 0);

  // What they opened. Authorized decrypts only: a denied attempt is not an
  // "item you opened", and listing it would be both wrong and alarming.
  const opened = await query<{ entity_id: string; ts: string; title: string | null }>(
    `SELECT a.entity_id, a.ts, v.title
       FROM audit_log a
       LEFT JOIN vault_items v ON v.id = a.entity_id
      WHERE a.owner_id = $1
        AND a.actor = $2
        AND a.action = 'vault_item_decrypted'
        AND a.detail->>'outcome' = 'authorized'
      ORDER BY a.ts DESC`,
    [ownerId, `recipient:${payload.recipientId}`],
  );

  // Deduplicate by item — opening the same credential three times is one item
  // they saw, not three. Keeps the most recent open.
  const seen = new Set<string>();
  const items: ClosureItem[] = [];
  for (const row of opened.rows) {
    if (!row.entity_id || seen.has(row.entity_id)) continue;
    seen.add(row.entity_id);
    items.push({ title: row.title ?? 'An item', openedAt: new Date(row.ts).toISOString() });
  }

  // The window spans ALL of this recipient's activity, including dashboard
  // views, so someone who looked but opened nothing still gets a truthful span.
  const activity = await query<{ first_ts: string | null; last_ts: string | null }>(
    `SELECT min(ts) AS first_ts, max(ts) AS last_ts
       FROM audit_log WHERE owner_id = $1 AND actor = $2`,
    [ownerId, `recipient:${payload.recipientId}`],
  );
  const firstRaw = activity.rows[0]?.first_ts ?? null;
  const lastRaw = activity.rows[0]?.last_ts ?? null;
  const firstSeenAt = firstRaw ? new Date(firstRaw).toISOString() : null;
  const lastSeenAt = lastRaw ? new Date(lastRaw).toISOString() : null;

  const hoursOfAccess =
    firstSeenAt && lastSeenAt
      ? Math.max(0, Math.floor((Date.parse(lastSeenAt) - Date.parse(firstSeenAt)) / 3_600_000))
      : 0;

  return { grantedCount, opened: items, firstSeenAt, lastSeenAt, hoursOfAccess };
}
