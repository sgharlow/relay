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
