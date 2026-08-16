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
 * A lead actually captured — email plus, usually, a sentence about their
 * situation.
 *
 * Added 2026-08-08. The form shipped without this, so the strongest signal the
 * funnel produces was invisible to the funnel. It matters more than the ratio
 * it sits beneath: at the ratified N the intent gate is deciding on a couple of
 * observations, whereas twenty caregivers describing their own circumstances is
 * decision-grade evidence about whether this product should exist.
 *
 * Strictly downstream of CAREGIVER_INTENT and NOT part of the ratified gate
 * ratio — it is a second, richer read on the same traffic.
 */
export const CAREGIVER_LEAD = 'caregiver_lead_submitted';

/**
 * Someone chose to buy rather than join the list.
 *
 * Added 2026-08-08 when live checkout landed. Strictly downstream of
 * CAREGIVER_INTENT and NOT part of the ratified gate ratio — but it is the
 * strongest signal this funnel can produce, because it is the only one where
 * the visitor is reaching for a card rather than expressing an opinion.
 */
export const CAREGIVER_CHECKOUT = 'caregiver_checkout_started';

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
 * Props for the DENOMINATOR: park this visit's inbound tag, then report the channel the
 * session actually carries — the same value the numerator will report.
 *
 * WHY THIS EXISTS (observed on production 2026-08-10, one walk, one page pair):
 *   caregiver_qualified {"src":"direct"}                        -> EXCLUDED from N
 *   caregiver_intent    {"src":"visual-check","cta":"hero"}     -> COUNTED in N
 * The denominator read `window.location.search` while the numerator read the parked
 * channel, so the two disagreed whenever a session already had a channel and the current
 * landing hit was untagged. A numerator entry with no matching denominator entry biases
 * click-to-intent UP — toward a false PASS of the 2% gate, the costlier error.
 *
 * Parking BEFORE recalling preserves every ratified behaviour: a tagged visit parks its own
 * src and reports it; an untagged visit does not overwrite a stored channel (rememberChannel
 * returns early on 'direct'); a session that never carried a channel still reports 'direct'
 * and stays out of N.
 */
export function qualifiedProps(search: string): { src: string } {
  const inbound = srcFromSearch(search);
  rememberChannel(inbound.src);
  return { src: recallChannel() };
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

/**
 * Has this session already emitted this G1 event?
 *
 * 🔴 THE GATE IS SPECIFIED IN VISITORS AND THE INSTRUMENT COUNTED PAGE VIEWS.
 * `PROJECT.yaml` reads "N >= 100 qualified visitors" and
 * docs/g1-wtp-test-design.md "≥ 2% click-to-intent at a real price point,
 * N ≥ 100 qualified visitors". Both trackers fired on every MOUNT, so one person
 * reloading, pressing back, or reopening a page counted again.
 *
 * The two sides inflate on different actions, which is why this is not a wash:
 * reloading /caregivers inflates the DENOMINATOR (biasing toward a false kill),
 * and reloading /caregivers/interest inflates the NUMERATOR (biasing toward a
 * false SHIP). The conversion page is the one a visitor is likelier to return
 * to, and a false ship is the error that spends money.
 *
 * SESSION-SCOPED, matching `CHANNEL_STORAGE_KEY` beside it — attribution should
 * not outlive the visit, and neither should a conversion. A genuinely new visit
 * is a new session and counts again, which is correct.
 *
 * ⚠️ FAILS OPEN, deliberately. Private mode and blocked storage throw here, and
 * the choice is between possibly counting a visitor twice and certainly not
 * counting them at all. Silently dropping conversions biases toward a false
 * kill and is invisible; the duplicate at least leaves a trace. `recallChannel`
 * above makes the same trade for the same reason.
 */
export function firstTimeThisSession(key: string): boolean {
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}

/** Session keys for the two ratio events. Distinct, so one cannot suppress the other. */
export const QUALIFIED_ONCE_KEY = 'relay.g1.qualified.sent';
export const INTENT_ONCE_KEY = 'relay.g1.intent.sent';
