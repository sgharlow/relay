/**
 * The facts an outlet needs, in one place, composed from the product's own values.
 *
 * WHY THIS IS CODE. A pitch restates the price, the free cap and what the product
 * does, every single time. Written by hand each time, they drift — and this repo
 * has now been bitten by exactly that three times in one day: a free-plan cap
 * hand-copied into eleven places, a palette migrated in hex but not in English,
 * and ad copy carrying a price no test was watching. A journalist quoting a stale
 * price in a published article is the version of that mistake you cannot fix with
 * a commit.
 *
 * So the numbers are COMPOSED from `PRICE_YEARLY_USD` and `TIER_LIMITS.free`
 * rather than typed, and `press-kit.test.ts` proves the composition still reads
 * correctly at the current values.
 *
 * WHAT THIS IS FOR. `ratified.retire-paid-advertising` makes op-eds in AARP,
 * caregiver.com and comparable outlets the route to visibility. An editor
 * evaluating a pitch needs a one-line description, a named author, something
 * verifiable, and a contact that reaches a human. `docs/g1-editorial-lane.md` is
 * the plan; this is the boilerplate that plan hands over.
 *
 * ⚠️ NOTHING HERE MAY REFERENCE EMPLOYMENT. The employer-anonymity rule binds
 * every bio supplied to an outlet — see `ratified.relay-operator-is-an-individual`.
 *
 * Feature: relay-g1-wtp
 */

import { TIER_LIMITS } from '../billing/entitlements';
import { OPERATOR_NAME, CONTACT_EMAIL } from '../contact';
import { PRICE_YEARLY_USD, WINNER_BADGE } from '../../src/app/caregivers/content';

/** One sentence. The version that goes in a bio line or a footnote. */
export function oneLine(): string {
  return (
    `Relay is emergency access to a family's online accounts that opens only when trusted ` +
    `contacts confirm a real emergency, and seals itself again when the account holder checks ` +
    `back in.`
  );
}

/** The paragraph an outlet pastes under an article. */
export function boilerplate(): string {
  return (
    `Relay (relaystandby.com) lets someone store the accounts their family would need in an ` +
    `emergency, choose in advance who may receive access and to what, and have that access open ` +
    `only once people they trust confirm the situation is real. Access closes again on their next ` +
    `check-in, which is what makes it safe to set up before it is needed. Everything is encrypted ` +
    `in the browser, so the service holds ciphertext and cannot read what it stores. It costs ` +
    `$${PRICE_YEARLY_USD} a year for a whole family, with a free tier of ` +
    `${TIER_LIMITS.free.items} items. Relay is independent software built and operated by ` +
    `${OPERATOR_NAME}.`
  );
}

/** Author line for a contributed piece. No employment detail, by rule. */
export function authorLine(): string {
  return `${OPERATOR_NAME} is the founder of Relay (relaystandby.com), independent software for family emergency access.`;
}

/** Things an editor can check without taking our word for it. */
export const VERIFIABLE_FACTS = [
  { fact: WINNER_BADGE, where: 'H0 Hackathon 2026, judged externally' },
  { fact: 'Encrypted in the browser; the service stores ciphertext only', where: 'relaystandby.com/security explains the mechanism' },
  { fact: 'Estate and inheritance handling is deliberately not offered', where: 'relaystandby.com/terms' },
] as const;

/** Where the marks live. Committed, so a published article can be reproduced later. */
export const BRAND_ASSETS = [
  'public/assets/brand/relay-mark.svg',
  'public/assets/brand/relay-mark-inverse.svg',
  'public/assets/brand/social-card.svg',
  'public/assets/brand/relay-icon-16.svg',
] as const;

export const PRESS_CONTACT = CONTACT_EMAIL;
