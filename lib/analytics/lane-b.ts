/**
 * Lane B (the product path) — intent emission.
 *
 * WHY THIS MODULE EXISTS. The ratified G1 gate is
 * `count(caregiver_intent) / count(caregiver_qualified)`, and `caregiver_intent` fires in
 * exactly one place: IntentTracker, on /caregivers/interest mount. PriceCard reached that
 * page only as the FALLBACK for a failed checkout — so once live Stripe landed on
 * 2026-08-08 the fallback became unreachable and a Lane-B visitor who actually bought
 * emitted NO numerator event, while still counting in the denominator via
 * caregiver_qualified on /caregivers. That biases the gate toward a FALSE KILL, on a
 * threshold that kills at <0.5%.
 *
 * The rule this encodes: whoever takes the visitor away from /caregivers/interest owns
 * emitting the numerator, and whoever routes them TO it must not — or one click counts
 * twice. Both halves are pinned in lane-b.test.ts.
 *
 * `startCheckout` is injected rather than fetched here so the branch logic is testable
 * without a server, a Stripe key, or a DOM.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10, J12-R1
 */

import { CAREGIVER_INTENT } from '../../src/app/caregivers/analytics';
import { trackG1 } from '../../src/app/caregivers/track';

import { emitFunnel, resolveChannel } from './funnel';

/**
 * The `cta` dimension that marks Lane B. Lane A uses `hero`/`nav`/`pricing`; this is the
 * value docs/g1-wtp-test-design.md names for the product path, and it is what makes the
 * lane-A-only ratio (the ratified read) separable from the blended one.
 */
export const LANE_B_CTA = 'start';

/** Where a visitor goes when checkout is unavailable. That page emits its own numerator. */
export const LANE_B_FALLBACK_HREF = `/caregivers/interest?src=${LANE_B_CTA}`;

/**
 * One intent per page load, however many times the button is pressed.
 *
 * 🔴 THE SECOND WAY THIS GATE GETS THE WRONG ANSWER. The bug above biased it
 * toward a FALSE KILL by losing the numerator; this one biases it the other way.
 * `PriceCard` awaits a Stripe round-trip — commonly a second or more — before
 * `window.location.href` is assigned, and until this it showed the visitor
 * nothing while that happened. An unacknowledged button gets pressed again;
 * that is not a hypothesis about users, it is what buttons without feedback are
 * for. Every press called straight through to here, and every call emitted
 * `intent_clicked` AND `caregiver_intent` — the ratified numerator — so one
 * visitor's impatience counted as two conversions, and created two Stripe
 * Checkout Sessions on the way.
 *
 * It matters more than the raw duplication suggests. `ratified.g1-flight-power`
 * accepts a DIRECTIONAL read at N ≈ 100–180, structurally short of the N ≈ 250
 * the ratio needs; at that size a handful of double-clicks is a material part of
 * a 2% threshold. The gate is being asked whether the product has a market, and
 * an inflated numerator answers yes for the wrong reason.
 *
 * THE PROMISE IS MEMOISED, not a boolean, and that is what makes it correct for
 * the case that actually happens: the second press arrives while the first is
 * still in flight, so a flag set after the await would be set too late. The
 * repeat caller gets the same destination, the same single emit, and the same
 * checkout session.
 *
 * ⚠️ Per PAGE LOAD, which is the right scope and not a limitation. The visitor
 * navigates away immediately afterwards — to Stripe or to the fallback — so the
 * module is discarded. A genuinely new intent is a new page load.
 *
 * The guard lives here rather than in the component because this module already
 * "owns the measurement" (its own header), and a second Lane-B surface would
 * otherwise have to remember to re-implement it. The component keeps a `busy`
 * state as well, for the human half: telling somebody their click registered is
 * a different job from making the count right.
 */
let inFlight: Promise<string> | null = null;

/** Clears the once-per-page-load memo. Tests only. */
export function _resetLaneBIntentForTesting(): void {
  inFlight = null;
}

/**
 * Records a Lane-B price-CTA click and returns where the visitor should be sent.
 *
 * Always emits `intent_clicked` (the product funnel's own stage). Emits the ratified gate
 * numerator ONLY when the visitor is leaving for Stripe, because the fallback destination
 * emits it on mount.
 *
 * Repeat calls within one page load return the first call's destination without
 * emitting again — see the note above.
 */
export async function completeLaneBIntent(opts: {
  search: string;
  price: string;
  startCheckout: () => Promise<string | null>;
}): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = completeLaneBIntentOnce(opts);
  return inFlight;
}

async function completeLaneBIntentOnce(opts: {
  search: string;
  price: string;
  startCheckout: () => Promise<string | null>;
}): Promise<string> {
  const channel = resolveChannel(opts.search);

  await emitFunnel('intent_clicked', {
    channel,
    cta: 'start-price-card',
    price: opts.price,
  });

  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await opts.startCheckout();
  } catch {
    checkoutUrl = null;
  }

  if (!checkoutUrl) return LANE_B_FALLBACK_HREF;

  // This visitor will never reach /caregivers/interest, so the numerator is ours to emit.
  // `src` is the CHANNEL, never the CTA — the denominator is keyed the same way.
  trackG1(CAREGIVER_INTENT, { src: channel, cta: LANE_B_CTA });

  return checkoutUrl;
}
