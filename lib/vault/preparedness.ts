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

import { itemUsability, unknownCause } from './usability';

export interface PreparednessInput {
  /**
   * Every vault item, with the fields that decide whether it matters and
   * whether anyone could actually use it.
   *
   * 🔴 THE THREE USABILITY FIELDS WERE OPTIONAL AND THAT COST THE WHOLE RULE.
   * The reasoning was sound — the columns arrive in a migration, and a caller
   * compiled against a cluster without it must keep working — but the tolerance
   * was applied to the wrong half. `assessReadiness` selected vault items
   * WITHOUT those columns, it compiled, and from the day migration 035 shipped
   * every item reaching this function from the banner read `unknown`:
   * `checkingStarted` was permanently false and the second-factor correction
   * never fired on the one surface that renders the sentence. Nothing was red.
   * The unit tests supply the columns themselves, and so does `verify:factors`,
   * so both proved the rule through a path the product does not use.
   *
   * The tolerance belongs to the VALUE, which may be `null`, not to the KEY,
   * which a caller has to think about. Writing `null` down is a decision;
   * omitting a column is an accident, and now it is a build failure.
   * Absent still reads as `unknown`, never as "demands nothing" — see
   * `usability.ts`.
   */
  items: {
    id: string;
    title: string;
    criticality: string | null;
    is_root_credential: boolean;
    secret_kinds: string | null;
    factors_required: string | null;
    depends_on_item_id: string | null;
  }[];
  /** vault_item_id for every access rule that exists. */
  ruledItemIds: string[];
  /** How many people could confirm an emergency is real. */
  verifierCount: number;
}

/** An item the owner can act on, so a prompt can name it and address it. */
export interface NamedItem {
  id: string;
  title: string;
}

export interface Preparedness {
  /** Of the things that matter, how many someone could actually reach. */
  reachable: number;
  /** How many things matter at all. */
  mattering: number;
  /** Titles of what nobody can reach, most consequential first. Capped for legibility. */
  unreachable: string[];
  /** Titles of items a recipient could open and still not get into. Capped alike. */
  blocked: string[];
  /**
   * The unchecked items, split by WHY — because the two causes have two
   * different remedies and one number could not carry both. See `unknownCause`.
   */
  /** Nobody has said what the account demands. One tap answers it. */
  unasked: number;
  /** The owner said it demands a code; what the entry holds was never declared. */
  undeclared: number;
  /** Known on both counts, and the route it recovers through is itself unknown. */
  unresolved: number;
  /** The unasked items by name, so the owner can answer them where they stand. */
  unaskedItems: NamedItem[];
  /** The undeclared items by name — these need a re-save, not an answer. */
  undeclaredItems: NamedItem[];
  /** Whether ANY item in this vault has ever been declared. See the sentence. */
  checkingStarted: boolean;
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

  /*
    A RULE IS NOT A WAY IN. Everything below is the correction to this
    function's original definition of reachable: an access rule opens the item,
    and the item still holds a password for an account that wants a code as
    well. Blocked items are subtracted from the count; unchecked ones are not,
    because nobody has asked and an unanswered question is not a defect.
  */
  const usabilityInput = items.map((i) => ({
    id: i.id,
    secret_kinds: i.secret_kinds ?? null,
    factors_required: i.factors_required ?? null,
    depends_on_item_id: i.depends_on_item_id ?? null,
  }));
  const usabilityOf = new Map(
    usabilityInput.map((i) => [i.id, itemUsability(i, usabilityInput)] as const),
  );
  const byId = new Map(usabilityInput.map((i) => [i.id, i] as const));

  const openable = mattering.filter((i) => ruled.has(i.id));
  const blockedItems = openable.filter((i) => usabilityOf.get(i.id) === 'blocked');
  const reachable = openable.length - blockedItems.length;

  /*
    The unchecked items, split by cause. The three buckets are exhaustive by
    construction — `unknownCause` returns one of three and every unknown item
    goes through it — which is the property that stops an item falling silently
    out of both the sentence and the prompt.
  */
  const uncheckedItems = openable.filter((i) => usabilityOf.get(i.id) === 'unknown');
  const byCause = new Map(uncheckedItems.map((i) => [i.id, unknownCause(byId.get(i.id)!)] as const));
  const withCause = (cause: string) => uncheckedItems.filter((i) => byCause.get(i.id) === cause);
  const unaskedItems = withCause('unasked');
  const undeclaredItems = withCause('undeclared');

