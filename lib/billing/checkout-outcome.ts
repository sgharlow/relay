/**
 * What a failed press of the price button actually means, and what to do about it.
 *
 * 🔴 EVERY FAILURE WAS TREATED AS "STRIPE IS NOT SET UP YET". `PriceCard`
 * returned `null` from `startCheckout` on any non-OK response, and
 * `completeLaneBIntent` turns a null into `LANE_B_FALLBACK_HREF` —
 * `/caregivers/interest`. That fallback was written for exactly one case and
 * says so in the component: checkout 503s until Stripe is configured, and the
 * interest page is where a would-be buyer goes instead.
 *
 * Everything else fell down the same hole. A rate-limited press (the route
 * allows five a minute), a transient 500, a dropped connection — each sent a
 * SIGNED-IN OWNER to a marketing page whose primary call to action is *"Set up
 * my vault now — $119/yr"* pointing at `/auth/signup`, which will refuse their
 * email because they already have an account, beside a form inviting them to
 * request an invite they no longer need. Somebody who tried to pay was shown a
 * waitlist. The component's own comment names that as the thing to avoid —
 * *"sending someone who wants to pay to a waitlist when checkout exists would
 * be a bait"* — and it was happening on every failure except the one the
 * fallback was for.
 *
 * The 409 added on 2026-08-21 (an owner who is already subscribed) made this
 * urgent rather than untidy: without this module, the product's answer to "you
 * are already a customer" would have been to ask them to sign up.
 *
 * Pure and separate from the component because `vitest` runs in `environment:
 * 'node'` with no DOM and no testing-library — a decision left inside a click
 * handler could not be tested at all, and this is a decision about somebody's
 * money.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10, J12-R1
 */

/** Why a checkout press did not end at Stripe. */
export type CheckoutFailureKind =
  /** 503 — no Stripe key or price configured. The interest page is correct here. */
  | 'unconfigured'
  /** 409 — this owner already has an active paid subscription. */
  | 'already-subscribed'
  /** 429 — too many presses in a minute. Waiting fixes it. */
  | 'busy'
  /** Anything else: 5xx, a dropped connection, an OK response carrying no URL. */
  | 'failed';

export interface CheckoutFailure {
  kind: CheckoutFailureKind;
  /** What the owner is told, in plain words, on the page they are already on. */
  message: string;
  /** Whether pressing again could plausibly work. */
  retryable: boolean;
  /** Where they should go instead, when staying put is not the answer. */
  href?: string;
  /** Label for the link at `href`. */
  hrefLabel?: string;
}

/**
 * Classify a failed checkout attempt.
 *
 * `status` is null when the request never produced one — a network failure or a
 * thrown fetch. That is deliberately NOT folded into `unconfigured`: an
 * unreachable server is a transient thing to retry, not a product that has no
 * billing.
 */
export function classifyCheckoutFailure(status: number | null): CheckoutFailure {
  switch (status) {
    case 503:
      return {
        kind: 'unconfigured',
        message: 'Checkout is not available yet.',
        retryable: false,
      };

    case 409:
      return {
        kind: 'already-subscribed',
        // No apology and no alarm: this person is a customer, and the honest
        // answer is that there is nothing to buy.
        message: 'You already have a Relay plan — there is nothing more to pay.',
        retryable: false,
        href: '/account',
        hrefLabel: 'Go to your account',
      };

    case 429:
      return {
        kind: 'busy',
        /*
          🔴 THIS READ "That went through more than once." On a $119 button,
          "went through" is the phrase a person reads as *the charge succeeded* —
          so the sentence for "you pressed too fast and nothing happened" was the
          one most likely to be read as "you have been billed twice", on the one
          failure that is REACHED by pressing twice. Corrected 2026-08-21.

          Same shape as `failed` below, and for the same reason: what did NOT
          happen, first.
        */
        message: 'That was pressed more than once — nothing has been charged. Wait a moment and try again.',
        retryable: true,
      };

    default:
      return {
        kind: 'failed',
        // Says what did NOT happen, first. Somebody who pressed a payment
        // button and saw an error needs to know they have not been charged
        // before they need to know what to do next.
        message: 'Checkout could not start, and you have not been charged. Try again.',
        retryable: true,
      };
  }
}

/**
 * Should this failure send the visitor to the interest page instead?
 *
 * True for exactly one kind, which is the whole point of this module. Written
 * as a named question rather than an inline `=== 'unconfigured'` so the rule has
 * one home and a test can state it.
 */
export function shouldFallBackToInterestPage(failure: CheckoutFailure): boolean {
  return failure.kind === 'unconfigured';
}
