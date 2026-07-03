/**
 * G1 WTP instrument — pre-committed gate rules, enforced as tests.
 * Feature: relay-g1-wtp
 */
import { describe, expect, it } from 'vitest';

import {
  ANCHOR,
  CTA_HREF,
  CTA_LABEL,
  DIFFERENTIATORS,
  HEADLINE,
  intentHref,
  PRICE_YEARLY_USD,
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

  it('names the real competitive frames, not strawmen', () => {
    const text = JSON.stringify(DIFFERENTIATORS);
    expect(text).toContain('Everplans');
    expect(text).toContain('Apple Legacy Contact');
  });
});
