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
 * Records a Lane-B price-CTA click and returns where the visitor should be sent.
 *
 * Always emits `intent_clicked` (the product funnel's own stage). Emits the ratified gate
 * numerator ONLY when the visitor is leaving for Stripe, because the fallback destination
 * emits it on mount.
 */
export async function completeLaneBIntent(opts: {
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
