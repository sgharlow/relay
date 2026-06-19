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
import type { ReleaseStateRow } from '../release/state-machine';

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
}

export interface AccessDashboard {
  state: string;
  released: boolean;
  items: AccessItem[];
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

function verifyTokenOr403(token: string) {
  try {
    return verifyRecipientToken(token);
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
): Promise<AccessItem[]> {
  const r = await query<Record<string, unknown>>(
    `SELECT vi.id, vi.title, vi.service_name, vi.url, vi.category, vi.type,
            vi.is_root_credential, vi.importance_score, vi.depends_on_item_id, ar.scope
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
  const payload = verifyTokenOr403(token);
  const rs = await readReleaseState(payload.releaseStateId);
  assertVersion(rs, payload.version);

  const scoped = await fetchScopedItems(payload.recipientId, rs.trigger_type, rs.owner_id);
  const released = rs.state === 'released';

  // Page render is always audited (Req 7.7).
  await writeAuditEntry(rs.owner_id, {
    actor: `recipient:${payload.recipientId}`,
    action: 'recipient_dashboard_viewed',
    entity: 'release_state',
    entityId: rs.id,
    detail: { released, scopedCount: scoped.length },
  });

  return {
    state: rs.state,
    released,
    items: released ? rankAccessItems(scoped) : scoped.map(toLimited),
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

export async function decryptAccessItem(token: string, itemId: string): Promise<DecryptResult> {
  const payload = verifyTokenOr403(token);
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

  if (String(rs.version) !== String(payload.version)) return deny('Session is stale');
  if (rs.state !== 'released') return deny('Release is not active');

  const rule = await query<{ id: string }>(
    `SELECT id FROM access_rules
      WHERE recipient_id = $1 AND vault_item_id = $2 AND trigger_type = $3
      LIMIT 1`,
    [payload.recipientId, itemId, rs.trigger_type],
  );
  if (rule.rowCount === 0 || rule.rows.length === 0) return deny('Item not in scope');

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
