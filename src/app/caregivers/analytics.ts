/**
 * G1 WTP instrument — measurement event contract (Vercel Web Analytics custom events).
 *
 * The gate metric is click-to-intent BY SOURCE (docs/g1-wtp-test-design.md): only
 * `src`-tagged traffic counts toward N (the tagged-only doctrine). Raw pageview faceting
 * by query param is unreliable on Vercel's free tier, so the instrument emits two custom
 * events — the denominator and the numerator — each carrying the `src`, letting the exact
 * ratio be read directly from the Analytics dashboard. Still zero-DB: demo DSQL is torn
 * down post-judging and G1 must not depend on it.
 *
 *   click-to-intent = count(CAREGIVER_INTENT) / count(CAREGIVER_QUALIFIED), same window,
 *                     filtered to a real (non-'direct') src.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

/** Denominator: a qualified visit to the /caregivers landing (inbound channel = src). */
export const CAREGIVER_QUALIFIED = 'caregiver_qualified';

/** Numerator: intent — a visit to /caregivers/interest with the price already seen. */
export const CAREGIVER_INTENT = 'caregiver_intent';

/**
 * Extract the source-attribution props from a URL query string. Untagged/empty resolves
 * to 'direct' so it can be excluded from N (mirrors the tagged-only qualification rule);
 * URL-encoded channel values (e.g. `r%2FCaregiverSupport`) are decoded by URLSearchParams,
 * round-tripping the encoding intentHref() applies.
 */
export function srcFromSearch(search: string): { src: string } {
  const raw = new URLSearchParams(search).get('src')?.trim();
  return { src: raw ? raw : 'direct' };
}
