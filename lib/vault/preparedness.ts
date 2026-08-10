/**
 * How prepared is this vault, in one sentence a person can act on.
 *
 * The audit's last open finding: a preparedness product never states how
 * prepared you are. It listed blockers — "no recipients yet" — which says what
 * is missing without saying what it costs. "Sarah could reach 3 of the 5 things
 * that matter" is the same information told as a consequence, and it is the
 * only number on the screen an owner should care about.
 *
 * WHAT COUNTS AS A THING THAT MATTERS. Items the owner or the intake agent
 * marked critical, plus root credentials — the accounts other accounts recover
 * through. If nothing is marked yet (a brand-new vault), every item counts,
 * because at that point everything is equally unproven.
 *
 * WHAT COUNTS AS REACHABLE. An item with at least one access rule pointing at a
 * recipient. Not "has a recipient somewhere in the vault" — the rule is what
 * actually opens the item, and a vault full of people with no rules opens
 * nothing.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13, CC9
 */

export interface PreparednessInput {
  /** Every vault item, with the two fields that decide whether it matters. */
  items: { id: string; title: string; criticality: string | null; is_root_credential: boolean }[];
  /** vault_item_id for every access rule that exists. */
  ruledItemIds: string[];
  /** How many people could confirm an emergency is real. */
  verifierCount: number;
}

export interface Preparedness {
  /** Of the things that matter, how many someone could actually reach. */
  reachable: number;
  /** How many things matter at all. */
  mattering: number;
  /** Titles of what nobody can reach, most consequential first. Capped for legibility. */
  unreachable: string[];
  /** Structural gaps that are not about a specific item. */
  gaps: string[];
  /** True only when everything that matters is reachable AND the release can complete. */
  ready: boolean;
}

/** Cap on named items — a list of nine is not a prompt, it is a wall. */
const NAME_LIMIT = 2;

export function assessPreparedness(input: PreparednessInput): Preparedness {
  const { items, ruledItemIds, verifierCount } = input;
  const ruled = new Set(ruledItemIds);

  const marked = items.filter((i) => i.criticality === 'critical' || i.is_root_credential);
  // Nothing marked yet means nothing has been assessed, not that nothing matters.
  const mattering = marked.length > 0 ? marked : items;

  const unreachableItems = mattering.filter((i) => !ruled.has(i.id));
  const reachable = mattering.length - unreachableItems.length;

  const gaps: string[] = [];
  if (verifierCount === 0) {
    gaps.push('nobody who can confirm an emergency is real');
  } else if (verifierCount === 1) {
    // Named as a gap rather than a blocker: one verifier works, until the one
    // person is on the same flight as you.
    gaps.push('a second person who can confirm an emergency');
  }

  return {
    reachable,
    mattering: mattering.length,
    unreachable: unreachableItems.slice(0, NAME_LIMIT).map((i) => i.title),
    gaps,
    ready: mattering.length > 0 && unreachableItems.length === 0 && verifierCount >= 1,
  };
}

/**
 * The sentence itself. Written here rather than in the component so the wording
 * is testable and cannot drift between the places it appears.
 */
export function preparednessSentence(p: Preparedness, whoLabel: string): string {
  if (p.mattering === 0) {
    return 'Nothing is in your vault yet, so there is nothing anyone could reach.';
  }
  // "nobody could reach none of the 3 things" is a double negative, and it is
  // the sentence a brand-new owner sees first. Say it once, plainly.
  if (whoLabel === 'nobody') {
    return `Nobody is named yet, so none of the ${p.mattering} things that matter could be reached.`;
  }
  if (p.reachable === 0) {
    return `If something happened tomorrow, ${whoLabel} could reach none of the ${p.mattering} things that matter.`;
  }
  if (p.reachable === p.mattering) {
    return `If something happened tomorrow, ${whoLabel} could reach all ${p.mattering} of the things that matter.`;
  }
  return `If something happened tomorrow, ${whoLabel} could reach ${p.reachable} of the ${p.mattering} things that matter.`;
}

/** What is missing, as a clause — empty when nothing is. */
export function missingClause(p: Preparedness): string {
  const parts = [...p.unreachable, ...p.gaps];
  if (parts.length === 0) return '';
  if (parts.length === 1) return `Missing: ${parts[0]}.`;
  return `Missing: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}