  /*
    🔴 WHY AN UNCHECKED VAULT IS LEFT ALONE. Until the migration lands and a
    client writes them, both columns are NULL on every item in every vault — so
    every owner is in the "nobody has checked" state through no act of their
    own. Letting that state change the sentence would tell every owner on the
    same afternoon that their finished plan is unfinished, over a measurement
    they were never offered. Q1 of the design names that false alarm as the way
    this signal gets destroyed permanently, so the clause stays silent until at
    least one item in the vault has actually been declared.
  */
  const checkingStarted = items.some(
    (i) => i.factors_required != null || i.secret_kinds != null,
  );

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
    blocked: blockedItems.slice(0, NAME_LIMIT).map((i) => i.title),
    unasked: unaskedItems.length,
    undeclared: undeclaredItems.length,
    unresolved: uncheckedItems.length - unaskedItems.length - undeclaredItems.length,
    unaskedItems: unaskedItems.slice(0, NAME_LIMIT).map((i) => ({ id: i.id, title: i.title })),
    undeclaredItems: undeclaredItems.slice(0, NAME_LIMIT).map((i) => ({ id: i.id, title: i.title })),
    checkingStarted,
    gaps,
    ready:
      mattering.length > 0 &&
      unreachableItems.length === 0 &&
      blockedItems.length === 0 &&
      verifierCount >= 1,
  };
}

/**
 * The sentence itself. Written here rather than in the component so the wording
 * is testable and cannot drift between the places it appears.
 */
export function preparednessSentence(p: Preparedness, whoLabel: string): string {
  return withUncheckedClause(baseSentence(p, whoLabel), p);
}

/**
 * The honest qualifier, and the reason `unknown` is a state rather than a
 * rounding decision. It turns a claim nobody verified into a question the owner
 * can answer, which is the only move available when the truthful answer is "we
 * do not know yet".
 */
function withUncheckedClause(sentence: string, p: Preparedness): string {
  if (!p.checkingStarted || p.unasked === 0) return sentence;
  const stem = sentence.replace(/\.$/, '');
  return p.unasked === 1
    ? `${stem} — though nobody has checked whether one of them needs a code as well.`
    : `${stem} — though nobody has checked whether ${p.unasked} of them need a code as well.`;
}

function baseSentence(p: Preparedness, whoLabel: string): string {
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
    // "all 2 of the things that matter" is how a template reads when nobody
    // checked the small numbers — and small numbers are the common case, since
    // the whole point of the importance engine is that four or five items
    // matter, not ninety.
    if (p.mattering === 1) {
      return `If something happened tomorrow, ${whoLabel} could reach the one thing that matters.`;
    }
    if (p.mattering === 2) {
      return `If something happened tomorrow, ${whoLabel} could reach both of the things that matter.`;
    }
    return `If something happened tomorrow, ${whoLabel} could reach all ${p.mattering} of the things that matter.`;
  }
  return `If something happened tomorrow, ${whoLabel} could reach ${p.reachable} of the ${p.mattering} things that matter.`;
}

/** What is missing, as a clause — empty when nothing is. */
export function missingClause(p: Preparedness): string {
  /*
    A blocked item is NOT "missing". The item is there, in the vault, where the
    owner put it — what is missing is the code, and an owner who reads the wrong
    noun goes and re-enters a password that was never the problem.
  */
  const blocked = p.blocked.map((title) => `a code for ${title}, which nobody could supply`);
  const parts = [...p.unreachable, ...blocked, ...p.gaps];
  if (parts.length === 0) return '';
  if (parts.length === 1) return `Missing: ${parts[0]}.`;
  return `Missing: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}

/**
 * The second half of the honest answer, as its own line.
 *
 * Deliberately NOT appended to `preparednessSentence`. The unasked clause is a
 * question the owner can answer where they stand; this one is a different act
 * on different items, and running the two together produces a sentence nobody
 * finishes reading. The banner renders them as separate lines for the same
 * reason `missingClause` already is one.
 *
 * ⚠️ IT NAMES THE ONLY REMEDY THERE IS. Relay cannot read the entry, and an
 * update replaces the payload rather than editing it, so re-saving the item is
 * not one option among several — it is the single act that records what an item
 * holds. Saying "check this item" instead would send the owner looking for a
 * control that does not exist.
 */
export function undeclaredClause(p: Preparedness): string {
  if (p.undeclared === 0) return '';
  return p.undeclared === 1
    ? 'You said one of them needs a code as well, and Relay cannot see whether your entry holds it — ' +
        'open it and save it again to say.'
    : `You said ${p.undeclared} of them need a code as well, and Relay cannot see whether your entry holds it — ` +
        'open each one and save it again to say.';
}
