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
import {
  completeLaneBIntent,
  _resetLaneBIntentForTesting,
  LANE_B_CTA,
  LANE_B_FALLBACK_HREF,
} from './lane-b';

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
  /*
    The once-per-page-load memo is module state, and a test file is one module
    instance for all of its cases. Without this, case 2 would silently receive
    case 1's destination and assert nothing — every test after the first passing
    for the wrong reason, which is the precise failure this file was written to
    catch in the first place.
  */
  _resetLaneBIntentForTesting();
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

/**
 * 🔴 THE OTHER DIRECTION THE GATE CAN BE WRONG.
 *
 * The bug at the top of this file biased G1 toward a FALSE KILL by losing the
 * numerator. This one biases it the other way. `PriceCard` awaits a Stripe
 * round-trip — commonly a second or more — before the browser navigates, and it
 * showed the visitor nothing while that happened. A button that does not
 * acknowledge a press gets pressed again, and every press called straight
 * through to `completeLaneBIntent`, which emits `intent_clicked` AND
 * `caregiver_intent` — the ratified numerator — every time.
 *
 * So one impatient visitor counted as two conversions and opened two Checkout
 * Sessions. `ratified.g1-flight-power` accepts a directional read at N ≈ 100–180,
 * structurally short of the N ≈ 250 the ratio needs; at that size a handful of
 * double-clicks is a material part of a 2% threshold.
 *
 * A boolean set after the await would be set too late for the case that actually
 * happens — the second press arrives while the first is still in flight — so the
 * promise itself is memoised. These pin both timings.
 */
describe('one intent per page load, however many times the button is pressed', () => {
  it('a second press while the first is IN FLIGHT emits nothing extra', async () => {
    withChannel('reddit-ads');
    /*
      The deferred is built HERE rather than inside the mock: `startCheckout` is
      not called until after `completeLaneBIntent` awaits `emitFunnel`, so a
      resolver assigned inside the mock body does not exist yet at the moment
      the test needs to release it.
    */
    let release!: (url: string | null) => void;
    const gate = new Promise<string | null>((resolve) => { release = resolve; });
    const started = vi.fn(() => gate);

    // Both presses happen before checkout resolves — the real double-click.
    const first = completeLaneBIntent({ search: '', price: '119', startCheckout: started });
    const second = completeLaneBIntent({ search: '', price: '119', startCheckout: started });

    release(STRIPE_URL);
    expect(await first).toBe(STRIPE_URL);
    expect(await second).toBe(STRIPE_URL);

    // One Checkout Session, not two.
    expect(started).toHaveBeenCalledTimes(1);
    // Exactly one numerator event for one visitor.
    const numerator = vi.mocked(trackG1).mock.calls.filter((c) => c[0] === 'caregiver_intent');
    expect(numerator).toHaveLength(1);
    const clicked = vi.mocked(trackG1).mock.calls.filter((c) => c[0] === 'intent_clicked');
    expect(clicked).toHaveLength(1);
  });

  it('a press AFTER the first completed returns the same destination and emits nothing', async () => {
    withChannel('reddit-ads');
    const started = vi.fn(async () => STRIPE_URL);

    expect(await completeLaneBIntent({ search: '', price: '119', startCheckout: started })).toBe(STRIPE_URL);
    expect(await completeLaneBIntent({ search: '', price: '119', startCheckout: started })).toBe(STRIPE_URL);

    expect(started).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackG1).mock.calls.filter((c) => c[0] === 'caregiver_intent')).toHaveLength(1);
  });

  /*
    The memo must not leak between page loads — that is what the reset seam is
    for, and a test that forgot it would pass for the wrong reason while hiding
    a real defect from every test that ran after it.
  */
  it('a genuinely new page load emits again', async () => {
    withChannel('reddit-ads');
    const started = vi.fn(async () => STRIPE_URL);

    await completeLaneBIntent({ search: '', price: '119', startCheckout: started });
    _resetLaneBIntentForTesting();
    await completeLaneBIntent({ search: '', price: '119', startCheckout: started });

    expect(started).toHaveBeenCalledTimes(2);
    expect(vi.mocked(trackG1).mock.calls.filter((c) => c[0] === 'caregiver_intent')).toHaveLength(2);
  });

  /*
    The fallback path must be memoised too. It emits no numerator itself — the
    destination page does that on mount — so a second press that slipped through
    would land the visitor on /caregivers/interest twice and count twice there.
  */
  it('memoises the fallback destination as well', async () => {
    withChannel('reddit-ads');
    const started = vi.fn(async () => null);

    expect(await completeLaneBIntent({ search: '', price: '119', startCheckout: started })).toBe(LANE_B_FALLBACK_HREF);
    expect(await completeLaneBIntent({ search: '', price: '119', startCheckout: started })).toBe(LANE_B_FALLBACK_HREF);

    expect(started).toHaveBeenCalledTimes(1);
    // Still none: the fallback page owns the numerator, and that is unchanged.
    expect(vi.mocked(trackG1).mock.calls.filter((c) => c[0] === 'caregiver_intent')).toHaveLength(0);
  });
});
