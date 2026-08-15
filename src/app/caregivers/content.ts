/**
 * G1 caregiver-wedge WTP test — content constants.
 *
 * Factored out of the page so the gate's pre-committed rules are testable without
 * rendering RSC (repo convention: pure logic outside the component).
 *
 * PRICE RATIFIED by Steve 2026-07-03: $119/yr (docs/g1-wtp-test-design.md).
 * Rule from docs/COMPETITORS.md: test AT or ABOVE the Everplans anchor ($99.99/yr),
 * never below — G1 measures willingness to pay a real price, not a discount.
 *
 * Feature: relay-g1-wtp (post-H0-disposition; ships only after the verdict)
 */

export const PRICE_YEARLY_USD = 119;

export const ANCHOR = { name: 'Everplans', priceYearlyUsd: 99.99 } as const;

export const HEADLINE = 'Emergency access that closes itself.';

/**
 * RATIFIED THIRD PERSON 2026-08-14 (Steve), closing the open decision recorded in
 * `docs/g1-flight-log.md`. Option (b) of the three: rewrite before the first ad
 * submission, while zero traffic exists to invalidate.
 *
 * WHAT WAS WRONG. It read "When a parent lands in the hospital, YOU need THEIR
 * accounts NOW". That is the exact second-person-plus-family-health construction
 * `g1-ad-creatives.md` §1a removed from four creatives after reading Meta's
 * Personal Attributes standard from the source — and **ad reviewers visit the
 * destination**, so compliant ad copy pointing here was only a partial mitigation.
 * The attribute is not the violation; the attribute joined to "you/your" is.
 *
 * The opening clause is now §1a's own sanctioned example ("A hospital stay can
 * mean a family suddenly needs access"), which is the strongest position available
 * if a reviewer ever queries it.
 *
 * ⚠️ THIS CHANGES WHAT THE GATE MEASURES, and that is why it happens NOW rather
 * than mid-flight: the reversibility lead, the price, the CTA and every exclusion
 * rule are untouched, and no qualified visitor has ever seen either version.
 * `content.test.ts` pins the compliance rule so it cannot regress by a later edit.
 */
export const SUBHEAD =
  'A hospital stay can mean a family suddenly needs access to accounts only one person ' +
  'could reach — and needs that access to end when the crisis does. Relay opens exactly ' +
  'what was granted, and seals itself again as soon as that person checks back in. ' +
  'No rival does the second half.';

export const CTA_LABEL = `Start your family's vault — $${PRICE_YEARLY_USD}/yr`;

export const CTA_HREF = '/caregivers/interest';

/**
 * Share-card copy. MOVED HERE from page.tsx 2026-08-14, for the reason stated at
 * the top of this file: copy that a pre-committed rule governs has to be testable
 * without rendering RSC. It sat one field away from SUBHEAD carrying the identical
 * §1a defect — "Opens for YOU in a real emergency, seals itself when THEY recover"
 * — and it is the copy an ad reviewer's crawler reads, so fixing only the visible
 * subhead would have left the destination non-compliant where it is read by machine.
 */
export const OG_TITLE = 'Relay for caregivers — emergency access that closes itself';
export const OG_DESCRIPTION =
  'One encrypted vault for a parent’s accounts and instructions. Opens to the people named ' +
  'in it when an emergency is confirmed, then seals itself on the next check-in. ' +
  'Reversible by design.';

/**
 * H0 win — distribution ammunition, per the disposition plan's WIN branch.
 * Shown on the landing before first send (g1-launch-checklist.md step 3).
 */
export const WINNER_BADGE = 'Winner — Most Impactful, H0 Hackathon 2026';

/**
 * SECONDARY LANE (added 2026-08-07, "run both").
 *
 * The gate metric is unchanged: caregiver_intent ÷ caregiver_qualified. This CTA
 * opens the PRODUCT funnel — signup → prompted seed → risk-graph reveal → price —
 * which measures willingness to pay AFTER the stakes have been demonstrated
 * rather than from the landing copy alone.
 *
 * It does not split the gate: both paths emit caregiver_intent with `cta: 'start'`,
 * which is what separates them in analysis. One traffic buy, two conversion routes,
 * two readings.
 *
 * CORRECTED 2026-08-10. This comment used to say a Lane-B conversion "still lands on
 * /caregivers/interest, so caregiver_intent still fires". That stopped being true the
 * moment live Stripe checkout landed (2026-08-08): the price card now redirects to
 * Stripe and the interest page is only the fallback, so a visitor who BOUGHT emitted no
 * numerator at all. The emission moved into lib/analytics/lane-b.ts, which owns the
 * branch and guarantees exactly one numerator per click.
 */
export const SECONDARY_CTA_LABEL = 'Or see it on your own family first — free, 10 items';

