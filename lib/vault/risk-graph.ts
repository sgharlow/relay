/**
 * Risk-graph reveal — the J1 "aha" moment.
 *
 * Names the single item in the owner's OWN entries that the most other items
 * depend on, and says what that means in one sentence. This is what converts
 * "we'll organise your parent's affairs" from a claim into a demonstrated fact,
 * and it renders before any price is shown (J1-R6).
 *
 * Operates on non-secret metadata only (CC2), and reuses `gatesCount` from
 * dashboard-view rather than re-implementing the dependency count.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R6
 */

import { gatesCount, type DashboardItem } from './dashboard-view';

export interface Reveal {
  rootId: string | null;
  rootTitle: string | null;
  gatedCount: number;
  gatedTitles: string[];
  totalCount: number;
  headline: string;
}

export function computeReveal(items: DashboardItem[]): Reveal {
  const present = new Set(items.map((i) => i.id));

  // Drop self-edges before counting. An item cannot gate itself, and
  // `gatesCount` would otherwise include one — inflating the headline number on
  // data the intake agent could plausibly emit. Sanitising here rather than
  // changing gatesCount keeps the vault dashboard's behaviour untouched.
  const graph = items.map((i) =>
    i.depends_on_item_id === i.id ? { ...i, depends_on_item_id: null } : i,
  );

  // Highest in-degree wins; ties break alphabetically by title so the reveal is
  // deterministic for the same vault.
  const ranked = graph
    .map((i) => ({ item: i, degree: gatesCount(i.id, graph) }))
    .filter(({ item, degree }) => degree > 0 && present.has(item.id))
    .sort((a, b) => b.degree - a.degree || a.item.title.localeCompare(b.item.title));

  const top = ranked[0];

  if (!top) {
    return {
      rootId: null,
      rootTitle: null,
      gatedCount: 0,
      gatedTitles: [],
      totalCount: items.length,
      headline:
        'Add a few more accounts and we will show you which single one everything else depends on.',
    };
  }

  const gatedTitles = graph
    .filter((i) => i.depends_on_item_id === top.item.id)
    .map((i) => i.title)
    .sort((a, b) => a.localeCompare(b));

  return {
    rootId: top.item.id,
    rootTitle: top.item.title,
    gatedCount: top.degree,
    gatedTitles,
    totalCount: items.length,
    headline:
      `${top.item.title} is the reset path for ${top.degree} of the ${items.length} accounts ` +
      `you just entered. If you can't get into it, you can't reset any of them.`,
  };
}
