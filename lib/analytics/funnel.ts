/**
 * G1 funnel instrument.
 *
 * TWO BUGS WERE FOUND HERE BY READING THE BYTES ON THE WIRE (2026-08-07), not
 * by tests and not by HTTP status. Both produced a 200 and an event that landed
 * in the dashboard — while being useless for the gate:
 *
 *  1. WRONG PAYLOAD SHAPE. This module called `window.va('event', {name,
 *     ...props})` directly. Vercel nests custom properties under `data`, so
 *     top-level props are DROPPED: `seed_started` arrived with no `ed` field at
 *     all and therefore no channel attribution. `track()` from the SDK builds
 *     the payload correctly, so we delegate to it rather than hand-rolling.
 *
 *  2. WRONG PROPERTY KEY. This module used `channel` while the landing-page
 *     instrument uses `src`. The numerator and denominator of click-to-intent
 *     would have been keyed by different names — the exact mismatch fixed in
 *     2a9eb88, reintroduced. `src` IS the inbound channel; that vocabulary is
 *     shared and must not be forked.
 *
 * Emission goes through `trackG1`, which also guarantees the analytics queue
 * exists before emitting — the 2026-08-05 bug where `<Analytics/>` had not
 * created `window.va` yet and every event was swallowed.
 *
 * NOTE ON THE RETURN VALUE: true means the event was handed to a live queue or
 * transport, NOT that it reached the dashboard. Queue-handoff is the strongest
 * signal available synchronously. Actual delivery is proven by watching the
 * POST bodies in a browser — see docs/g1-launch-checklist.md.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10
 */

import { trackG1, ensureAnalyticsQueue } from '../../src/app/caregivers/track';

export const FUNNEL_EVENTS = [
  'caregiver_qualified',
  'seed_started',
  'seed_completed',
  'reveal_viewed',
  'price_viewed',
  'intent_clicked',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const CHANNEL_KEYS = ['src', 'utm_source', 'ref'] as const;
const CHANNEL_STORAGE_KEY = 'relay.channel';

export function channelFrom(search: string): string {
  const params = new URLSearchParams(search);

  for (const key of CHANNEL_KEYS) {
    const value = params.get(key);
    if (value) return value;
  }

  return 'direct';
}

/**
 * The channel for THIS visitor: first-seen wins and is parked, so a later
 * in-app navigation without query params cannot silently re-label them
 * "direct" and break the funnel's denominator.
 */
export function resolveChannel(search: string): string {
  const fromQuery = channelFrom(search);

  const store = (globalThis as unknown as { window?: { sessionStorage?: Storage } }).window
    ?.sessionStorage;
  if (!store) return fromQuery;

  try {
    const parked = store.getItem(CHANNEL_STORAGE_KEY);
    if (parked) return parked;

    if (fromQuery !== 'direct') {
      store.setItem(CHANNEL_STORAGE_KEY, fromQuery);
    }
  } catch {
    // Private-mode storage failures must not break measurement.
  }

  return fromQuery;
}

/**
 * Emits a funnel event.
 *
 * `channel` is written to the `src` property, because that is the key the
 * landing-page events already use and a gate ratio cannot be computed across
 * two different property names.
 *
 * Returns whether the event was accepted by a queue/transport.
 */
export async function emitFunnel(
  event: FunnelEvent,
  props: Record<string, string> = {},
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const { channel, ...rest } = props;

  try {
    ensureAnalyticsQueue();
    // `src` — the shared channel vocabulary. Never emit `channel`.
    trackG1(event, { src: channel ?? 'direct', ...rest });
    return true;
  } catch {
    return false;
  }
}
