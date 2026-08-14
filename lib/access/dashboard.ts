/**
 * Recipient access dashboard (Requirement 7).
 *
 *  - getAccessDashboard(token)   — verifies the recipient JWT, strongly-consistent
 *    reads the release_state, checks the token `version` matches (stale tokens →
 *    403), and returns the recipient's scoped items. When RELEASED, items are
 *    ranked (root credentials first, then importance desc, ties by title —
 *    Property 15) with full metadata; otherwise only the limited pending fields
 *    are returned (no ciphertext, Req 7.3).
 *  - decryptAccessItem(token,id) — re-checks RELEASED + version + an access_rule
 *    covering the item BEFORE calling KMS (Req 7.5); writes a `vault_item_decrypted`
 *    audit entry for EVERY request with `detail.outcome` authorized/denied (Req 7.8);
 *    returns { plaintext_data_key, ciphertext, kms_key_id } on success.
 *
 * Verifiers/recipients never receive secret material beyond their own scoped
 * items, and a denied decrypt never calls KMS.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1–7.8
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { verifyRecipientToken } from '../auth/recipient-token';
import { decryptDataKey } from '../kms/kms-client';
import { resolveReleaseForUser } from './session-access';
import type { ReleaseStateRow } from '../release/state-machine';
import { isDelayElapsed, opensAt } from '../rules/release-delay';
import { getOwnerLabel } from '../people/owner-label';
import { hasAcknowledgedLimits } from './acknowledgement';

export class AccessError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'AccessError';
    Object.setPrototypeOf(this, AccessError.prototype);
  }
}

export interface AccessItem {
  id: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  type: string;
  scope?: string;
  is_root_credential?: boolean;
  importance_score?: number;
  depends_on_item_id?: string | null;
  /**
   * ISO date this staged item opens, when it is not open yet. Absent means
   * available now. Descriptive only — the gate is `authorizeAndDecryptItem`,
   * which re-derives this rather than trusting anything sent to a client.
   */
  opens_at?: string;
}

export interface AccessDashboard {
  state: string;
  released: boolean;
  items: AccessItem[];
  /**
   * Who named them, for the statement in lib/access/acknowledgement.ts. A
   * disclosure that says "the person who named you" reads like boilerplate; one
   * that says their name reads like it is about this family.
   */
  ownerLabel: string;
  /**
   * False until the recipient has read what this is and is not, and said so.
   * The client gates the plan on it. See lib/access/acknowledgement.ts for why
   * the record matters more than the render.
   */
  acknowledgedLimits: boolean;
}

// ---------------------------------------------------------------------------
// Ranking (Property 15)
// ---------------------------------------------------------------------------

