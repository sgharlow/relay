/**
 * Tests for the G1 funnel instrument.
 *
 * The failure mode being defended against is SILENCE. On 2026-08-05 the entire
 * WTP instrument emitted nothing: `track()` called `window.va?.()`, but
 * <Analytics/> creates that stub in its own effect and layout.tsx renders
 * {children} first, so both gate events were swallowed. Unit tests passed
 * because they only covered the helper.
 *
 * An empty analytics dashboard and a broken instrument look identical, so
 * emitFunnel reports whether a transport actually accepted the event.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitFunnel, FUNNEL_EVENTS, channelFrom, resolveChannel } from './funnel';

type W = { va?: unknown; sessionStorage?: Record<string, unknown> };

function withWindow(w: W | undefined) {
  (globalThis as { window?: unknown }).window = w;
}

beforeEach(() => withWindow({}));
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('FUNNEL_EVENTS', () => {
  it('is exactly the six funnel stages, in order', () => {
    expect([...FUNNEL_EVENTS]).toEqual([
      'caregiver_qualified',
      'seed_started',
      'seed_completed',
      'reveal_viewed',
      'price_viewed',
      'intent_clicked',
    ]);
  });
});

describe('emitFunnel', () => {
  it('returns FALSE when no transport exists — never silently succeeds', async () => {
    await expect(emitFunnel('reveal_viewed')).resolves.toBe(false);
  });

  it('returns false when window itself is absent (SSR)', async () => {
    withWindow(undefined);
    await expect(emitFunnel('reveal_viewed')).resolves.toBe(false);
  });

  it('returns false when va exists but is not callable', async () => {
    withWindow({ va: 'not-a-function' });
    await expect(emitFunnel('reveal_viewed')).resolves.toBe(false);
  });

  it('returns true and forwards the event when a transport is present', async () => {
    const va = vi.fn();
    withWindow({ va });

    await expect(emitFunnel('intent_clicked', { channel: 'reddit' })).resolves.toBe(true);
    expect(va).toHaveBeenCalledWith('event', { name: 'intent_clicked', channel: 'reddit' });
  });

  it('keys the event by channel so per-channel conversion is computable', async () => {
    const va = vi.fn();
    withWindow({ va });

    await emitFunnel('price_viewed', { channel: 'search', cta: 'hero' });

    expect(va.mock.calls[0][1]).toMatchObject({ channel: 'search', cta: 'hero' });
  });

  it('returns false rather than throwing if the transport throws', async () => {
    withWindow({
      va: vi.fn(() => {
        throw new Error('transport exploded');
      }),
    });

    await expect(emitFunnel('seed_started')).resolves.toBe(false);
  });
});

describe('channelFrom', () => {
  it('reads the inbound channel from a query string', () => {
    expect(channelFrom('?src=reddit')).toBe('reddit');
    expect(channelFrom('?utm_source=hn')).toBe('hn');
    expect(channelFrom('?ref=newsletter')).toBe('newsletter');
  });

  it('prefers src over utm_source when both are present', () => {
    expect(channelFrom('?utm_source=hn&src=reddit')).toBe('reddit');
  });

  it('falls back to direct', () => {
    expect(channelFrom('')).toBe('direct');
    expect(channelFrom('?other=1')).toBe('direct');
  });
});

describe('resolveChannel', () => {
  it('parks the first-seen channel so numerator and denominator match', () => {
    const store: Record<string, string> = {};
    const ss = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    withWindow({ sessionStorage: ss } as never);

    expect(resolveChannel('?src=reddit')).toBe('reddit');
    // A later navigation with no params must NOT downgrade the channel to direct.
    expect(resolveChannel('')).toBe('reddit');
  });

  it('falls back to the query value when sessionStorage is unavailable', () => {
    withWindow({});
    expect(resolveChannel('?src=reddit')).toBe('reddit');
  });
});
