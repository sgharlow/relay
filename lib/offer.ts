/**
 * The commercial offer, in one place.
 *
 * The refund window is stated on the sales page and again in the Terms, and a
 * customer reads both within minutes of each other. Held as two hardcoded
 * strings it would eventually be changed in one and not the other — which on a
 * product selling trustworthiness is worse than the original wording being
 * imperfect. Same reason `lib/contact.ts` exists.
 *
 * RATIFIED by Steve 2026-08-09: a 30-day money-back guarantee, and after that
 * no refund of the unused part of a year. This supersedes the no-refund-by-
 * default stance that had been authored but never confirmed.
 *
 * ⚠️ The window applies to EVERY charge, renewals included, not only to a first
 * purchase. That is the plain reading of the ratified stance and it is also the
 * kinder one: renewal surprise is the standard complaint about annual plans,
 * and this product cannot afford that argument with a caregiver.
 *
 * ⚠️ Refunds are ISSUED BY HAND in the Stripe dashboard. Nothing in this
 * codebase refunds anything, and Stripe's hosted billing portal cancels without
 * refunding. Any copy that offers the money back must therefore route the
 * customer to a human — see `REFUND_POLICY`, and the test that pins it.
 *
 * Feature: relay-h0-mvp
 */

import { CONTACT_EMAIL } from './contact';

/**
 * The yearly price, in dollars. RATIFIED by Steve 2026-07-03 against the
 * Everplans anchor (`docs/g1-wtp-test-design.md`), and it is the number G1 is
 * measuring willingness to pay against.
 *
 * 🔴 IT LIVES HERE NOW BECAUSE IT WAS WRITTEN DOWN IN NINE PLACES, one of them
 * a SQL literal. `src/app/api/stripe/webhook/route.ts` inserted `11900` into
 * `subscriptions.price_cents` directly in the statement, so the row recording
 * what a customer paid was a constant rather than an observation.
 *
 * That was days away from mattering. `PriceCard.tsx` reads
 * `NEXT_PUBLIC_PRICE_YEARLY_USD` at runtime on purpose — "Runtime-configurable
 * so a price test does not require a deploy (J1-R8)" — and the G1 gate is
 * literally "click-to-intent AT A REAL PRICE POINT". Showing $99, charging $99
 * and recording $119 was not a hypothetical drift; it was the intended
 * operation meeting a hardcoded number.
 *
 * The webhook no longer uses this for a completed charge at all: it records
 * what Stripe says it charged. This remains the definition for everything the
 * product SAYS, and the fallback when Stripe sends no amount.
 *
 * This file already claimed the job — "The commercial offer, in one place."
 * `src/app/caregivers/content.ts` re-exports it so no existing import changed.
 */
export const PRICE_YEARLY_USD = 119;

/** The same price in cents, which is the unit Stripe and `price_cents` use. */
export const PRICE_YEARLY_CENTS = PRICE_YEARLY_USD * 100;

/**
 * The price as it is written in copy. Exists so prose interpolates one value
 * rather than embedding a `$119` that reads as ordinary text and is therefore
 * invisible to every search for the number.
 */
export const PRICE_YEARLY_LABEL = `$${PRICE_YEARLY_USD}`;

/** Days after a charge during which that charge is refundable in full. */
export const REFUND_WINDOW_DAYS = 30;

/** Short form, for the point where the price is shown. */
export const GUARANTEE_LABEL = `${REFUND_WINDOW_DAYS}-day money-back guarantee`;

/** Long form, for the Terms. */
export const REFUND_POLICY =
  `If Relay is not what you expected, email ${CONTACT_EMAIL} within ` +
  `${REFUND_WINDOW_DAYS} days of a charge — including a renewal charge — and we ` +
  `will refund it in full. After that window we do not refund the unused part of ` +
  `a year, though you can cancel at any time to stop the next one. Nothing here ` +
  `removes a refund right the law gives you.`;
