/**
 * "The instrument is alive" is two claims, and the walk only ever proved one.
 *
 * 🔴 MEASURED 2026-08-31, and this is the whole reason the file exists.
 * `npm run verify:funnel` drove a real browser against production and passed
 * 7/7 — landing page loads, `caregiver_qualified` fires, `caregiver_intent`
 * fires, both carry `src`, the ratio is computable — and printed:
 *
 *     ✓ all 7 checks passed — the instrument is alive.
 *
 * At that same moment the Vercel Web Analytics API answered
 * `web_analytics_not_enabled` for this project. The events fire perfectly and
 * **nothing collects them**.
 *
 * The walk's OWN failure message names the consequence: *"A flight measured by a
 * dead instrument reads zero, which is indistinguishable from no demand."* That
 * sentence describes the live state, and the walk prints the green line above it.
 *
 * ⚠️ WHY THIS IS THE MOST EXPENSIVE PLACE IN THE REPOSITORY FOR A FALSE GREEN.
 * `gates.g1-arms-length-demand` is read from these events — pass ≥6% at N≥50,
 * kill <2% at N≥150 — and a placement is a ONE-SHOT event: the reader arrives,
 * the window passes, and **the number cannot be re-collected afterwards**. A
 * placement launched on this state produces an empty dashboard beside a site
 * that appears to be reporting correctly, and the D2C branch gets decided on a
 * zero that measured nothing.
 *
 * So the verdict is split. Emitting is provable from a browser; collecting is
 * not, and a walk that cannot see the second half must not speak for it.
 *
 * Feature: relay-g1-wtp
 * Requirements: A7.0
 */

/**
 * Is anything on the far end actually recording what the page sends?
 *
 * `unknown` is a first-class answer and is deliberately NOT merged into either
 * of the others: "I could not check" reading as "it is fine" is the failure this
 * module exists to prevent, and it is the same three-way exit `verify:stripe`
 * and `verify:csp` already use.
 */
export type Collection = 'enabled' | 'disabled' | 'unknown';

export interface Verdict {
  /** 0 = both halves hold · 1 = a finding · 2 = could not look. */
  code: 0 | 1 | 2;
  line: string;
  /** Extra lines the caller should print. Never empty when code !== 0. */
  notes: string[];
}

/** How to establish the collection half, named once so the message can cite it. */
export const HOW_TO_CHECK_COLLECTION =
  'Vercel dashboard → the relay project → Analytics, or a Web Analytics API read ' +
  '(the MCP `get_web_analytics` tool answers it directly).';

export function verdict(params: {
  emitPassed: number;
  emitTotal: number;
  collection: Collection;
}): Verdict {
  const { emitPassed, emitTotal, collection } = params;

  if (emitPassed < emitTotal) {
    return {
      code: 1,
      line: `✗ ${emitTotal - emitPassed} of ${emitTotal} emit checks FAILED.`,
      notes: [
        'Do not let a lane run against this. A flight measured by a dead instrument reads zero,',
        'which is indistinguishable from no demand.',
      ],
    };
  }

  if (collection === 'disabled') {
    return {
      code: 1,
      /*
        🔴 The discriminating case, and the live one on 2026-08-31. Every emit
        check passes and the result is still a FINDING — because a page that
        fires flawlessly into a void is exactly as useful as a page that fires
        nothing, and considerably more convincing.
      */
      line: `✗ all ${emitTotal} emit checks passed AND NOTHING IS COLLECTING THEM.`,
      notes: [
        'The page fires both events correctly. Vercel Web Analytics is NOT ENABLED for this',
        'project, so they go nowhere readable.',
        '',
        '🔴 DO NOT LAUNCH A PLACEMENT ON THIS. A placement is one-shot: the reader arrives, the',
        '   window passes, and the number cannot be re-collected afterwards. g1-arms-length-demand',
        '   would be decided on a zero that measured nothing.',
        '',
        `   Fix: ${HOW_TO_CHECK_COLLECTION}`,
      ],
    };
  }

  if (collection === 'unknown') {
    return {
      code: 2,
      /*
        NOT a pass. The walk proved the half it can see and says so in those
        words — the previous version said "the instrument is alive", which is a
        claim about both halves made from evidence about one.
      */
      line: `~ all ${emitTotal} emit checks passed — the page FIRES correctly.`,
      notes: [
        '⚠️ THIS IS NOT "the instrument is alive". Whether anything COLLECTS these events was not',
        '   checked, and on 2026-08-31 the answer was no: the Vercel Web Analytics API returned',
        '   `web_analytics_not_enabled` while this same walk passed 7/7.',
        '',
        `   Check it before a placement: ${HOW_TO_CHECK_COLLECTION}`,
        '   Then re-run with FUNNEL_COLLECTION=enabled to get a green.',
      ],
    };
  }

  return {
    code: 0,
    line: `✓ all ${emitTotal} emit checks passed and collection is enabled — the instrument is alive.`,
    notes: [],
  };
}

/**
 * Read the collection state from the environment.
 *
 * ⚠️ IT DEFAULTS TO `unknown`, NOT to `enabled`. A default that assumes the
 * favourable answer is how the original overclaim happened, and the whole point
 * of this module is that silence about the second half is not evidence for it.
 */
export function collectionFromEnv(v: string | undefined): Collection {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'enabled' || s === 'true' || s === '1') return 'enabled';
  if (s === 'disabled' || s === 'false' || s === '0') return 'disabled';
  return 'unknown';
}
