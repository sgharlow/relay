/**
 * Tests for the prompted caregiver seed.
 *
 * A blank vault is not a first-run experience, and the seed must fit inside the
 * free tier or the reveal it exists to produce cannot be reached (J1-R4).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4
 */

import { describe, it, expect } from 'vitest';
import { CAREGIVER_CHECKLIST } from './caregiver-checklist';
import { TIER_LIMITS } from '../billing/entitlements';

const CATEGORIES = [
  'finance',
  'health',
  'government',
  'utilities',
  'communication',
  'professional',
  'personal',
  'other',
];

describe('CAREGIVER_CHECKLIST', () => {
  it('is 8 entries — enough for real dependency edges', () => {
    expect(CAREGIVER_CHECKLIST).toHaveLength(8);
  });

  it('fits inside the free tier with headroom', () => {
    expect(CAREGIVER_CHECKLIST.length).toBeLessThan(TIER_LIMITS.free.items);
  });

  it('has unique ids', () => {
    const ids = CAREGIVER_CHECKLIST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only categories the vault schema accepts', () => {
    for (const entry of CAREGIVER_CHECKLIST) {
      expect(CATEGORIES).toContain(entry.category);
    }
  });

  it('leads with the accounts a caregiver needs first', () => {
    expect(CAREGIVER_CHECKLIST[0].id).toBe('primary-email');
    expect(CAREGIVER_CHECKLIST[1].id).toBe('phone-carrier');
  });

  it('marks the credentials everything else resets through', () => {
    const roots = CAREGIVER_CHECKLIST.filter((e) => e.suggestedRoot).map((e) => e.id);

    expect(roots).toContain('primary-email');
    expect(roots).toContain('phone-carrier');
    expect(roots.length).toBeGreaterThanOrEqual(2);
  });

  it('gives every entry a label and a plain-language hint', () => {
    for (const entry of CAREGIVER_CHECKLIST) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.hint.length).toBeGreaterThan(0);
      expect(entry.label).not.toMatch(/TODO|TBD/i);
    }
  });

  it('covers the money, health and communication surfaces a caregiver hits', () => {
    const cats = new Set(CAREGIVER_CHECKLIST.map((e) => e.category));

    expect(cats).toContain('finance');
    expect(cats).toContain('health');
    expect(cats).toContain('communication');
  });
});
