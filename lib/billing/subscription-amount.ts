/**
 * What a subscription row is allowed to record about money, and from which event.
 *
 * 🔴 TWO OPPOSITE CORRUPTIONS, ONE RULE. The webhook has now been wrong in both
 * directions about `price_cents`, and both times the mistake was treating "this
 * is a paid subscription" as "somebody was just charged":
 *
 *   1. The INSERT wrote the literal `11900`, so a price test would have shown
 *      $99, charged $99 and recorded $119. Fixed by reading Stripe.
 *   2. The fix for (1) then read Stripe on EVERY event. `customer.subscription.
 *      updated` carries no `amount_total` — only the plan's `unit_amount` — so
 *      the first one Stripe sent after a discounted checkout overwrote the
 *      recorded $99 with the list $119. The same defect, arriving later.
 *
 * The rule that closes both: **an amount only overwrites a recorded amount when
 * it was observed being paid.** `amount_total` on a completed Checkout Session
 * is an observation. `items.data[0].price.unit_amount` on a Subscription is a
 * price list, and a price list is not evidence that money moved.
 *
 * A plan price still has one job, and only one — see `ifStillAGiftCents`.
 *
 * Pure and separate from the route because `vitest` runs `environment: 'node'`
 * with no database: a decision expressed only as a SQL `CASE` is a decision no
 * test in this repo can reach, and this is a decision about somebody's money.
 * `lib/billing/checkout-outcome.ts` was extracted for the same reason.
 *
 * ⚠️ THE COMPARISON AGAINST THE ROW STAYS IN SQL. This module decides what to
 * OFFER the statement; which offer lands is decided where the row is, because
 * the row is not read first and two concurrent events must not each decide from
 * a stale copy.
 *
 * Feature: relay-g1-wtp
 * Requirements: J12-R1
 */

import { PRICE_YEARLY_CENTS } from '../offer';

/** What a Stripe event says about money, separated by what it is evidence of. */
export interface StripeAmounts {
  /** `amount_total` — what the customer actually paid. An observation. */
  paidCents: number | null;
  /** `items.data[0].price.unit_amount` — what the plan costs. Not an observation. */
  planCents: number | null;
}

export interface AmountsToWrite {
  /**
   * Overwrites `price_cents` outright. Null unless a payment was observed, so a
   * plan price can never displace a recorded charge.
   */
  observedCents: number | null;
  /**
   * Replaces `price_cents` ONLY where the row still carries the comp's `0`.
   *
   * `isComped` answers true on `price_cents === 0` as well as on the cohort, so
   * clearing the cohort alone leaves the row reading as a gift — which is how
   * the conversion `g1-arms-length-demand` is waiting for would have been
   * excluded from every revenue read. A hand-onboarded family can also be
   * subscribed directly in the Stripe dashboard, producing `customer.
   * subscription.*` and never a checkout, so the plan's own amount is the best
   * evidence that path will ever offer. The list price is the last resort,
   * exactly as on the INSERT: recording the list price is wrong by at most a
   * discount, and leaving the zero is wrong by the whole sale.
   */
  ifStillAGiftCents: number | null;
}

/**
 * @param recordsPayment This row now carries a live paid Stripe subscription —
 * a paid tier plus a subscription id. NOT "somebody was charged just now".
 */
export function amountsToWrite(
  input: StripeAmounts & { recordsPayment: boolean },
): AmountsToWrite {
  // A cancellation carries the plan's unit_amount too. Writing anything here
  // would stamp the list price onto a comped row at the moment it ENDED —
  // turning a gift into revenue on its way out.
  if (!input.recordsPayment) return { observedCents: null, ifStillAGiftCents: null };

  return {
    observedCents: input.paidCents,
    ifStillAGiftCents: input.paidCents ?? input.planCents ?? PRICE_YEARLY_CENTS,
  };
}

/**
 * The amount a brand-new row records.
 *
 * No existing value to protect here, so the plan price is usable and the list
 * price is the fallback — recording nothing would be worse than recording an
 * approximation, and the approximation comes from the one definition of the
 * price rather than from a literal.
 */
export function firstRecordedCents(amounts: StripeAmounts): number {
  return amounts.paidCents ?? amounts.planCents ?? PRICE_YEARLY_CENTS;
}
