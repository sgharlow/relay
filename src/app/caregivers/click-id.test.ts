/**
 * Tests for ad click-ID capture.
 *
 * `src` tells you the channel YOU tagged. A click ID tells you which ad, which
 * creative, which keyword — the platform's own identifier for the click it sold
 * you. Without it, "reddit-ads produced 40 leads" is the most specific thing you
 * can ever say, and you cannot upload an offline conversion at all.
 *
 * It has to survive the same journey `src` does: a visitor lands on
 * /caregivers?src=reddit-ads&rdt_cid=…, reads, clicks through to
 * /caregivers/interest, and only then submits. The ID is on the first URL and
 * nowhere after it.
 *
 * Deliberately NOT a cookie and NOT a third party. sessionStorage, same key
 * discipline as the channel, and it dies with the tab — so the privacy page's
 * "no advertising or tracking cookies on this site" stays literally true.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R10
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { clickIdFrom, rememberClickId, recallClickId, CLICK_ID_STORAGE_KEY } from './click-id';

/**
 * The suite runs in node, so a browser has to be stood up by hand — the same
 * approach track.test.ts uses. A real Map-backed sessionStorage rather than a
 * mock, so the tests exercise the actual serialise/parse round trip.
 */
function installWindow() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
}

beforeEach(() => {
  installWindow();
});

describe('reading a click ID off the landing URL', () => {
  it('reads Google, Meta, Reddit, Microsoft and TikTok identifiers', () => {
    expect(clickIdFrom('?gclid=abc123')).toEqual({ platform: 'google', id: 'abc123' });
    expect(clickIdFrom('?fbclid=fb_9')).toEqual({ platform: 'meta', id: 'fb_9' });
    expect(clickIdFrom('?rdt_cid=rd_7')).toEqual({ platform: 'reddit', id: 'rd_7' });
    expect(clickIdFrom('?msclkid=ms_1')).toEqual({ platform: 'microsoft', id: 'ms_1' });
    expect(clickIdFrom('?ttclid=tt_4')).toEqual({ platform: 'tiktok', id: 'tt_4' });
  });

  it('reads gbraid and wbraid, which Google sends instead of gclid on iOS', () => {
    // Missing these means iOS traffic — a large share of this audience — arrives
    // looking like it had no click ID at all.
    expect(clickIdFrom('?gbraid=gb_1')).toEqual({ platform: 'google', id: 'gb_1' });
    expect(clickIdFrom('?wbraid=wb_1')).toEqual({ platform: 'google', id: 'wb_1' });
  });

  it('returns null when there is no ad click ID', () => {
    expect(clickIdFrom('?src=reddit-ads')).toBeNull();
    expect(clickIdFrom('')).toBeNull();
  });

  it('ignores an empty or whitespace-only value', () => {
    expect(clickIdFrom('?gclid=')).toBeNull();
    expect(clickIdFrom('?gclid=%20%20')).toBeNull();
  });

  it('caps the length, because this is stored and echoed', () => {
    const long = 'x'.repeat(600);
    const got = clickIdFrom(`?gclid=${long}`);
    expect(got!.id.length).toBeLessThanOrEqual(255);
  });

  it('prefers the first platform it finds rather than merging two', () => {
    // A URL carrying both is either a mis-tagged campaign or a redirect chain;
    // guessing which one paid for the click would invent attribution.
    const got = clickIdFrom('?gclid=g1&fbclid=f1');
    expect(got).toEqual({ platform: 'google', id: 'g1' });
  });
});

describe('surviving the journey to the conversion page', () => {
  it('remembers the ID from the landing page and recalls it later', () => {
    rememberClickId({ platform: 'reddit', id: 'rd_7' });
    expect(recallClickId()).toEqual({ platform: 'reddit', id: 'rd_7' });
  });

  it('returns null when nothing was ever parked', () => {
    expect(recallClickId()).toBeNull();
  });

  it('does not overwrite the paying click with a later untagged visit', () => {
    // Same rule the channel already follows: the click that was paid for is the
    // one that counts, not whatever the last navigation looked like.
    rememberClickId({ platform: 'reddit', id: 'rd_7' });
    rememberClickId(null);
    expect(recallClickId()).toEqual({ platform: 'reddit', id: 'rd_7' });
  });

  it('survives corrupt storage rather than throwing on the conversion page', () => {
    window.sessionStorage.setItem(CLICK_ID_STORAGE_KEY, 'not json');
    expect(recallClickId()).toBeNull();
  });
});
