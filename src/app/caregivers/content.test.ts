/**
 * G1 WTP instrument — pre-committed gate rules, enforced as tests.
 * Feature: relay-g1-wtp
 */
import { describe, expect, it } from 'vitest';

import {
  ANCHOR,
  WINNER_BADGE,
  SECONDARY_CTA_LABEL,
  SECONDARY_CTA_HREF,
  productHref,
  caregiversHref,
  CTA_HREF,
  CTA_LABEL,
  DIFFERENTIATORS,
  HEADLINE,
  intentHref,
  GATE_LANES,
  isGateQualifyingSrc,
  LANDING_HREF,
  PRICE_YEARLY_USD,
  QA_SRCS,
  SHOWCASE_SRCS,
  SUBHEAD,
  OG_DESCRIPTION,
  OG_TITLE,
  TRUST_POINTS,
} from './content';

describe('G1 caregiver WTP instrument', () => {
  it('prices AT or ABOVE the Everplans anchor — never below (COMPETITORS.md rule)', () => {
    expect(PRICE_YEARLY_USD).toBeGreaterThanOrEqual(ANCHOR.priceYearlyUsd);
  });

  it('the CTA shows the real price — WTP means the visitor saw the number before clicking', () => {
    expect(CTA_LABEL).toContain(`$${PRICE_YEARLY_USD}`);
  });

  it('leads with reversibility — the one capability no rival has', () => {
    const lead = (HEADLINE + ' ' + SUBHEAD).toLowerCase();
    expect(lead).toMatch(/closes itself|seals itself|reversib/);
  });

  it('intent event = a visit to the interest page, with source attribution preserved', () => {
    expect(intentHref()).toBe(CTA_HREF);
    expect(intentHref('reddit')).toBe(`${CTA_HREF}?src=reddit`);
    expect(intentHref('r/CaregiverSupport')).toBe(`${CTA_HREF}?src=r%2FCaregiverSupport`);
  });

  it('inbound landing links carry their channel tag', () => {
    expect(caregiversHref()).toBe(LANDING_HREF);
    expect(caregiversHref('h0-demo')).toBe(`${LANDING_HREF}?src=h0-demo`);
  });

  it('showcase traffic is tagged but EXCLUDED from the gate ratio', () => {
    // The gate counts caregiver-targeted sources only. H0-win traffic is neither
    // direct nor caregiver-targeted: it must not dilute N toward the <0.5% kill.
    for (const src of SHOWCASE_SRCS) {
      expect(isGateQualifyingSrc(src)).toBe(false);
    }
    expect(isGateQualifyingSrc('direct')).toBe(false);
    expect(isGateQualifyingSrc('')).toBe(false);
    // The declared paid lanes still qualify.
    expect(isGateQualifyingSrc('google-ads')).toBe(true);
    expect(isGateQualifyingSrc('meta-ads')).toBe(true);
  });

  it('QA traffic is EXCLUDED from the gate, so verifying the instrument cannot move it', () => {
    // docs/g1-ad-creatives.md makes "click your own live ad and confirm both events
    // carry src" a NON-OPTIONAL pre-flight step. Executed with a lane src it injects a
    // qualified + an intent at 100% conversion: a full point on a 2% ship line at N=100,
    // biasing toward the FALSE PASS that doc elsewhere calls the costlier error. And
    // unlike the caregiver_leads row, a Vercel Analytics event CANNOT be deleted.
    for (const src of QA_SRCS) {
      expect(isGateQualifyingSrc(src)).toBe(false);
    }
  });

  it('keeps QA and showcase exclusions distinct — they are excluded for different reasons', () => {
    // Showcase = real humans from a non-caregiver audience (read as a secondary segment).
    // QA = us. Merging them would let our own clicks be reported as audience signal.
    for (const src of QA_SRCS) {
      expect(SHOWCASE_SRCS as readonly string[]).not.toContain(src);
    }
  });

  /*
    docs/ad-assets/PROMPTS.md §6, Steve's 2026-08-12 scope ruling, pre-committed
    this exclusion and the condition that arms it:

      "⚠️ If a beta or founding-family campaign is ever revived, this becomes a
      pre-flight blocker again: every tagged non-excluded src counts toward N,
      free-signup conversions emit no priced numerator, and the ratio would be
      biased DOWN — toward a false KILL on the gate that decides the product. A
      Vercel Analytics event cannot be deleted, so the exclusion has to exist
      BEFORE the first such ad, not after."

    A beta recruit is being asked for the free plan, so they arrive in the
    denominator and can never appear in the priced numerator. Every one of them
    pushes the ratio toward the <0.5% kill on a gate whose whole question is
    whether caregivers will PAY.

    It is a PREFIX rather than a list because a list only works if whoever
    writes the next beta link guesses the same string this file guessed first,
    and being wrong is unrecoverable in exactly one direction. `beta-` is one
    rule, it cannot be defeated by an unforeseen suffix, and it reads plainly in
    a URL Steve is pasting into a message.
  */
  it('beta and founding-family traffic is EXCLUDED — it can never reach the priced numerator', () => {
    expect(isGateQualifyingSrc('beta')).toBe(false);
    expect(isGateQualifyingSrc('beta-founding')).toBe(false);
    expect(isGateQualifyingSrc('beta-reddit')).toBe(false);
    // The suffix is deliberately not enumerated anywhere — that is the point.
    expect(isGateQualifyingSrc('beta-a-tag-nobody-has-invented-yet')).toBe(false);
  });

  /*
    ⚠️ RATIFIED BY STEVE 2026-08-16 — N IS AN ALLOW-LIST.

    It was a deny-list, which counted anything tagged and unlisted: a newsletter,
    a launch post, a founding-family link, a src somebody invented on a Tuesday.
    None of those carries a priced numerator, so every one of them pushed the
    ratio toward the <0.5% that kills D2C — silently, because nobody notices a
    denominator that is slightly too big.

    The failure direction is the whole argument. Forget to declare a new lane
    under an allow-list and its traffic reads ZERO on day one of a flight, which
    is impossible to miss and is fixed by adding one string.

    Decided before traffic existed because there is no retroactive version:
    caregiver_leads rows can be deleted, Vercel Analytics events cannot.
  */
  it('only the declared paid lanes count toward N', () => {
    for (const lane of GATE_LANES) expect(isGateQualifyingSrc(lane)).toBe(true);

    // The cases the deny-list used to wave through. Each is a real thing
    // somebody could plausibly tag, and none was ever bought as caregiver reach.
    for (const stray of [
      'newsletter',
      'linkedin',
      'producthunt',
      'hn',
      'friend',
      'reddit-ads-beta', // a lane-shaped typo is NOT the lane
      'betamax-forum',
      'a-tag-somebody-invented-on-a-tuesday',
    ]) {
      expect(isGateQualifyingSrc(stray), `${stray} must not count toward N`).toBe(false);
    }
  });

  it('a lane can never also be an excluded value', () => {
    // The allow-list alone would happily count a QA or beta string pasted into
    // GATE_LANES. This is the second lock, and the reason the exclusion checks
    // are kept in the resolver rather than deleted as redundant.
    for (const lane of GATE_LANES) {
      expect(QA_SRCS as readonly string[], `${lane} is a QA value`).not.toContain(lane);
      expect(SHOWCASE_SRCS as readonly string[], `${lane} is a showcase value`).not.toContain(lane);
      expect(lane.startsWith('beta-'), `${lane} is a beta value`).toBe(false);
    }
  });

  it('the closed Reddit lane no longer counts', () => {
    /*
      Removed 2026-08-16, hours after the allow-list shipped the same day, and
      the first time this mechanism earned itself. Reddit sells no targeting:
      dementia/Alzheimers refused on ToS as health-condition targeting, and
      r/AgingParents, r/CaregiverSupport and r/eldercare absent from the index
      while r/personalfinance resolves in the same field. Keyword targeting
      failed its own pre-set threshold at 251.2m-314.1m under US-only scoping.

      An UNLAUNCHED draft still sits in the ad account. Under the deny-list this
      replaced, its traffic would have counted the instant anybody pressed the
      wrong button. This is the assertion that makes that impossible.
    */
    expect(isGateQualifyingSrc('reddit-ads')).toBe(false);
  });

  it('every declared lane is one somebody can actually buy', () => {
    // The lesson of the Reddit lane: a lane named in this list but unsellable on
    // the platform is a lane that reads as zero demand. Each entry here has a
    // channel behind it — google-ads (search intent, lane 1 from 2026-08-16),
    // meta-ads (lane 2, ratified, not yet built).
    expect(GATE_LANES).toEqual(['google-ads', 'meta-ads']);
  });

  it('names the real competitive frames, not strawmen', () => {
    const text = JSON.stringify(DIFFERENTIATORS);
    expect(text).toContain('Everplans');
    expect(text).toContain('Apple Legacy Contact');
  });
});

