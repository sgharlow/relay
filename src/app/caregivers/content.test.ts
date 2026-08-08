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
  isGateQualifyingSrc,
  LANDING_HREF,
  PRICE_YEARLY_USD,
  SHOWCASE_SRCS,
  SUBHEAD,
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
    // Real caregiver channels still qualify.
    expect(isGateQualifyingSrc('reddit-ads')).toBe(true);
    expect(isGateQualifyingSrc('meta-ads')).toBe(true);
  });

  it('names the real competitive frames, not strawmen', () => {
    const text = JSON.stringify(DIFFERENTIATORS);
    expect(text).toContain('Everplans');
    expect(text).toContain('Apple Legacy Contact');
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
    // every tagged visitor, whichever CTA they subsequently take.
    expect(isGateQualifyingSrc('reddit-ads')).toBe(true);
  });
});
