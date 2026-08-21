/**
 * The one failure that goes to the waitlist, and the ones that must not.
 *
 * 🔴 THE DEFECT THIS PINS. `PriceCard` returned null on any non-OK response and
 * `completeLaneBIntent` turns null into `/caregivers/interest?src=start` — so a
 * rate-limited press, a transient 500 or a dropped connection sent a signed-in
 * owner to a marketing page offering them signup and a waitlist. The component's
 * own comment says that is the thing to avoid; only the 503 case it was written
 * for was ever meant to land there.
 *
 * Tested here rather than through the component because vitest runs
 * `environment: 'node'` — there is no DOM and no testing-library in this repo,
 * so a decision left inside a click handler is a decision no test can reach.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J12-R1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  classifyCheckoutFailure,
  shouldFallBackToInterestPage,
  type CheckoutFailureKind,
} from './checkout-outcome';

describe('classifyCheckoutFailure', () => {
  it('treats 503 as "billing is not configured"', () => {
    expect(classifyCheckoutFailure(503).kind).toBe('unconfigured');
  });

  it('treats 409 as "you are already a customer" and points at the account page', () => {
    const f = classifyCheckoutFailure(409);
    expect(f.kind).toBe('already-subscribed');
    expect(f.href).toBe('/account');
    expect(f.retryable).toBe(false);
  });

  it('treats 429 as transient — waiting is the fix, so retry is offered', () => {
    const f = classifyCheckoutFailure(429);
    expect(f.kind).toBe('busy');
    expect(f.retryable).toBe(true);
  });

  it.each([500, 502, 504, 400, 200])('treats %i as a plain failure worth retrying', (status) => {
    const f = classifyCheckoutFailure(status);
    expect(f.kind).toBe('failed');
    expect(f.retryable).toBe(true);
  });

  /*
    A NETWORK FAILURE HAS NO STATUS, and folding it into `unconfigured` would be
    the original bug in a new place: an unreachable server would tell somebody
    the product has no billing.
  */
  it('treats a thrown request (no status at all) as retryable, not as unconfigured', () => {
    const f = classifyCheckoutFailure(null);
    expect(f.kind).toBe('failed');
    expect(f.retryable).toBe(true);
  });

  it('says the owner has not been charged, on the failure they will actually see', () => {
    // The first thing somebody needs after an error on a payment button is that
    // no money moved. Only then does "try again" mean anything.
    expect(classifyCheckoutFailure(500).message).toMatch(/not been charged/i);
  });

  it('never tells a paying owner to buy anything', () => {
    const f = classifyCheckoutFailure(409);
    expect(f.message).not.toMatch(/sign ?up|\$|waitlist|invite/i);
  });
});

describe('shouldFallBackToInterestPage', () => {
  it('is true for the unconfigured case the fallback was written for', () => {
    expect(shouldFallBackToInterestPage(classifyCheckoutFailure(503))).toBe(true);
  });

  it.each<[number | null, CheckoutFailureKind]>([
    [409, 'already-subscribed'],
    [429, 'busy'],
    [500, 'failed'],
    [null, 'failed'],
  ])('is false for %s, so a signed-in owner is not shown a waitlist', (status, kind) => {
    const f = classifyCheckoutFailure(status);
    expect(f.kind).toBe(kind);
    expect(shouldFallBackToInterestPage(f)).toBe(false);
  });
});

/**
 * The component actually asks — asserted on the source, not on the module.
 *
 * This repository's most-repeated defect is a control that exists in a helper
 * while the caller does not use it. Every test above would stay green if
 * `PriceCard` went back to `if (!res.ok) return null` and navigated to whatever
 * `completeLaneBIntent` handed back.
 *
 * Source-level because there is no DOM here to press the button in. Recorded as
 * the weaker half deliberately: this proves the call exists, and only a walk
 * through the real page proves what an owner sees.
 */
describe('PriceCard consults the classification', () => {
  const card = readFileSync('src/app/(owner)/start/PriceCard.tsx', 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );

  it('imports the decision rather than re-deciding inline', () => {
    expect(card).toContain('classifyCheckoutFailure');
    expect(card).toContain('shouldFallBackToInterestPage');
  });

  it('captures the response status, which the old code discarded', () => {
    // `if (!res.ok) return null` threw away the one fact that separates the
    // 503 case from every other failure.
    expect(card).toMatch(/res\.status/);
  });

  it('renders the failure message on the page instead of only navigating away', () => {
    expect(card).toMatch(/failure[.?]?\.?message|failure\.message/);
  });
});
