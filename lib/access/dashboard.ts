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
import { byteaToBase64 } from '../db/bytea';
import { writeAuditEntry } from '../audit/audit-service';
import { verifyRecipientToken } from '../auth/recipient-token';
import { decryptDataKey } from '../kms/kms-client';
import { resolveReleasesForUser, type ResolvedRelease } from './session-access';
import type { ReleaseStateRow } from '../release/state-machine';
import { isDelayElapsed, opensAt } from '../rules/release-delay';
import { getOwnerLabel } from '../people/owner-label';
import { hasAcknowledgedLimits } from './acknowledgement';
import { orderByDependency } from '../ai/dependency-order';

/**
 * `explainable` marks a denial whose MESSAGE is safe and useful to show the
 * person who hit it.
 *
 * 🔴 THE DISTINCTION EXISTS BECAUSE MOST OF THESE MESSAGES ARE NOT FOR FAMILIES.
 * "Session is stale (release version changed)", "Item not in scope", "Release is
 * not active" are engineering sentences; showing them to a recipient mid-
 * emergency would be worse than the generic line. But one denial is a deliberate
 * product behaviour with a date attached — the staged delay — and the client used
 * to discard it, telling somebody to retry forever and report a bug for a plan
 * that was working exactly as the owner set it up.
 *
 * A flag rather than string-matching the message: sniffing "Not open yet" from
 * the client would break the moment anybody rewords it, and it would break
 * silently, back into the failure it fixed.
 */
export class AccessError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly explainable: boolean = false,
  ) {
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
   * The owner's plain-language note — what this account is for, or how to get in
   * if the stored password no longer works. Added 2026-08-17, alongside the write
   * path that had never existed.
   *
   * ⚠️ RELEASED VIEW ONLY, AND THAT IS A SECURITY LINE RATHER THAN A PREFERENCE.
   * `toLimited` (Req 7.3) is an ALLOW-LIST — it builds a fresh object from six
   * named descriptive fields — so this stays out of the pending view by
   * construction rather than by anyone remembering. That matters: a note can
   * legitimately read "recovery codes are in the desk drawer", which is precisely
   * the sentence that must not be readable before a release has been verified.
   * `dashboard.test.ts` pins it, so converting `toLimited` to a spread or a
   * deny-list fails rather than silently leaking.
   */
  backup_note?: string | null;
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
  return items.slice().sort(rankCompare);
}

function rankCompare(a: AccessItem, b: AccessItem): number {
  const aRoot = a.is_root_credential ? 1 : 0;
  const bRoot = b.is_root_credential ? 1 : 0;
  if (aRoot !== bRoot) return bRoot - aRoot; // roots (1) before non-roots (0)
  const aScore = a.importance_score ?? 0;
  const bScore = b.importance_score ?? 0;
  if (aScore !== bScore) return bScore - aScore; // importance desc
  return compareTitle(a.title, b.title); // ties: title asc
}

/**
 * The order a recipient is actually given the plan in (Req 13.2).
 *
 * 🔴 REQUIREMENT 13 WAS BUILT AND NEVER CALLED. lib/ai/triage-agent.ts computes
 * a dependency-ordered handoff plan, is fully tested, and had zero production
 * callers. This dashboard — the screen recipients read at release — selected
 * `depends_on_item_id` in its query and then sorted by importance alone, so the
 * product permanently shipped what the spec defines as the FALLBACK (13.8).
 *
 * The user-visible cost is specific: an importance-first list puts the bank
 * account before the email account it needs a reset code from, so the first
 * thing a grieving person tries is the thing that cannot work yet.
 *
 * RANKING IS NOT REDEFINED — IT IS CONSTRAINED. Req 7.4 and Property 15 govern
 * `rankAccessItems`, which is untouched and still decides every free choice;
 * this only refuses to place an item before something it depends on. Changing
 * the ranking rule itself would have been a contract change between two ratified
 * requirements, which is not a call to make silently.
 */
