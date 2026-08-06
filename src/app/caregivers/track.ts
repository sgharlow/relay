/**
 * G1 WTP instrument — event emission that cannot be silently dropped.
 *
 * WHY THIS EXISTS (bug found live 2026-08-05, both events affected):
 * `track()` from @vercel/analytics emits via `window.va?.(...)`. The `window.va`
 * queue stub is created by `<Analytics/>`'s own useEffect — and in this app the
 * root layout renders `{children}` BEFORE `<Analytics/>`, so React runs the page's
 * tracker effects FIRST. `window.va` was therefore still undefined, the optional
 * chaining swallowed the call, and BOTH `caregiver_qualified` (denominator) and
 * `caregiver_intent` (numerator) were emitted into the void on every visit. The
 * unit tests still passed, because they only ever covered `srcFromSearch`.
 *
 * The fix is to create the queue ourselves before emitting. Vercel's `initQueue()`
 * is idempotent and non-destructive (`if (window.va) return`), and the analytics
 * script drains `window.vaq` once it loads — so an event queued before `<Analytics/>`
 * mounts is delivered, not lost.
 *
 * Do not call `track()` directly from a G1 tracker component; call this.
 *
 * Feature: relay-g1-wtp
 */

import { track } from '@vercel/analytics';

type QueuedCall = unknown[];
interface AnalyticsWindow {
  va?: (...params: QueuedCall) => void;
  vaq?: QueuedCall[];
}

/**
 * Guarantees the analytics queue exists, mirroring Vercel's own `initQueue()`.
 * Safe to call repeatedly and safe to call before `<Analytics/>` mounts.
 */
export function ensureAnalyticsQueue(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as AnalyticsWindow;
  if (w.va) return;
  w.va = function queued(...params: QueuedCall): void {
    if (!w.vaq) w.vaq = [];
    w.vaq.push(params);
  };
}

/**
 * Emits a G1 gate event, queueing it if the analytics script has not loaded yet.
 * `src` is always the inbound CHANNEL — the denominator and numerator must share
 * that vocabulary or the gate ratio cannot be computed. Extra dimensions (e.g.
 * `cta`) ride alongside.
 */
export function trackG1(eventName: string, props: { src: string } & Record<string, string>): void {
  ensureAnalyticsQueue();
  track(eventName, props);
}
