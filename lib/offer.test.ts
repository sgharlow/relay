/**
 * The commercial offer, enforced as tests.
 *
 * Ratified by Steve 2026-08-09: a 30-day money-back guarantee, and after that
 * no refund of the unused part of a year. This replaced a no-refund-by-default
 * stance that had been authored but never confirmed.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { CONTACT_EMAIL } from './contact';
import { GUARANTEE_LABEL, REFUND_POLICY, REFUND_WINDOW_DAYS } from './offer';

describe('the refund offer', () => {
  it('states one window, everywhere the window is stated', () => {
    // The sales badge and the legal text are read by the same person minutes
    // apart. Two numbers here is a trust product contradicting itself.
    expect(GUARANTEE_LABEL).toContain(String(REFUND_WINDOW_DAYS));
    expect(REFUND_POLICY).toContain(String(REFUND_WINDOW_DAYS));
  });

  it('tells the customer how to actually get the money back', () => {
    // Cancelling in Stripe's hosted portal stops future charges; it does not
    // refund a charge already taken, and nothing in this codebase issues one.
    // A guarantee that points only at the cancel button is a promise the
    // product cannot keep.
    expect(REFUND_POLICY).toContain(CONTACT_EMAIL);
  });

  it('promises the money back, not merely a cancellation', () => {
    expect(REFUND_POLICY.toLowerCase()).toMatch(/refund/);
    expect(GUARANTEE_LABEL.toLowerCase()).toMatch(/money back|money-back|refund/);
  });

  it('keeps the statutory carve-out — a policy cannot remove a legal right', () => {
    expect(REFUND_POLICY.toLowerCase()).toMatch(/law|statutory|legal right/);
  });

  it('is a real window rather than a nominal one', () => {
    expect(REFUND_WINDOW_DAYS).toBeGreaterThanOrEqual(14);
  });
});
