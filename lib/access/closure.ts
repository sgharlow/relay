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
import { resolveReleaseForUser } from './session-access';

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
 * Returns null for a user who is not a claimed recipient, which reads as "say
 * nothing" exactly as an unverifiable token does.
 */
export async function getClosureSummaryForUser(userId: string): Promise<ClosureSummary | null> {
  const resolved = await resolveReleaseForUser(userId);
  if (!resolved) return null;
  return summaryFor(resolved.recipientId, resolved.releaseStateId);
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
