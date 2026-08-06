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

/**
 * Where the inbound channel is parked between the two pages.
 *
 * WHY (fixed 2026-08-05): the landing CTAs link to `/caregivers/interest?src=hero|nav|pricing`,
 * so the intent page's `?src=` is the CTA POSITION and the inbound channel is overwritten at the
 * moment of the click. The denominator was therefore labelled by channel and the numerator by CTA
 * position — two disjoint vocabularies — which makes `intent ÷ qualified` "filtered to a real src"
 * undefined as the design doc states it, and leaves per-channel conversion (the thing the paid
 * budget is meant to buy) unrecoverable. Worse after the showcase exclusion landed: h0-* traffic
 * was excluded from the denominator while its intent events still counted as `hero` in the
 * numerator — inflating the rate and risking a FALSE PASS of the 2% gate.
 *
 * Fix: remember the channel on the landing page, report it as `src` on the intent event, and keep
 * the CTA position as a separate `cta` dimension. Session-scoped: attribution should not outlive
 * the visit.
 */
export const CHANNEL_STORAGE_KEY = 'relay.g1.channel';

/**
 * Persists a real inbound channel. An untagged ('direct') visit deliberately does NOT overwrite a
 * channel already stored this session — otherwise navigating away and back would erase the
 * attribution of the ad click that started the session.
 */
export function rememberChannel(src: string): void {
  if (!src || src === 'direct') return;
  try {
    window.sessionStorage.setItem(CHANNEL_STORAGE_KEY, src);
  } catch {
    // Private mode / storage disabled: fall through to 'direct', which is excluded from N.
  }
}

/** Reads the channel stored by the landing page; 'direct' when absent or unreadable. */
export function recallChannel(): string {
  try {
    const stored = window.sessionStorage.getItem(CHANNEL_STORAGE_KEY)?.trim();
    return stored ? stored : 'direct';
  } catch {
    return 'direct';
  }
}

/**
 * Props for the numerator: `src` is the inbound CHANNEL (so it shares a vocabulary with the
 * denominator and the ratio is computable), `cta` is which button was pressed.
 */
export function intentProps(search: string, channel: string): { src: string; cta: string } {
  const position = new URLSearchParams(search).get('src')?.trim();
  return {
    src: channel.trim() ? channel.trim() : 'direct',
    cta: position ? position : 'unknown',
  };
}
