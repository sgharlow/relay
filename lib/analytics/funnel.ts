/**
 * G1 funnel instrument.
 *
 * `emitFunnel` returns whether a transport actually accepted the event. The
 * previous instrument called `window.va?.()` and reported nothing when the stub
 * had not been created yet, so the gate would have read as "no demand" when the
 * truth was "no measurement". An empty analytics dashboard and a broken
 * instrument are indistinguishable, so delivery has to be observable.
 *
 * Every event carries the inbound `channel`, parked in sessionStorage on first
 * sight, so the numerator and denominator of click-to-intent are keyed the same
 * way. `cta` stays a separate dimension (J1-R9, J1-R10).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10
 */

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

/** Resolves true only when a live transport accepted the event. */
export async function emitFunnel(
  event: FunnelEvent,
  props: Record<string, string> = {},
): Promise<boolean> {
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  const va = w?.va as ((kind: string, payload: Record<string, unknown>) => void) | undefined;

  if (typeof va !== 'function') return false;

  try {
    va('event', { name: event, ...props });
    return true;
  } catch {
    return false;
  }
}