// ---------------------------------------------------------------------------
// Ad-policy compliance of the DESTINATION (added 2026-08-14).
//
// WHY THIS IS A TEST AND NOT A NOTE. `g1-ad-creatives.md` §1a rewrote four
// creatives after reading Meta's Personal Attributes standard from the source:
// the attribute is not the violation, the attribute joined to "you/your" is.
// That rewrite was applied to the ADS only, and the finding in
// `g1-flight-log.md` is that reviewers visit the destination — so the landing
// page carried the prohibited shape while every ad pointing at it was compliant.
//
// §1a states the rule in prose: "describe the situation in the third person and
// let the reader recognise themselves in it. Never join 'you/your' to a health
// event or a relative's condition." A rule with no test is how the ads were
// fixed and the page was not. This is that test.
//
// It is deliberately NARROW. Second person is fine everywhere else on this page
// and is used freely — "Encrypted in your browser", "the trigger you chose",
// "Start your family's vault". Only the JOIN to a medical condition or a named
// relative is refused, per the standard, which is why the two token sets are
// checked for co-occurrence inside one sentence rather than separately.
// ---------------------------------------------------------------------------

describe('landing copy is ad-policy compliant at the destination (§1a)', () => {
  /** Second person, in the forms this copy actually uses. */
  const SECOND_PERSON = /\b(you|your|yours|you['’]re|yourself)\b/i;

  /** Health / medical condition — Meta's protected personal attribute. */
  const CONDITION =
    /\b(hospital\w*|recover\w*|ill|illness|sick\w*|diagnos\w*|dementia|alzheimer\w*|stroke|surgery|medical|incapacit\w*|survivab\w*)\b/i;

  /**
   * A named relative. Lower risk than a condition — §1a calls "your parent's
   * accounts" its weakest case — but it is the second half of the prohibited
   * "knowledge of medical information of a user's family" shape, so it is held
   * to the same rule. "family" is deliberately NOT here: having a family is not
   * a protected attribute, and the priced CTA says "Start your family's vault".
   */
  const RELATIVE = /\b(parent|parents|mother|father|mum|mom|dad|spouse|grandparent)\b/i;

  /** Every string a reviewer or crawler reads on the destination. */
  const COPY: Array<[string, string]> = [
    ['HEADLINE', HEADLINE],
    ['SUBHEAD', SUBHEAD],
    ['OG_TITLE', OG_TITLE],
    ['OG_DESCRIPTION', OG_DESCRIPTION],
    ['CTA_LABEL', CTA_LABEL],
    ['SECONDARY_CTA_LABEL', SECONDARY_CTA_LABEL],
    ...TRUST_POINTS.map((t, i): [string, string] => [`TRUST_POINTS[${i}]`, t]),
    ...DIFFERENTIATORS.flatMap((d, i): Array<[string, string]> => [
      [`DIFFERENTIATORS[${i}].them`, d.them],
      [`DIFFERENTIATORS[${i}].problem`, d.problem],
      [`DIFFERENTIATORS[${i}].relay`, d.relay],
    ]),
  ];

  /** Sentence-level, because the standard is about the join, not the page. */
  const sentences = (s: string): string[] => s.split(/(?<=[.!?])\s+/).filter(Boolean);

  it.each(COPY)('%s never joins second person to a condition or a relative', (label, text) => {
    for (const sentence of sentences(text)) {
      const offends =
        SECOND_PERSON.test(sentence) && (CONDITION.test(sentence) || RELATIVE.test(sentence));
      expect(
        offends,
        `${label} — prohibited shape (§1a): "${sentence.trim()}"`,
      ).toBe(false);
    }
  });

  it('the guard can actually fail — the shape it refuses is the one that shipped', () => {
    // The exact SUBHEAD text as it stood until 2026-08-14. A guard that has never
    // been seen to fail proves nothing; this repo has found four of those.
    const shipped = 'When a parent lands in the hospital, you need their accounts NOW.';
    expect(SECOND_PERSON.test(shipped) && CONDITION.test(shipped)).toBe(true);
  });

  it('still leads with reversibility after the rewrite — the positioning is unchanged', () => {
    expect(`${HEADLINE} ${SUBHEAD}`.toLowerCase()).toMatch(/closes itself|seals itself|reversib/);
    expect(SUBHEAD).toContain('No rival does the second half');
  });
});

// ---------------------------------------------------------------------------
// Secondary product lane (added 2026-08-07, "run both").
//
// The risk this guards: the product path costs a signup, a TOTP enrolment and a
// seed before the price appears, so it will almost certainly convert worse in
// raw click-to-intent than a mailto. If it CANNIBALISES primary-CTA clicks, the
// blended ratio falls and a real audience could trip the <0.5% KILL threshold
// on an artefact of our own funnel design. The mitigations are structural:
// the secondary CTA is visually subordinate, and analysis reads BOTH ratios.
// ---------------------------------------------------------------------------

describe('G1 secondary product lane', () => {
  it('shows the H0 win — distribution ammunition per the disposition plan', () => {
    expect(WINNER_BADGE).toMatch(/Most Impactful/i);
  });

  it('the secondary CTA does NOT show a price — the priced CTA stays the primary one', () => {
    expect(SECONDARY_CTA_LABEL).not.toMatch(/\$\d/);
  });

  it('the secondary CTA is subordinate in wording, not a competing headline offer', () => {
    // "Or ..." keeps it clearly secondary to the priced CTA above it.
    expect(SECONDARY_CTA_LABEL.trim().toLowerCase().startsWith('or ')).toBe(true);
  });

  it('the secondary CTA opens SIGNUP, not the intent page — it must not inflate the numerator', () => {
    expect(SECONDARY_CTA_HREF).toBe('/auth/signup');
    expect(SECONDARY_CTA_HREF).not.toContain('interest');
  });

  it('the product link carries its channel tag so attribution survives into /start', () => {
    expect(productHref('hero-product')).toBe('/auth/signup?src=hero-product');
    expect(productHref()).toBe('/auth/signup');
  });

  it('product-lane traffic is still a qualified visitor — it lands on the same landing page', () => {
    // The denominator is unchanged: caregiver_qualified fires on /caregivers for
    // every tagged visitor from a declared lane, whichever CTA they take next.
    expect(isGateQualifyingSrc('google-ads')).toBe(true);
  });
});
