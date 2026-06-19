/**
 * Open-redirect-safe callback path resolution.
 *
 * A post-login `callbackUrl` must be a same-origin relative path; anything else
 * (absolute URL, protocol-relative `//host`, backslash tricks) falls back to a
 * safe default. Pure + DB-free so it is unit-tested and client-safe.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

export function safeInternalPath(raw: string | null | undefined, fallback = '/vault'): string {
  if (!raw) return fallback;
  // Must start with a single '/', and not be protocol-relative ('//') or contain
  // a scheme or backslash that browsers may normalise into a cross-origin jump.
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (raw.includes('\\')) return fallback;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(raw)) return fallback; // e.g. "/javascript:" style
  return raw;
}
