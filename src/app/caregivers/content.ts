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

/*
  Re-exported, not redeclared. The definition moved to `lib/offer.ts` on
  2026-08-15 — the file that already said "The commercial offer, in one place" —
  because this number had been written down in nine places, one of them a SQL
  literal in the Stripe webhook. Every existing `import { PRICE_YEARLY_USD }
  from '.../content'` keeps working; there is simply only one number now.
*/
import { PRICE_YEARLY_USD } from '../../../lib/offer';

export { PRICE_YEARLY_USD };

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

/**
 * BETA AND FOUNDING-FAMILY traffic — recruited, and recruited to the FREE plan.
 *
 * `docs/ad-assets/PROMPTS.md` §6 (Steve's 2026-08-12 scope ruling) pre-committed this and
 * named the condition that arms it: "If a beta or founding-family campaign is ever
 * revived, this becomes a pre-flight blocker again: every tagged non-excluded `src` counts
 * toward N, free-signup conversions emit no priced numerator, and the ratio would be
 * biased **down** — toward a false KILL on the gate that decides the product."
 *
 * The asymmetry is what makes it worth a rule rather than a note. Somebody invited into the
 * beta lands in the denominator and can never appear in the priced numerator, because they
 * were not asked to pay. So this traffic does not merely dilute N, it moves the ratio in
 * one direction only — toward the <0.5% that kills D2C.
 *
 * A PREFIX, not a list, and that is the whole design. A list works only if whoever composes
 * the next beta link guesses the string this file guessed first, and the cost of guessing
 * wrong is not recoverable: a `caregiver_leads` row can be deleted, a Vercel Analytics event
 * cannot. `beta-` holds for tags nobody has invented yet. It is anchored at the start, so a
 * real lane is never swallowed by it — `reddit-ads-beta` still counts.
 *
 * ⚠️ THIS ONLY WORKS IF BETA LINKS CARRY IT. The convention is stated where such a link is
 * actually composed — `docs/first-invitations.md` — because a rule that lives only in a test
 * is a rule the person pasting a URL into a text message will never meet.
 */
export const BETA_SRC_PREFIX = 'beta-';

/** Sources that are tagged but must never reach the gate ratio, for any reason. */
const NON_QUALIFYING_SRCS: readonly string[] = [...SHOWCASE_SRCS, ...QA_SRCS, 'beta'];

/**
 * THE DECLARED PAID LANES — the only sources that count toward N.
 *
 * ⚠️ RATIFIED BY STEVE 2026-08-16: this is an ALLOW-LIST, and it replaced a
 * deny-list. Recorded in `PROJECT.yaml` `ratified.g1-n-is-an-allow-list`.
 *
 * The deny-list counted anything tagged and unlisted, which meant the gate that
 * decides this product's future treated *any* labelled visitor as caregiver
 * demand — a newsletter, a launch post, a founding-family link, a src somebody
 * invented on a Tuesday. All of them arrive without a priced numerator behind
 * them, so they pushed the ratio one way only: toward the `<0.5%` that kills
 * D2C.
 *
 * The decisive argument is the DIRECTION OF THE FAILURE, not tidiness.
 *
 *   - A deny-list fails SILENTLY. Nobody notices a denominator that is slightly
 *     too big; the ratio just reads worse than the truth, and the verdict is
 *     written from it.
 *   - An allow-list fails LOUDLY. Forget to declare a new lane and its traffic
 *     reads zero, which is impossible to miss on the first day of a flight and
 *     is fixed by adding one string.
 *
 * And it had to be decided before traffic existed: `caregiver_leads` rows can be
 * deleted, Vercel Analytics events cannot. There is no retroactive version of
 * this change.
 *
 * ADDING A LANE IS DELIBERATE. Put the src here in the same commit that creates
 * the ad carrying it, and it must not collide with any exclusion set above —
 * `content.test.ts` asserts that intersection is empty, so a lane that is also
 * a QA or showcase value fails the build rather than quietly counting us.
 *
 * ⚠️ `reddit-ads` WAS HERE AND WAS REMOVED 2026-08-16, the same day the
 * allow-list shipped — which is the first time this mechanism did the job it
 * was built for. Reddit sells no caregiver targeting: `dementia` and
 * `Alzheimers` are refused on ToS as health-condition targeting, and
 * r/AgingParents, r/CaregiverSupport and r/eldercare are simply absent from the
 * targetable index while r/personalfinance resolves instantly in the same
 * field. Keyword targeting was tested as the fallback and returned an audience
 * estimate of 251.2m–314.1m under US-only scoping, failing a threshold set
 * before the number was seen. Evidence table: `docs/g1-ad-creatives.md`.
 *
 * The lane is closed, but an UNLAUNCHED campaign draft still exists in the ad
 * account. Under a deny-list its traffic would have counted the moment anybody
 * pressed the wrong button; removing the string is what makes that impossible
 * rather than merely unlikely.
 */
export const GATE_LANES = ['google-ads', 'meta-ads'] as const;

/**
 * True when a src counts toward the G1 gate ratio.
 *
 * The exclusion checks run FIRST and are now, strictly speaking, redundant —
 * nothing in them appears in `GATE_LANES`. They are kept because they are the
 * only place the reasoning lives, and because they are a second lock on the one
 * mistake that cannot be undone: if a beta tag or a QA value were ever pasted
 * into `GATE_LANES`, the allow-list alone would happily count it.
 */
export function isGateQualifyingSrc(src: string): boolean {
  const s = src.trim();
  if (!s || s === 'direct') return false;
  if (s.startsWith(BETA_SRC_PREFIX)) return false;
  if (NON_QUALIFYING_SRCS.includes(s)) return false;
  return (GATE_LANES as readonly string[]).includes(s);
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
