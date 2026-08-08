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

export const SUBHEAD =
  'When a parent lands in the hospital, you need their accounts NOW — and you need that ' +
  'access to end when the crisis does. Relay opens exactly what you were granted, and when ' +
  'they recover and check in, it seals itself again. No rival does the second half.';

export const CTA_LABEL = `Start your family's vault — $${PRICE_YEARLY_USD}/yr`;

export const CTA_HREF = '/caregivers/interest';

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
 * It does not split the gate. A visitor who converts through the product path
 * still lands on /caregivers/interest, so caregiver_intent still fires; the `cta`
 * dimension ('start') is what separates the two paths in analysis. One traffic
 * buy, two conversion routes, two readings.
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

/** True when a src counts toward the G1 gate ratio (tagged, and caregiver-targeted). */
export function isGateQualifyingSrc(src: string): boolean {
  const s = src.trim();
  if (!s || s === 'direct') return false;
  return !(SHOWCASE_SRCS as readonly string[]).includes(s);
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
    relay: 'Reversible by default. A recovery check-in closes emergency access automatically; only a verified estate handoff is permanent.',
  },
  {
    them: 'Platform legacy features (Apple Legacy Contact, Google Inactive Account)',
    problem: 'One platform each, death-only, nothing for the six-week hospitalization in between.',
    relay: 'One vault across everything they use, built for the emergencies you actually face — which are usually survivable.',
  },
] as const;

export const TRUST_POINTS = [
  'Encrypted in your browser before it ever leaves — Relay servers only ever hold ciphertext.',
  'Releases require the trigger you chose: a missed check-in, a manual emergency, or verified estate event — with trusted verifiers and a grace window.',
  'Every open, grant, and release lands in a hash-chained audit log you can verify yourself.',
] as const;
