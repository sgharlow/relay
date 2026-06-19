/**
 * Prioritization Agent — gap detection (Requirement 12).
 *
 * Scans owner vault metadata (ZK boundary — getVaultMetadata only, never KMS)
 * and derives a ranked list of high-consequence gaps:
 *  - CUSTODY_RISK: an irreplaceable item with no designated recipient OR an
 *    empty backup note (Req 12.3).
 *  - MISSING_NOTE: no plain-language "what this is for" note (Req 12.1).
 *
 * Gaps are DERIVED on each call (Req 12.1/12.6 — recompute on load/update), so
 * resolving a gap removes it on the next scan without persisting a flag. Ranking:
 * root credentials first, then importance_score descending (Req 12.2). Each gap
 * carries a plain-language consequence (Req 12.4).
 *
 * Feature: relay-h0-mvp
 * Requirements: 12.1–12.5
 */

import { query } from '../db/connection';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';

export type GapType = 'CUSTODY_RISK' | 'MISSING_NOTE';

export interface Gap {
  vault_item_id: string;
  title: string;
  gap_type: GapType;
  consequence: string;
  is_root_credential: boolean;
  importance_score: number;
}

export interface PrioritizeResult {
  gaps: Gap[];
  custodyRiskCount: number;
}

function hasNote(item: VaultMetadata): boolean {
  return !!item.backup_note && item.backup_note.trim().length > 0;
}

function custodyConsequence(hasRecipient: boolean, note: boolean): string {
  if (!hasRecipient) {
    return 'This item is irreplaceable and has no designated recipient — if something happens to you, no one is authorized to retrieve it.';
  }
  if (!note) {
    return 'This item is irreplaceable and has no backup note — a recipient may not know where the original is kept or how to recover it.';
  }
  return 'Custody risk.';
}

/**
 * Pure gap detector. `itemIdsWithRecipient` is the set of vault item ids that
 * have at least one access_rule (a designated recipient).
 */
export function detectGaps(items: VaultMetadata[], itemIdsWithRecipient: Set<string>): Gap[] {
  const gaps: Gap[] = [];
  for (const item of items) {
    const note = hasNote(item);
    const hasRecipient = itemIdsWithRecipient.has(item.id);

    if (item.irreplaceable && (!hasRecipient || !note)) {
      gaps.push(makeGap(item, 'CUSTODY_RISK', custodyConsequence(hasRecipient, note)));
      continue; // custody risk supersedes a plain missing-note for this item
    }
    if (!note) {
      gaps.push(
        makeGap(
          item,
          'MISSING_NOTE',
          'No plain-language note. A recipient may not understand what this account is for or how to use it.',
        ),
      );
    }
  }
  return rankGaps(gaps);
}

function makeGap(item: VaultMetadata, gap_type: GapType, consequence: string): Gap {
  return {
    vault_item_id: item.id,
    title: item.title,
    gap_type,
    consequence,
    is_root_credential: item.is_root_credential,
    importance_score: item.importance_score,
  };
}

/** Root credentials first, then importance_score descending (Req 12.2). */
export function rankGaps(gaps: Gap[]): Gap[] {
  return gaps.slice().sort((a, b) => {
    const root = (b.is_root_credential ? 1 : 0) - (a.is_root_credential ? 1 : 0);
    if (root !== 0) return root;
    return b.importance_score - a.importance_score;
  });
}

export async function runPrioritize(ownerId: string): Promise<PrioritizeResult> {
  const items = await getVaultMetadata(ownerId);

  const ruleRows = await query<{ vault_item_id: string }>(
    `SELECT DISTINCT vault_item_id FROM access_rules WHERE owner_id = $1`,
    [ownerId],
  );
  const itemIdsWithRecipient = new Set(ruleRows.rows.map((r) => String(r.vault_item_id)));

  const gaps = detectGaps(items, itemIdsWithRecipient);
  return { gaps, custodyRiskCount: gaps.filter((g) => g.gap_type === 'CUSTODY_RISK').length };
}