function compareTitle(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Root credentials first; within each group descending importance_score; ties
 * broken alphabetically by title (Property 15, Req 7.4). Pure + stable.
 */
export function rankAccessItems(items: AccessItem[]): AccessItem[] {
  return items.slice().sort((a, b) => {
    const aRoot = a.is_root_credential ? 1 : 0;
    const bRoot = b.is_root_credential ? 1 : 0;
    if (aRoot !== bRoot) return bRoot - aRoot; // roots (1) before non-roots (0)
    const aScore = a.importance_score ?? 0;
    const bScore = b.importance_score ?? 0;
    if (aScore !== bScore) return bScore - aScore; // importance desc
    return compareTitle(a.title, b.title); // ties: title asc
  });
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

/** Strongly-consistent release_state read (DSQL reads are strongly consistent). */
async function readReleaseState(id: string): Promise<ReleaseStateRow> {
  const r = await query<ReleaseStateRow>(`SELECT * FROM release_state WHERE id = $1 LIMIT 1`, [id]);
  if (r.rowCount === 0 || r.rows.length === 0) {
    throw new AccessError('Release state not found', 404);
  }
  return r.rows[0];
}

async function verifyTokenOr403(token: string) {
  try {
    // The `await` must stay INSIDE the try. Returning the promise unawaited
    // would let the rejection escape this catch entirely, and a forged token
    // would surface as an unhandled 500 instead of the 403 it has to be.
    return await verifyRecipientToken(token);
  } catch {
    throw new AccessError('Invalid recipient token', 403);
  }
}

function assertVersion(rs: ReleaseStateRow, tokenVersion: string): void {
  if (String(rs.version) !== String(tokenVersion)) {
    throw new AccessError('Session is stale (release version changed)', 403);
  }
}

async function fetchScopedItems(
  recipientId: string,
  triggerType: string,
  ownerId: string,
  releasedAt: string | null = null,
): Promise<AccessItem[]> {
  const r = await query<Record<string, unknown>>(
    `SELECT vi.id, vi.title, vi.service_name, vi.url, vi.category, vi.type,
            vi.is_root_credential, vi.importance_score, vi.depends_on_item_id, ar.scope,
            ar.release_after_days
       FROM vault_items vi
       JOIN access_rules ar ON ar.vault_item_id = vi.id
      WHERE ar.recipient_id = $1 AND ar.trigger_type = $2 AND vi.owner_id = $3`,
    [recipientId, triggerType, ownerId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    service_name: (row.service_name as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    type: String(row.type),
    scope: row.scope as string | undefined,
    is_root_credential: Boolean(row.is_root_credential),
    importance_score: Number(row.importance_score),
    depends_on_item_id: (row.depends_on_item_id as string | null) ?? null,
    /*
      A staged item is LISTED but marked, rather than hidden. Hiding it would
      tell the person nothing is coming and invite them to conclude the plan is
      broken; the count and the category were always visible to them anyway.
      What stays hidden is the contents, and that is the gate's job.
    */
    ...(isDelayElapsed(row.release_after_days as number | null, releasedAt)
      ? {}
      : {
          opens_at:
            opensAt(row.release_after_days as number | null, releasedAt)?.toISOString() ??
            undefined,
        }),
  }));
}

function toLimited(item: AccessItem): AccessItem {
  // Pending view exposes only non-sensitive descriptive fields (Req 7.3).
  return {
    id: item.id,
    title: item.title,
    service_name: item.service_name,
    url: item.url,
    category: item.category,
    type: item.type,
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getAccessDashboard(token: string): Promise<AccessDashboard> {
  const payload = await verifyTokenOr403(token);
  const rs = await readReleaseState(payload.releaseStateId);
  assertVersion(rs, payload.version);
  return buildDashboard(payload.recipientId, rs);
}

/**
 * The same dashboard, for a recipient resolved from a SESSION rather than a
 * token (Sprint D).
 *
 * No `assertVersion` here, and that is not an omission. The token path needs it
 * because a JWT carries a snapshot of `version` that can go stale between issue
 * and use; a session carries nothing, so this reads the row fresh on every call
 * and staleness cannot exist. Same guarantee, enforced in a better place.
 *
 * Both paths funnel into `buildDashboard`, so scoping, ranking, the limited-field
 * rule and the audit entry can never drift between them.
 */
export async function getAccessDashboardForRecipient(
  recipientId: string,
  releaseStateId: string,
): Promise<AccessDashboard> {
  const rs = await readReleaseState(releaseStateId);
  return buildDashboard(recipientId, rs);
}

async function buildDashboard(
  recipientId: string,
  rs: ReleaseStateRow,
): Promise<AccessDashboard> {
  const scoped = await fetchScopedItems(recipientId, rs.trigger_type, rs.owner_id, rs.released_at);
  const released = rs.state === 'released';

  // Page render is always audited (Req 7.7).
  await writeAuditEntry(rs.owner_id, {
    actor: `recipient:${recipientId}`,
    action: 'recipient_dashboard_viewed',
    entity: 'release_state',
    entityId: rs.id,
    detail: { released, scopedCount: scoped.length },
  });

  const [ownerLabel, acknowledgedLimits] = await Promise.all([
    getOwnerLabel(rs.owner_id),
    hasAcknowledgedLimits(rs.owner_id, recipientId),
  ]);

  return {
    state: rs.state,
    released,
    items: released ? rankAccessItems(scoped) : scoped.map(toLimited),
    ownerLabel,
    acknowledgedLimits,
  };
}

// ---------------------------------------------------------------------------
// Gated decrypt
// ---------------------------------------------------------------------------

export interface DecryptResult {
  plaintext_data_key: string;
  ciphertext: string;
  kms_key_id: string;
}

function byteaToBase64(v: unknown): string {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  return String(v);
}

/**
 * Who is asking, and by which route.
 *
 * A recipient TOKEN carries a snapshot of `release_state.version` taken when it
 * was minted, so the gate below has to compare it against the row — the gap
 * between those two is where staleness lives. A SESSION carries no version at
 * all: the row is read on this request and is the only source, so a re-arm
 * closes access by construction rather than by comparison. That is why `version`
 * is optional here and its absence is not a weaker check — it is the absence of
 * anything that could go stale.
 *
 * Everything downstream is identical for both, deliberately: same released
 * check, same Property 6 scope query, same audit-before-KMS ordering. The route
 * in is the only thing that differs.
 */
interface DecryptPrincipal {
  recipientId: string;
  releaseStateId: string;
  /** Token path only — the snapshot to reconcile against the row. */
  version?: string;
}

export async function decryptAccessItem(token: string, itemId: string): Promise<DecryptResult> {
  const payload = await verifyTokenOr403(token);
  return decryptForPrincipal(
    {
      recipientId: payload.recipientId,
      releaseStateId: payload.releaseStateId,
      version: String(payload.version),
    },
    itemId,
  );
}

/**
 * Decrypt for a CLAIMED recipient who is signed in — hybrid+6's primary path.
 *
 * Until this existed the session path could list a release plan and open
 * nothing: `/api/access` resolved a dashboard from the session, and every Reveal
 * then posted an empty token and took a 401. J8, the primary demand journey, did
 * not work on the architecture meant to replace the token.
 *
 * Membership is resolved from the database by `resolveReleaseForUser`, never
 * from the session token (§3.7 rule 1) — the JWT establishes WHO you are, and
 * what that person may open is a question only the row can answer.
 */
export async function decryptAccessItemForUser(
  userId: string,
  itemId: string,
): Promise<DecryptResult> {
  const resolved = await resolveReleaseForUser(userId);
  if (!resolved) {
    // Indistinguishable from a scope failure on purpose: "you are not a claimed
    // recipient" and "that item is not yours" tell an attacker different things.
    throw new AccessError('Item not in scope', 403);
  }
  return decryptForPrincipal(
    { recipientId: resolved.recipientId, releaseStateId: resolved.releaseStateId },
    itemId,
  );
}

async function decryptForPrincipal(
  payload: DecryptPrincipal,
  itemId: string,
): Promise<DecryptResult> {
  const rs = await readReleaseState(payload.releaseStateId);

  // Audit EVERY decrypt request (authorized or denied), before any KMS work (Req 7.8).
  const auditOutcome = (outcome: 'authorized' | 'denied') =>
    writeAuditEntry(rs.owner_id, {
      actor: `recipient:${payload.recipientId}`,
      action: 'vault_item_decrypted',
      entity: 'vault_item',
      entityId: itemId,
      detail: { outcome },
    });

  const deny = async (message: string): Promise<never> => {
    await auditOutcome('denied');
    throw new AccessError(message, 403);
  };

  // Token path only. A session has no snapshot to reconcile — see DecryptPrincipal.
  if (payload.version !== undefined && String(rs.version) !== payload.version) {
    return deny('Session is stale');
  }
  if (rs.state !== 'released') return deny('Release is not active');

  const rule = await query<{ id: string; release_after_days: number | null }>(
    `SELECT id, release_after_days FROM access_rules
      WHERE recipient_id = $1 AND vault_item_id = $2 AND trigger_type = $3
      LIMIT 1`,
    [payload.recipientId, itemId, rs.trigger_type],
  );
  if (rule.rowCount === 0 || rule.rows.length === 0) return deny('Item not in scope');

  /*
    🔴 THE STAGED DELAY WAS NOT ENFORCED HERE EITHER, added 2026-08-13. See
    lib/rules/release-delay.ts — the control was offered, stored and documented,
    and no gate consulted it.

    The denial message says WHEN rather than just "no": a recipient who was told
    something would be there needs to know it is coming, not conclude the plan is
    broken. It reveals nothing they were not already going to be given.
  */
  if (!isDelayElapsed(rule.rows[0].release_after_days, rs.released_at)) {
    const when = opensAt(rule.rows[0].release_after_days, rs.released_at);
    return deny(
      when
        ? `Not open yet — this one was set to open on ${when.toDateString()}.`
        : 'Not open yet — this one was set to open later.',
    );
  }

  const item = await query<{ ciphertext: unknown; wrapped_data_key: unknown; kms_key_id: string }>(
    `SELECT ciphertext, wrapped_data_key, kms_key_id
       FROM vault_items WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [itemId, rs.owner_id],
  );
  if (item.rowCount === 0 || item.rows.length === 0) return deny('Item not found');

  // Gates passed — now (and only now) call KMS.
  const plaintextDataKey = await decryptDataKey(byteaToBase64(item.rows[0].wrapped_data_key));
  await auditOutcome('authorized');

  return {
    plaintext_data_key: plaintextDataKey,
    ciphertext: byteaToBase64(item.rows[0].ciphertext),
    kms_key_id: String(item.rows[0].kms_key_id),
  };
}