export function orderForHandoff(items: AccessItem[]): AccessItem[] {
  return orderByDependency(items, {
    id: (i) => i.id,
    dependsOn: (i) => i.depends_on_item_id,
    compare: rankCompare,
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
            vi.is_root_credential, vi.importance_score, vi.depends_on_item_id,
            vi.backup_note, ar.scope,
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
    backup_note: (row.backup_note as string | null) ?? null,
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
    items: released ? orderForHandoff(scoped) : scoped.map(toLimited),
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

// byteaToBase64 moved to lib/db/bytea.ts — one definition, three callers.

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
 * Membership is resolved from the database, never from the session token
 * (§3.7 rule 1) — the JWT establishes WHO you are, and what that person may open
 * is a question only the row can answer.
 *
 * 🔴 IT RESOLVED ONE RELEASE AND TRIED ONLY THAT ONE. A contact standing by for
 * two owners with simultaneous open releases could see the second owner's plan
 * (once /api/access learned to offer both) and then fail to open a single item
 * on it, because the decrypt resolved whichever release sorted first and looked
 * for the item under the wrong recipient. The dashboard would have listed items
 * that every Reveal refused.
 *
 * The release is chosen BY THE ITEM rather than by a parameter the client sends.
 * That is deliberate: a client-supplied owner is an input to be validated, and
 * the access rule already knows the answer authoritatively. It grants nothing
 * extra — every release considered is one this user is genuinely standing by
 * for, and `decryptForPrincipal` still applies every gate to whichever is chosen.
 */
export async function decryptAccessItemForUser(
  userId: string,
  itemId: string,
): Promise<DecryptResult> {
  const open = await resolveReleasesForUser(userId);
  if (open.length === 0) {
    // Indistinguishable from a scope failure on purpose: "you are not a claimed
    // recipient" and "that item is not yours" tell an attacker different things.
    throw new AccessError('Item not in scope', 403);
  }

  const resolved = open.length === 1 ? open[0] : ((await releaseCovering(open, itemId)) ?? open[0]);

  return decryptForPrincipal(
    { recipientId: resolved.recipientId, releaseStateId: resolved.releaseStateId },
    itemId,
  );
}

/**
 * Which of these releases actually scopes `itemId` to its recipient?
 *
 * Read-only and side-effect free ON PURPOSE. The obvious implementation — try
 * each release through `decryptForPrincipal` until one works — would write a
 * `denied` audit entry to every owner it tried, so one recipient opening one
 * item would leave a denial in a second family's tamper-evident log. An audit
 * chain that records things that did not happen is worse than one that misses
 * things.
 *
 * Returns null when nothing matches; the caller falls back to the first release
 * so the denial that follows is audited against a release this user really is
 * party to, rather than being swallowed.
 */
async function releaseCovering(
  open: ResolvedRelease[],
  itemId: string,
): Promise<ResolvedRelease | null> {
  const res = await query<{ recipient_id: string }>(
    `SELECT recipient_id FROM access_rules
      WHERE vault_item_id = $1 AND recipient_id = ANY($2::uuid[])`,
    [itemId, open.map((r) => r.recipientId)],
  );

  const owning = new Set((res?.rows ?? []).map((r) => r.recipient_id));
  return open.find((r) => owning.has(r.recipientId)) ?? null;
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

  const deny = async (message: string, explainable = false): Promise<never> => {
    await auditOutcome('denied');
    throw new AccessError(message, 403, explainable);
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
      // The one denial a recipient should read verbatim: it is not a fault, it
      // is the owner's plan, and the date is the whole point of saying it.
      true,
    );
  }

  // `kms_context_era` rides along in the same SELECT: how the row was wrapped
  // is a fact about the row, never something a caller may assert. It is NULL on
  // every row today (phase B of docs/encryption-context-rollout.md), so this
  // decrypt is byte-for-byte the call it has always been.
  const item = await query<{
    ciphertext: unknown;
    wrapped_data_key: unknown;
    kms_key_id: string;
    kms_context_era: string | null;
  }>(
    `SELECT ciphertext, wrapped_data_key, kms_key_id, kms_context_era
       FROM vault_items WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [itemId, rs.owner_id],
  );
  if (item.rowCount === 0 || item.rows.length === 0) return deny('Item not found');

  // Gates passed — now (and only now) call KMS.
  const plaintextDataKey = await decryptDataKey(byteaToBase64(item.rows[0].wrapped_data_key), {
    era: item.rows[0].kms_context_era ?? null,
    ownerId: rs.owner_id,
  });
  await auditOutcome('authorized');

  return {
    plaintext_data_key: plaintextDataKey,
    ciphertext: byteaToBase64(item.rows[0].ciphertext),
    kms_key_id: String(item.rows[0].kms_key_id),
  };
}
