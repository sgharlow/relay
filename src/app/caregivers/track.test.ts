/**
 * G1 WTP instrument — regression guard for the silent-drop bug found live 2026-08-05.
 *
 * The trackers' effects run BEFORE <Analytics/> creates `window.va`, and
 * @vercel/analytics emits through `window.va?.(...)` — so a bare `track()` call
 * vanished and both gate events were never recorded. These tests reproduce that
 * exact condition (a window with NO `va`) and assert the event survives.
 *
 * Feature: relay-g1-wtp
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CAREGIVER_INTENT, CAREGIVER_QUALIFIED } from './analytics';
import { ensureAnalyticsQueue, trackG1 } from './track';

interface AnalyticsWindow {
  va?: (...params: unknown[]) => void;
  vaq?: unknown[][];
}

/** Installs a bare window with no analytics queue — the pre-<Analytics/> state. */
function givenWindowWithoutAnalytics(): AnalyticsWindow {
  const w: AnalyticsWindow = {};
  (globalThis as { window?: unknown }).window = w;
  return w;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('G1 event emission', () => {
  it('queues the denominator even when <Analytics/> has not mounted yet', () => {
    const w = givenWindowWithoutAnalytics();
    expect(w.va).toBeUndefined(); // the exact condition that dropped events

    trackG1(CAREGIVER_QUALIFIED, { src: 'reddit-ads' });

    const events = (w.vaq ?? []).filter(([kind]) => kind === 'event');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      name: CAREGIVER_QUALIFIED,
      data: { src: 'reddit-ads' },
    });
  });

  it('queues the numerator too — the same flaw hit both gate events', () => {
    const w = givenWindowWithoutAnalytics();

    trackG1(CAREGIVER_INTENT, { src: 'h0-demo' });

    const events = (w.vaq ?? []).filter(([kind]) => kind === 'event');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      name: CAREGIVER_INTENT,
      data: { src: 'h0-demo' },
    });
  });

  it('never displaces an existing queue — <Analytics/> drains what we queued', () => {
    const w = givenWindowWithoutAnalytics();
    trackG1(CAREGIVER_QUALIFIED, { src: 'meta-ads' });
    const installed = w.va;

    // A later mount (or a second event) must reuse the same queue, not reset it.
    ensureAnalyticsQueue();
    trackG1(CAREGIVER_INTENT, { src: 'meta-ads' });

    expect(w.va).toBe(installed);
    expect((w.vaq ?? []).filter(([kind]) => kind === 'event')).toHaveLength(2);
  });

  it('is a no-op on the server rather than throwing', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => ensureAnalyticsQueue()).not.toThrow();
  });
});
