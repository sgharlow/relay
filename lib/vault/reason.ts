/**
 * Why an item sits where it sits, in a sentence.
 *
 * The audit found the vault list showing a bare `50` and an `n/a` chip with no
 * column header — the importance engine, which is the smartest thing in the
 * product, rendering as debug output. A number between 0 and 100 is not an
 * insight; it is a score the reader has to interpret with no scale to interpret
 * it against.
 *
 * So the score becomes the ORDER, and the thing that produced the score becomes
 * a sentence. "Unlocks password resets for 4 of your other accounts" is what the
 * dependency graph actually knows, said the way a person would say it. Nothing
 * was added to the schema — this reads the same two fields the audit found bare.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.4, J2-R7
 */

import type { DashboardItem } from './dashboard-view';

/**
 * The most consequential true thing about this item, or null when there is
 * nothing worth saying — an empty sentence is better than a padded one.
 */
export function reasonFor(item: DashboardItem, gates: number): string | null {
  if (gates > 0) {
    // The dependency edge, which is the strongest claim available: other things
    // literally cannot be recovered without this.
    return `Unlocks password resets for ${gates} of your other accounts`;
  }

  if (item.is_root_credential) {
    // Marked as a root by the owner or the intake agent, but nothing points at
    // it yet — usually means the rest of the vault is not entered.
    return 'Other accounts recover through this one';
  }

  if (item.criticality === 'critical') {
    return 'You marked this as one that matters most';
  }

  return null;
}

/**
 * Items in the order a crisis needs them, most consequential first.
 *
 * Deliberately one list rather than category groups. Categories are how the
 * data is filed; "what would someone need first" is the question the owner is
 * actually asking, and the answer is not alphabetical.
 */
export function rankItems(items: DashboardItem[]): DashboardItem[] {
  return items.slice().sort((a, b) => {
    const score = (b.importance_score ?? 0) - (a.importance_score ?? 0);
    if (score !== 0) return score;
    // Stable and meaningful tiebreak: roots first, then by title, so the order
    // never shuffles between renders on equal scores.
    const root = Number(b.is_root_credential) - Number(a.is_root_credential);
    if (root !== 0) return root;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}
