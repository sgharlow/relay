/**
 * Materializes access_policies into access_rules.
 *
 * `access_rules` stays the sole authority consulted by the KMS unwrap path;
 * this module only generates rows in it, tagged with `policy_id` so
 * reconciliation only ever revokes its own grants and never a hand-made one.
 *
 * Materialization is a DIFF, not an append. Append-only materialization
 * silently widens access on every edit: narrowing a policy would leave the old
 * grants in place (J4-R14).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R4, J4-R14, J4-R15
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import {
  matchesPolicy,
  selectMatching,
  type PolicyItem,
  type PolicyPredicate,
} from './policy-predicate';

export function diffGrants(
  desiredItemIds: string[],
  existingItemIds: string[],
): { toAdd: string[]; toRemove: string[] } {
  const desired = new Set(desiredItemIds);
  const existing = new Set(existingItemIds);

  return {
    toAdd: [...desired].filter((id) => !existing.has(id)).sort(),
    toRemove: [...existing].filter((id) => !desired.has(id)).sort(),
  };
}

export interface PolicyRow {
  id: string;
  recipient_id: string;
  trigger_type: string;
  scope: string;
  reversible: boolean;
  predicate: PolicyPredicate;
}

async function loadPolicy(ownerId: string, policyId: string): Promise<PolicyRow | null> {
  const res = await query<PolicyRow>(
    `SELECT id, recipient_id, trigger_type, scope, reversible, predicate
       FROM access_policies
      WHERE id = $1 AND owner_id = $2
      LIMIT 1`,
    [policyId, ownerId],
  );
  return res.rows[0] ?? null;
}

/** Metadata only — never selects ciphertext / wrapped_data_key / kms_key_id (CC2). */
async function loadPolicyItems(ownerId: string): Promise<PolicyItem[]> {
  const res = await query<PolicyItem>(
    `SELECT id, category, criticality, is_root_credential, irreplaceable,
            importance_score::float8 AS importance_score
       FROM vault_items
      WHERE owner_id = $1`,
    [ownerId],
  );
  return res.rows;
}

async function existingGrantIds(ownerId: string, policyId: string): Promise<string[]> {
  const res = await query<{ vault_item_id: string }>(
    `SELECT vault_item_id FROM access_rules WHERE owner_id = $1 AND policy_id = $2`,
    [ownerId, policyId],
  );
  return res.rows.map((r) => r.vault_item_id);
}

/**
 * What WOULD change if this policy's predicate became `next`. The owner sees
 * revocations before confirming them (J4-R14).
 */
export async function previewPolicyChange(
  ownerId: string,
  policyId: string,
  next: PolicyPredicate,
): Promise<{ toAdd: string[]; toRemove: string[] }> {
  const items = await loadPolicyItems(ownerId);

  return diffGrants(
    selectMatching(items, next).map((i) => i.id),
    await existingGrantIds(ownerId, policyId),
  );
}

export async function materializePolicy(
  ownerId: string,
  policyId: string,
): Promise<{ added: number; removed: number }> {
  const policy = await loadPolicy(ownerId, policyId);
  if (!policy) return { added: 0, removed: 0 };

  const items = await loadPolicyItems(ownerId);

  const { toAdd, toRemove } = diffGrants(
    selectMatching(items, policy.predicate).map((i) => i.id),
    await existingGrantIds(ownerId, policyId),
  );

  await withOccRetry(async () => {
    for (const itemId of toAdd) {
      await query(
        `INSERT INTO access_rules
           (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible, policy_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ownerId,
          itemId,
          policy.recipient_id,
          policy.trigger_type,
          policy.scope,
          policy.reversible,
          policyId,
        ],
      );
    }

    if (toRemove.length > 0) {
      // Scoped to this policy_id: a hand-made rule for the same item survives.
      await query(
        `DELETE FROM access_rules
          WHERE owner_id = $1 AND policy_id = $2 AND vault_item_id = ANY($3::uuid[])`,
        [ownerId, policyId, toRemove],
      );
    }
  });

  if (toAdd.length > 0 || toRemove.length > 0) {
    await writeAuditEntry(ownerId, {
      actor: `owner:${ownerId}`,
      action: 'policy_materialized',
      entity: 'access_policy',
      entityId: policyId,
      detail: { added: toAdd, removed: toRemove },
    });
  }

  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * Covers a newly created item against every existing policy, so an imported
 * item is not silently uncovered (J4-R4).
 */
export async function coverNewItem(
  ownerId: string,
  itemId: string,
): Promise<{ policiesMatched: number }> {
  const items = await loadPolicyItems(ownerId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { policiesMatched: 0 };

  const policies = await query<PolicyRow>(
    `SELECT id, recipient_id, trigger_type, scope, reversible, predicate
       FROM access_policies
      WHERE owner_id = $1`,
    [ownerId],
  );

  const matched = policies.rows.filter((p) => matchesPolicy(item, p.predicate));
  if (matched.length === 0) return { policiesMatched: 0 };

  await withOccRetry(async () => {
    for (const p of matched) {
      await query(
        `INSERT INTO access_rules
           (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible, policy_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ownerId, itemId, p.recipient_id, p.trigger_type, p.scope, p.reversible, p.id],
      );
    }
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'item_auto_covered',
    entity: 'vault_item',
    entityId: itemId,
    detail: { policyIds: matched.map((p) => p.id) },
  });

  return { policiesMatched: matched.length };
}

/**
 * Removes a recipient's policies before their rules cascade, so a deleted grant
 * cannot re-materialise on the next policy run (J4-R15).
 */
export async function deletePoliciesForRecipient(
  ownerId: string,
  recipientId: string,
): Promise<number> {
  const res = await query<{ id: string }>(
    `DELETE FROM access_policies
      WHERE owner_id = $1 AND recipient_id = $2
      RETURNING id`,
    [ownerId, recipientId],
  );
  return res.rows.length;
}
