/**
 * A small fixed-window rate limiter for public, unauthenticated endpoints.
 *
 * HONEST ABOUT WHAT THIS IS NOT. The counter lives in process memory, so it is
 * per-instance, not global. Vercel's Fluid Compute reuses instances across
 * requests, which makes it genuinely effective against the realistic threat —
 * a single client hammering a form, and double-submits from an impatient thumb
 * on a slow connection — but a distributed flood across many instances would
 * get through. It is not a security boundary and must never be the only defence
 * on anything that costs money or grants access.
 *
 * It is deployed here because the alternative for the G1 window is a shared
 * store, and adding infrastructure to a working system for a $250 ad test is
 * the wrong trade. If lead spam actually materialises, that is the documented
 * problem that would justify the upgrade.
 *
 * Feature: relay-g1-wtp
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounds memory if a flood produces many distinct keys. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets — for a Retry-After header. */
  retryAfterSeconds: number;
}

/**
 * Counts one hit against `key`. Allows up to `limit` hits per `windowMs`.
 *
 * `now` is injectable so tests can advance time without sleeping; production
 * callers omit it.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    if (windows.size >= MAX_TRACKED_KEYS) evictExpired(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function evictExpired(now: number): void {
  for (const [k, w] of windows) {
    if (now >= w.resetAt) windows.delete(k);
  }
  // If every window is still live, drop the oldest to keep the map bounded
  // rather than growing without limit.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const oldest = windows.keys().next();
    if (!oldest.done) windows.delete(oldest.value);
  }
}

/** Test seam — clears all counters. */
export function _resetRateLimitForTesting(): void {
  windows.clear();
}

/**
 * Best-effort client identity for rate limiting. Vercel sets x-forwarded-for;
 * the left-most entry is the client. Falls back to a shared bucket, which is
 * deliberately conservative: an unidentifiable client is limited alongside
 * every other unidentifiable client rather than being let through unbounded.
 */
export function clientKey(headers: Headers, prefix: string): string {
  const fwd = headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
  return `${prefix}:${ip}`;
}
