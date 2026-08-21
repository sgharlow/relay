/**
 * The rule that decides what a subscription row records about money.
 *
 * 🔴 THIS EXISTS BECAUSE THE SAME DEFECT LANDED TWICE. The INSERT hardcoded
 * `11900`; the fix for that read Stripe on every event, and `customer.
 * subscription.updated` carries only the plan's `unit_amount`, so the list price
 * overwrote a discounted charge the moment Stripe sent the next subscription
 * event. Both are the same mistake: treating "this is a paid subscription" as
 * "somebody was just charged".
 *
 * The route can only be tested through the parameters it binds — vitest runs
 * `environment: 'node'` and there is no database here — so the rule itself lives
 * in a pure module and is asserted directly.
 *
 * Feature: relay-g1-wtp
 * Requirements: J12-R1
 */

import { describe, it, expect } from 'vitest';

import { amountsToWrite, firstRecordedCents } from './subscription-amount';
import { isComped } from './entitlements';
import { PRICE_YEARLY_CENTS } from '../offer';

const CHARGED = 9900; // a price test: shown $99, charged $99
const LIST = 11900; // what the plan says it costs

describe('amountsToWrite', () => {
  /*
    THE REGRESSION THIS MODULE WAS EXTRACTED FOR. A subscription event carries a
    plan price and no `amount_total`. Offering that plan price as the observed
    amount is what overwrote a recorded $99 with $119.
  */
  it('offers no observed amount when only a plan price is available', () => {
    const a = amountsToWrite({ paidCents: null, planCents: LIST, recordsPayment: true });
    expect(a.observedCents, 'a price list is not evidence that money moved').toBeNull();
  });

  it('offers the observed amount when Stripe saw the customer pay it', () => {
    const a = amountsToWrite({ paidCents: CHARGED, planCents: LIST, recordsPayment: true });
    expect(a.observedCents).toBe(CHARGED);
  });

  it('prefers what was paid over what the plan lists, when it has both', () => {
    const a = amountsToWrite({ paidCents: CHARGED, planCents: LIST, recordsPayment: true });
    expect(a.observedCents).toBe(CHARGED);
    expect(a.ifStillAGiftCents).toBe(CHARGED);
  });

  /*
    THE OTHER DIRECTION. A cancellation carries the plan's unit_amount too, so
    an unguarded write would stamp the list price onto a comped row at the moment
    it ENDED — turning a gift into revenue on its way out.
  */
  it('offers nothing at all when the row does not carry a paid subscription', () => {
    expect(amountsToWrite({ paidCents: CHARGED, planCents: LIST, recordsPayment: false })).toEqual({
      observedCents: null,
      ifStillAGiftCents: null,
    });
  });

  /*
    THE HOLE THE FIRST FIX LEFT. `isComped` is an OR across two markers, so
    clearing the cohort while `price_cents` stays at `0` clears neither: the row
    still reads as a gift. Something must always be available to displace that
    zero on a converting write.
  */
  it('always has an amount that can displace a comp’s zero', () => {
    for (const amounts of [
      { paidCents: CHARGED, planCents: null },
      { paidCents: null, planCents: LIST },
      { paidCents: null, planCents: null },
    ]) {
      const { ifStillAGiftCents } = amountsToWrite({ ...amounts, recordsPayment: true });
      expect(ifStillAGiftCents, JSON.stringify(amounts)).not.toBeNull();
      expect(isComped({ price_cents: ifStillAGiftCents }), JSON.stringify(amounts)).toBe(false);
    }
  });

  it('falls back to the one definition of the price, never to a literal', () => {
    const a = amountsToWrite({ paidCents: null, planCents: null, recordsPayment: true });
    expect(a.ifStillAGiftCents).toBe(PRICE_YEARLY_CENTS);
  });

  /*
    A converted comp must not come back out of the far side still looking comped
    on either marker. `cohort` is the webhook's job; this is the other half.
  */
  it('leaves a converted row failing isComped on the amount marker', () => {
    const { ifStillAGiftCents } = amountsToWrite({
      paidCents: null,
      planCents: LIST,
      recordsPayment: true,
    });
    expect(isComped({ cohort: 'converted-from-comp', price_cents: ifStillAGiftCents })).toBe(false);
  });
});

describe('firstRecordedCents', () => {
  it('records what was paid', () => {
    expect(firstRecordedCents({ paidCents: CHARGED, planCents: LIST })).toBe(CHARGED);
  });

  /*
    A NEW ROW HAS NO RECORDED VALUE TO PROTECT, which is why the plan price is
    usable here and not on an update. Recording nothing would be worse than
    recording an approximation.
  */
  it('falls back to the plan when no payment was observed', () => {
    expect(firstRecordedCents({ paidCents: null, planCents: LIST })).toBe(LIST);
  });

  it('falls back to the list price last, and never to zero', () => {
    const cents = firstRecordedCents({ paidCents: null, planCents: null });
    expect(cents).toBe(PRICE_YEARLY_CENTS);
    expect(isComped({ price_cents: cents }), 'a new paid row must never insert as a gift').toBe(
      false,
    );
  });
});
