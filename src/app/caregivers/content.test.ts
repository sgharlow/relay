/**
 * G1 WTP instrument — pre-committed gate rules, enforced as tests.
 * Feature: relay-g1-wtp
 */
import { describe, expect, it } from 'vitest';

import {
  ANCHOR,
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
