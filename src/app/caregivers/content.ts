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

/** Intent link with source attribution — a visit to CTA_HREF IS the G1 intent event. */
export function intentHref(src?: string): string {
  return src ? `${CTA_HREF}?src=${encodeURIComponent(src)}` : CTA_HREF;
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
