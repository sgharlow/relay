/**
 * Lane B must reach the ratified gate numerator.
 *
 * THE BUG THIS PINS (found 2026-08-10, pre-flight audit):
 * `caregiver_intent` — the G1 numerator — fires in exactly one place: IntentTracker,
 * on /caregivers/interest mount. PriceCard reached that page only as the FALLBACK for
 * a failed checkout. Once live Stripe landed (2026-08-08) the fallback became
 * unreachable, so a Lane-B visitor who actually BOUGHT emitted no numerator event while
 * still counting in the denominator (they fired caregiver_qualified on /caregivers).
 *
 * Direction of error: FALSE KILL, on a gate that kills at <0.5%. The strongest signal
 * the funnel can produce — a card — was invisible to the metric it should dominate.
 *
 * The docs asserted the opposite and were stale: docs/g1-wtp-test-design.md ("a lane-B
 * conversion still lands on /caregivers/interest and fires caregiver_intent") and the
 * comment on SECONDARY_CTA_HREF. The one live proof (user-journeys J1) was captured
 * while checkout still 503'd.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/app/caregivers/track', () => ({
  trackG1: vi.fn(),
  ensureAnalyticsQueue: vi.fn(),
}));

import { trackG1 } from '../../src/app/caregivers/track';
import { completeLaneBIntent, LANE_B_CTA, LANE_B_FALLBACK_HREF } from './lane-b';

const STRIPE_URL = 'https://checkout.stripe.com/c/pay/cs_live_abc123';

function withChannel(channel: string | null) {
  const map = new Map<string, string>();
  if (channel) map.set('relay.g1.channel', channel);
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    },
  };
}

/** Every caregiver_intent emitted this test, in order. */
function gateIntents() {
  return vi.mocked(trackG1).mock.calls.filter(([name]) => name === 'caregiver_intent');
}

beforeEach(() => {
  vi.clearAllMocks();
  withChannel('reddit-ads');
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('Lane B intent — the purchase path', () => {
  it('emits the gate numerator before handing the visitor to Stripe', async () => {
    const dest = await completeLaneBIntent({
      search: '',
      price: '119',
      startCheckout: async () => STRIPE_URL,
    });

    expect(dest).toBe(STRIPE_URL);
    expect(gateIntents()).toEqual([
      ['caregiver_intent', { src: 'reddit-ads', cta: LANE_B_CTA }],
    ]);
  });

  it('reports the inbound channel, not the CTA — numerator and denominator share one vocabulary', async () => {
    withChannel('meta-ads');
    await completeLaneBIntent({ search: '', price: '119', startCheckout: async () => STRIPE_URL });

    expect(gateIntents()[0]?.[1]).toMatchObject({ src: 'meta-ads' });
  });

  it('still emits intent_clicked, so the product funnel reads the same as before', async () => {
    await completeLaneBIntent({ search: '', price: '119', startCheckout: async () => STRIPE_URL });

    expect(trackG1).toHaveBeenCalledWith('intent_clicked', {
      src: 'reddit-ads',
      cta: 'start-price-card',
      price: '119',
    });
  });
});

describe('Lane B intent — the fallback path must not double-count', () => {
  it('does NOT emit the numerator when it routes to the interest page, which emits its own', async () => {
    const dest = await completeLaneBIntent({
      search: '',
      price: '119',
      startCheckout: async () => null, // billing not configured -> 503
    });

    expect(dest).toBe(LANE_B_FALLBACK_HREF);
    // IntentTracker fires caregiver_intent on that page. Emitting here too would
    // count one visitor twice and inflate the gate.
    expect(gateIntents()).toEqual([]);
  });

  it('routes to the interest page without emitting the numerator when checkout throws', async () => {
    const dest = await completeLaneBIntent({
      search: '',
      price: '119',
      startCheckout: async () => {
        throw new Error('network down');
      },
    });

    expect(dest).toBe(LANE_B_FALLBACK_HREF);
    expect(gateIntents()).toEqual([]);
  });

  it('carries the CTA position into the fallback URL so the numerator lands in the lane-B bucket', () => {
    expect(LANE_B_FALLBACK_HREF).toBe(`/caregivers/interest?src=${LANE_B_CTA}`);
  });
});

describe('Lane B intent — exactly one numerator per click, whichever branch runs', () => {
  it.each([
    ['stripe', async () => STRIPE_URL, 1],
    ['fallback', async () => null, 0],
  ])('%s branch emits %i gate intent(s) from one click', async (_label, startCheckout, expected) => {
    await completeLaneBIntent({ search: '', price: '119', startCheckout });
    expect(gateIntents()).toHaveLength(expected as number);
  });

  it('never emits the numerator twice on the Stripe branch', async () => {
    await completeLaneBIntent({ search: '', price: '119', startCheckout: async () => STRIPE_URL });
    expect(gateIntents()).toHaveLength(1);
  });
});
