/**
 * Stripe client and plan config.
 *
 * Mirrors the approach already running in report-bridge — a lazily-created
 * singleton, price IDs from the environment rather than hardcoded — because
 * this is the SAME Stripe account, and two codebases behaving differently
 * against one account is how a shared account becomes unmaintainable.
 *
 * ⚠️ THE ACCOUNT IS SHARED with report-bridge and skillcrossroads, both of
 * which have live webhooks against it. Relay's footprint is strictly additive:
 * its own product, its own price, its own webhook endpoint with its own signing
 * secret. Nothing belonging to another project is touched, and the API key is
 * never rolled — rolling it would break the other two.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R1
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pinned to what this SDK version expects. report-bridge pins an older
      // one against its own older SDK; both are explicit pins rather than
      // floating, which is what matters on a shared account — an implicit
      // version bump would change behaviour for whichever project deployed last.
      apiVersion: '2026-07-29.dahlia',
      typescript: true,
    });
  }
  return _stripe;
}

/** Test seam. */
export function _setStripeForTesting(s: Stripe | null): void {
  _stripe = s;
}

/**
 * One plan, deliberately.
 *
 * $119/yr was ratified against the Everplans anchor and is the number G1 is
 * measuring. A second tier before a single person has paid the first would be
 * pricing a product nobody has bought.
 */
export const RELAY_PLAN = {
  slug: 'family_annual',
  name: 'Relay — one vault, the whole family',
  get priceId(): string {
    const id = process.env.STRIPE_PRICE_RELAY_ANNUAL;
    if (!id) throw new Error('STRIPE_PRICE_RELAY_ANNUAL is not set');
    return id;
  },
} as const;

/** True when checkout is actually configured, so the UI can hide a dead button. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_RELAY_ANNUAL);
}