export const SECONDARY_CTA_HREF = '/auth/signup';

/** Signup link carrying the inbound channel, so attribution survives into /start. */
export function productHref(src?: string): string {
  return src ? `${SECONDARY_CTA_HREF}?src=${encodeURIComponent(src)}` : SECONDARY_CTA_HREF;
}

export const LANDING_HREF = '/caregivers';

/** Intent link with source attribution — a visit to CTA_HREF IS the G1 intent event. */
export function intentHref(src?: string): string {
  return src ? `${CTA_HREF}?src=${encodeURIComponent(src)}` : CTA_HREF;
}

/** Inbound link to the caregiver landing, carrying its channel tag. */
export function caregiversHref(src?: string): string {
  return src ? `${LANDING_HREF}?src=${encodeURIComponent(src)}` : LANDING_HREF;
}

/**
 * Showcase sources — inbound traffic from the H0-win surfaces (the landing page and
 * the /demo tour). These are tagged so the funnel is not a dead end, but they are
 * NOT caregiver-targeted channels, and the gate defines a qualified visitor as a
 * session "from a caregiver-targeted source" (docs/g1-wtp-test-design.md).
 *
 * Counting a wave of hackathon traffic toward N would drive the ratio toward zero on
 * an audience the test was never about — and the gate KILLS at <0.5% after 100+
 * qualified. So these srcs are excluded from the gate read and interpreted only as a
 * secondary signal ("did the tech audience contain caregivers?"). The exclusion is
 * enforced in content.test.ts, not left to whoever reads the dashboard.
 */
export const SHOWCASE_SRCS = ['h0-demo', 'h0-home'] as const;

/**
 * OUR OWN traffic — instrument verification, not audience.
 *
 * `docs/g1-ad-creatives.md` makes "click your own live ad and confirm both events carry
 * `src`" a non-optional pre-flight step, and it is the right step: this funnel has been
 * silently dead twice and only a real browser has ever caught it. But performed with a
 * lane value it injects one qualified and one intent at 100% conversion — a full
 * percentage point on a 2% ship line at N=100, biasing toward the FALSE PASS that funds a
 * build on demand that does not exist.
 *
 * That contamination is not recoverable. The verification step can delete its
 * `caregiver_leads` row; it cannot delete a Vercel Analytics event. So the exclusion has
 * to exist BEFORE the first verification click, not be corrected afterwards.
 *
 * Kept separate from SHOWCASE_SRCS deliberately: showcase traffic is real humans from the
 * wrong audience and is read as a secondary segment, whereas this is us. Folding them
 * together would let our own clicks be reported as audience signal.
 */
export const QA_SRCS = ['qa', 'preflight'] as const;

/** Sources that are tagged but must never reach the gate ratio, for any reason. */
const NON_QUALIFYING_SRCS: readonly string[] = [...SHOWCASE_SRCS, ...QA_SRCS];

/** True when a src counts toward the G1 gate ratio (tagged, caregiver-targeted, not ours). */
export function isGateQualifyingSrc(src: string): boolean {
  const s = src.trim();
  if (!s || s === 'direct') return false;
  return !NON_QUALIFYING_SRCS.includes(s);
}

export const DIFFERENTIATORS = [
  {
    them: 'Sharing the password notebook (or a notes app)',
    problem: 'Everything, to everyone, forever. No scope, no expiry, no record of who looked.',
    relay: 'Each person gets only their granted items, only after a real trigger, with a tamper-evident record.',
  },
  {
    them: 'Static organizers (Everplans, GoodTrust, Trustworthy)',
    problem: 'A binder is permanent: once shared, it cannot be unshared — and it goes stale.',
    // "so nothing YOU share" sat in the same sentence as "a recovery check-in".
    // Incidental rather than a health claim — but it is the join a skimming
    // reviewer pattern-matches, and third person costs nothing here.
    relay: 'Reversible by default — a recovery check-in closes access automatically, so nothing shared here is shared for good.',
  },
  {
    them: 'Platform legacy features (Apple Legacy Contact, Google Inactive Account)',
    problem: 'One platform each, death-only, nothing for the six-week hospitalization in between.',
    // "you actually face … usually survivable" was R3's exposed phrase verbatim —
    // a prediction about the reader's own family, joined to "you". Third person now.
    relay: 'One vault across everything they use, built for the emergencies families actually face — which are usually survivable.',
  },
] as const;

export const TRUST_POINTS = [
  'Encrypted in your browser before it ever leaves — Relay servers only ever hold ciphertext.',
  'Releases require the trigger you chose — a missed check-in, an emergency you raise, or a caregiver situation — and people you named have to confirm it is real.',
  'Every open, grant, and release lands in a hash-chained audit log you can verify yourself.',
] as const;
