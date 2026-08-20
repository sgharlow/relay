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
 * ⛔ THE PARAGRAPH THAT STOOD HERE JUSTIFIED THIS MODULE BY A FLIGHT THAT WAS
 * CANCELLED. It read: *"It is deployed here because the alternative for the G1
 * window is a shared store, and adding infrastructure to a working system for a
 * $250 ad test is the wrong trade. If lead spam actually materialises, that is
 * the documented problem that would justify the upgrade."*
 *
 * Paid advertising was retired permanently on 2026-08-16
 * (`ratified.retire-paid-advertising`, `ratified.g1-google-lane-cancelled`), so
 * the trade it describes is against a thing that no longer exists and the
 * trigger it names — lead spam during an ad flight — can never fire. A
 * justification resting on a dead premise is the drift this repo keeps
 * catching, so it is quoted above rather than deleted and replaced below.
 *
 * ── THE STANCE, RE-DERIVED 2026-08-20 ──────────────────────────────────────
 *
 * Unchanged: this is not a security boundary, and it must never be the only
 * defence on anything that costs money or grants access. What changed is the
 * answer to *what should be*, and it is not "buy a shared store".
 *
 * 🔑 THIS CODEBASE HAS ALREADY SOLVED DURABLE METERING TWICE, WITH STORAGE IT
 * ALREADY OWNS — which is the fact that decides the question:
 *
 *   lib/notify/invite-budget.ts   counts `audit_log` rows per owner per day.
 *                                 No new table, no new service.
 *   lib/auth/signin-attempts.ts   an append-only table counted by a predicate
 *                                 (migration 036). The front door's budget.
 *
 * So the choice was never "per-instance memory or new infrastructure". It is
 * "per-instance memory, or the durable pattern already in the repository,
 * applied to the endpoints that earn it". The second costs a query per request
 * on the path it guards, which is why it is applied endpoint by endpoint on
 * evidence rather than wholesale.
 *
 * ⚠️ AND THE MOST SECURITY-CRITICAL USER OF THIS MODULE IS ALREADY BACKED BY A
 * ROW. Owner sign-in leans on `signin-throttle.ts`, whose per-address budget is
 * durable since 2026-08-20; only its per-SOURCE bound still lives here. The
 * argument for a shared store was strongest for exactly that case, and it has
 * already been answered without one.
 *
 * WHAT IS STILL ONLY IN MEMORY, and what that is worth:
 * the unauthenticated endpoints — signup, the lead form, support, the resend
 * paths, the report sinks. A distributed flood across instances gets through
 * every one of them. The full endpoint-by-endpoint reckoning, including which
 * ones would actually cost something and which are merely noisy, is
 * `docs/rate-limit-stance-2026-08-20.md`, and it is a DECISION for Steve rather
 * than a change taken here: a shared store is infrastructure and needs the
 * 5-gate policy.
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
