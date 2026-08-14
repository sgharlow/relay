/**
 * Coverage analysis — which items nobody can reach.
 *
 * An uncovered critical item is the failure that stays invisible until the
 * moment it matters: the trigger fires, and the one account the family needed
 * has no recipient scoped to it (J4-R5, J4-R13).
 *
 * Metadata only (CC2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R5, J4-R13
 */

import type { PolicyItem } from './policy-predicate';

export interface Coverage {
  /** Ids of critical items no rule reaches, in stable order. */
  uncoveredCritical: string[];
  /** Distinct items granted, per recipient. */
  byRecipient: Record<string, number>;
  circleComplete: boolean;
}

/**
 * Root credentials count as critical regardless of their scored criticality —
 * they are the reset path for everything else, so leaving one unreachable
 * strands the whole vault.
 */
function isCritical(item: PolicyItem): boolean {
  return item.criticality === 'critical' || item.is_root_credential;
}

export function computeCoverage(
  items: PolicyItem[],
  rules: { vault_item_id: string; recipient_id: string }[],
): Coverage {
  const known = new Set(items.map((i) => i.id));

  // Ignore rules pointing at items that no longer exist — they cover nothing.
  const live = rules.filter((r) => known.has(r.vault_item_id));
  const covered = new Set(live.map((r) => r.vault_item_id));

  const uncoveredCritical = items
    .filter((i) => isCritical(i) && !covered.has(i.id))
    .map((i) => i.id)
    .sort();

  const byRecipient: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of live) {
    const key = `${r.recipient_id}::${r.vault_item_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byRecipient[r.recipient_id] = (byRecipient[r.recipient_id] ?? 0) + 1;
  }

  /*
    🔴 AN EMPTY VAULT USED TO REPORT A COMPLETE CIRCLE. `circleComplete` was
    `uncoveredCritical.length === 0`, which is vacuously true when there are no
    items at all — so a brand-new owner with nothing in their vault and nobody
    named was shown the sage reassurance "Every critical item has someone who
    can reach it." Zero of zero is not coverage; it is an empty room.

    That is the single most-repeated failure shape in this codebase — a green
    signal that is wrong — and this is the screen whose whole job is to tell an
    owner whether their plan would actually work. The banner that already exists
    on every owner page says "Nothing is in your vault yet, so there is nothing
    anyone could reach", so the two components were contradicting each other on
    the same screen: one calm-green, one accurate.

    `covered.size > 0` rather than `items.length > 0`: a vault holding only
    non-critical items with nobody named would otherwise still claim
    completeness, because nothing in it is critical. Completeness now requires
    that at least one item is genuinely reachable by somebody.
  */
  return {
    uncoveredCritical,
    byRecipient,
    circleComplete: uncoveredCritical.length === 0 && covered.size > 0,
  };
}
