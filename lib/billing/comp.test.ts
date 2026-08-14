/**
 * A comped plan must never be countable as revenue.
 *
 * 🔴 THE FAILURE THIS PREVENTS IS SILENT AND MONTHS LATER. This portfolio's
 * central discipline is arms-length revenue evidence: PROJECT.yaml records
 * `wtp_evidence: none` and explicitly treats the one self-purchased
 * subscription as advancing nothing. A founding family granted the paid tier by
 * hand writes a row that is structurally identical to a customer's — same
 * table, same tier, same active status. Counted once, it corrupts the single
 * number the G1 gate rests on, in a report nobody re-derives.
 *
 * So the marker is pinned here rather than trusted to whoever next writes a
 * revenue query.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { COMP_COHORT, isComped } from './entitlements';

describe('a granted plan is distinguishable from a bought one', () => {
  it('recognises the two markers a comp always carries', () => {
    expect(isComped({ cohort: COMP_COHORT, price_cents: 0 })).toBe(true);
  });

  it('recognises a comp by EITHER marker, so one being lost is not enough to hide it', () => {
    expect(isComped({ cohort: COMP_COHORT, price_cents: 11900 })).toBe(true);
    expect(isComped({ cohort: null, price_cents: 0 })).toBe(true);
  });

  it('does not mistake a real subscriber for a comp', () => {
    expect(isComped({ cohort: null, price_cents: 11900 })).toBe(false);
    // A G1 price-test cohort is not a comp — those people paid.
    expect(isComped({ cohort: 'g1-price-a', price_cents: 11900 })).toBe(false);
  });

  it('COMP_COHORT is spelled once in the codebase, not typed twice', () => {
    // Two spellings of this marker is exactly how the corruption happens: one
    // query excludes 'founding-comp', another checks 'founding_comp', and a
    // comped family quietly becomes revenue.
    const script = readFileSync('scripts/grant-founding-tier.ts', 'utf8');
    expect(script).toContain('COMP_COHORT');
    expect(script).not.toMatch(/'founding-comp'|"founding-comp"/);
  });

  /*
    The grant script must refuse a row carrying Stripe identifiers. Overwriting
    a real subscriber would lose their billing linkage AND delete the evidence
    the gate is waiting for — the two worst outcomes available to this script.
  */
  it('the grant script refuses to overwrite a paying customer', () => {
    const script = readFileSync('scripts/grant-founding-tier.ts', 'utf8');
    expect(script).toContain('stripe_subscription_id');
    expect(script).toMatch(/Refusing to overwrite a paying/i);
  });
});
