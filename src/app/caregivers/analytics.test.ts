/**
 * G1 WTP instrument — measurement event contract, enforced as tests.
 * Feature: relay-g1-wtp
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  CAREGIVER_INTENT,
  CAREGIVER_QUALIFIED,
  CHANNEL_STORAGE_KEY,
  intentProps,
  recallChannel,
  rememberChannel,
  srcFromSearch,
} from './analytics';

/** Minimal sessionStorage stand-in — the test env is node, so there is no real one. */
function givenSessionStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(seed));
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    },
  };
  return map;
}

/** Storage that throws on every access — private mode / storage disabled. */
function givenBrokenStorage(): void {
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('G1 WTP measurement events', () => {
  it('defines distinct, stable event names for the ratio', () => {
    expect(CAREGIVER_QUALIFIED).toBe('caregiver_qualified');
    expect(CAREGIVER_INTENT).toBe('caregiver_intent');
    expect(CAREGIVER_QUALIFIED).not.toBe(CAREGIVER_INTENT);
  });

  it('reads a tagged source from the query string', () => {
    expect(srcFromSearch('?src=reddit')).toEqual({ src: 'reddit' });
    expect(srcFromSearch('?src=meta-ad&x=1')).toEqual({ src: 'meta-ad' });
  });

  it('decodes URL-encoded channel values (round-trips intentHref encoding)', () => {
    expect(srcFromSearch('?src=r%2FCaregiverSupport')).toEqual({ src: 'r/CaregiverSupport' });
  });

  it('untagged or empty src resolves to "direct" so it can be excluded from N', () => {
    expect(srcFromSearch('')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?x=1')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?src=')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?src=%20%20')).toEqual({ src: 'direct' });
  });
});

describe('G1 channel attribution — numerator and denominator share one vocabulary', () => {
  it('carries the inbound channel across to the intent event, with the CTA as its own dimension', () => {
    // Landing: arrived from a paid channel.
    givenSessionStorage();
    rememberChannel(srcFromSearch('?src=reddit-ads').src);

    // Intent page: its own ?src= is the CTA position, NOT the channel.
    expect(intentProps('?src=hero', recallChannel())).toEqual({
      src: 'reddit-ads',
      cta: 'hero',
    });
  });

  it('makes the per-channel ratio computable — the whole point of the fix', () => {
    givenSessionStorage();
    rememberChannel('meta-ads');
    const qualified = srcFromSearch('?src=meta-ads');
    const intent = intentProps('?src=pricing', recallChannel());
    // Same key on both sides => count(intent[src]) / count(qualified[src]) is well defined.
    expect(intent.src).toBe(qualified.src);
  });

  it('keeps the showcase exclusion symmetric — h0 traffic is excluded from BOTH sides', () => {
    givenSessionStorage();
    rememberChannel('h0-demo');
    // Previously this landed as src:"hero" and was indistinguishable from a paid
    // conversion, inflating the numerator toward a false PASS of the 2% gate.
    expect(intentProps('?src=hero', recallChannel()).src).toBe('h0-demo');
  });

  it('an untagged return visit does not erase the channel that started the session', () => {
    const store = givenSessionStorage();
    rememberChannel('reddit-ads');
    rememberChannel('direct'); // navigated away and back without a tag
    expect(store.get(CHANNEL_STORAGE_KEY)).toBe('reddit-ads');
    expect(recallChannel()).toBe('reddit-ads');
  });

  it('reaching the intent page without ever passing the landing page is "direct" (excluded)', () => {
    givenSessionStorage();
    expect(intentProps('?src=hero', recallChannel())).toEqual({ src: 'direct', cta: 'hero' });
  });

  it('survives disabled storage by degrading to "direct" rather than throwing', () => {
    givenBrokenStorage();
    expect(() => rememberChannel('reddit-ads')).not.toThrow();
    expect(recallChannel()).toBe('direct');
  });

  it('labels a missing CTA position rather than silently emitting an empty dimension', () => {
    expect(intentProps('', 'reddit-ads')).toEqual({ src: 'reddit-ads', cta: 'unknown' });
  });
});
