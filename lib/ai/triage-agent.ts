/**
 * Triage Agent — dependency-ordered handoff plan (Requirement 13).
 *
 * Reads a recipient's scoped vault metadata (ZK boundary — getVaultMetadata
 * only, never KMS) and produces a step plan that:
 *  - orders items so every item appears AFTER its (in-scope) dependencies, with
 *    root credentials / dependency-free items first (Property 19, Req 13.2),
 *  - assigns each a time-horizon bucket (Property 20, Req 13.3),
 *  - for estate triggers, attaches provider-specific guidance (Req 13.4).
 *
 * Ordering/bucketing are deterministic (the importance_scores they consume come
 * from the LLM-based Intake Agent). On any failure it falls back to a flat
 * importance-desc list with a warning (Req 13.8).
 *
 * Feature: relay-h0-mvp
 * Requirements: 13.1–13.5, 13.8
 */

import { query } from '../db/connection';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';
import { bucketFor, type Bucket } from './buckets';

export { bucketFor, type Bucket } from './buckets';

export interface TriageStep {
  step: number;
  vault_item_id: string;
  title: string;
  bucket: Bucket;
  provider_guidance?: string;
  owner_annotation?: string;
}

export interface TriageResult {
  steps: TriageStep[];
  fallback: boolean;
  warning?: string;
}

function rankCompare(a: VaultMetadata, b: VaultMetadata): number {
  const root = (b.is_root_credential ? 1 : 0) - (a.is_root_credential ? 1 : 0);
  if (root !== 0) return root;
  if (b.importance_score !== a.importance_score) return b.importance_score - a.importance_score;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function providerGuidance(item: VaultMetadata): string | undefined {
  const hay = `${item.title} ${item.service_name ?? ''} ${item.url ?? ''}`.toLowerCase();
  if (hay.includes('apple') || hay.includes('icloud')) {
    return 'Apple Legacy Contact: on the owner\'s device, Settings → [name] → Sign-In & Security → Legacy Contact, or use the access key + death certificate at digital-legacy.apple.com.';
  }
  if (hay.includes('google') || hay.includes('gmail')) {
    return 'Google Inactive Account Manager: myaccount.google.com → Data & privacy → "Make a plan for your account"; otherwise submit a deceased-user request to Google.';
  }
  if (hay.includes('meta') || hay.includes('facebook') || hay.includes('instagram')) {
    return 'Meta memorialization: request memorialization or removal via facebook.com/help; a Legacy Contact (if set) can manage the memorialized account.';
  }
  return undefined;
}

/**
 * Builds the dependency-ordered plan. Dependencies outside the scoped set are
 * treated as already resolved. Cyclic/unresolvable remainder is appended in
 * importance order (defensive — valid DAGs never hit this).
 */
export function buildTriagePlan(items: VaultMetadata[], triggerType: string): TriageStep[] {
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep id → ids that depend on it

  for (const it of items) {
    const dep = it.depends_on_item_id && ids.has(it.depends_on_item_id) ? it.depends_on_item_id : null;
    inDegree.set(it.id, dep ? 1 : 0);
    if (dep) dependents.set(dep, [...(dependents.get(dep) ?? []), it.id]);
  }

  const order: VaultMetadata[] = [];
  const placed = new Set<string>();
  const available = items.filter((i) => (inDegree.get(i.id) ?? 0) === 0);

  while (available.length > 0) {
    available.sort(rankCompare);
    const next = available.shift()!;
    order.push(next);
    placed.add(next.id);
    for (const depId of dependents.get(next.id) ?? []) {
      inDegree.set(depId, (inDegree.get(depId) ?? 0) - 1);
      if (inDegree.get(depId) === 0) available.push(byId.get(depId)!);
    }
  }

  if (order.length < items.length) {
    const remaining = items.filter((i) => !placed.has(i.id)).sort((a, b) => b.importance_score - a.importance_score);
    order.push(...remaining);
  }

  const isEstate = triggerType === 'estate';
  return order.map((it, idx) => ({
    step: idx + 1,
    vault_item_id: it.id,
    title: it.title,
    bucket: bucketFor(it),
    ...(isEstate && providerGuidance(it) ? { provider_guidance: providerGuidance(it) } : {}),
    ...(it.backup_note ? { owner_annotation: it.backup_note } : {}),
  }));
}

function flatFallback(items: VaultMetadata[]): TriageStep[] {
  return items
    .slice()
    .sort((a, b) => b.importance_score - a.importance_score)
    .map((it, idx) => ({ step: idx + 1, vault_item_id: it.id, title: it.title, bucket: bucketFor(it) }));
}

/** Runs triage for a recipient scoped to a trigger. */
export async function runTriage(
  ownerId: string,
  recipientId: string,
  triggerType: string,
): Promise<TriageResult> {
  const scopedRows = await query<{ vault_item_id: string }>(
    `SELECT vault_item_id FROM access_rules
      WHERE owner_id = $1 AND recipient_id = $2 AND trigger_type = $3`,
    [ownerId, recipientId, triggerType],
  );
  const scopedIds = new Set(scopedRows.rows.map((r) => String(r.vault_item_id)));

  const items = (await getVaultMetadata(ownerId)).filter((i) => scopedIds.has(i.id));
  if (items.length === 0) return { steps: [], fallback: false };

  try {
    return { steps: buildTriagePlan(items, triggerType), fallback: false };
  } catch {
    return {
      steps: flatFallback(items),
      fallback: true,
      warning: 'Handoff plan unavailable — showing items by importance.',
    };
  }
}
