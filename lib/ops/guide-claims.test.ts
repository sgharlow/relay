/**
 * The printed guide states facts about the product. They have to still be true.
 *
 * 🔴 BOTH CLAIMS PINNED HERE WERE WRONG WHEN FOUND, 2026-08-14.
 *
 * The guide said the free plan holds "ten items and four people". The code
 * allows four recipients AND four verifiers — separate caps, up to eight people
 * — so an owner reading the guide could conclude that naming somebody to
 * confirm an emergency would cost them a place for somebody to receive access.
 * That is the exact trade-off the beta cap was raised to avoid, and believing it
 * leads to the one configuration this product cannot help with: a release with
 * nobody able to confirm it.
 *
 * The guide also said the permanent handover "waits on a written legal opinion;
 * when it does arrive it will not let you mark it reversible". No opinion is
 * coming — `gates.g2-counsel-opinion` is DECLINED and `journeys.J10` is
 * `withdrawn`. The guide is the document written for the non-technical half of
 * the audience, and it was the last surface still promising a feature that had
 * been permanently withdrawn.
 *
 * WHY A TEST AND NOT A PROOFREAD. This is the volatile-numbers rule: a fact
 * stated in two places drifts, and the guide is a static HTML file with nothing
 * connecting it to the constants it describes. Nobody re-reads a 1,200-line
 * document when they change a number in entitlements.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { TIER_LIMITS } from '../billing/entitlements';

const guide = readFileSync('public/guide/index.html', 'utf8');

describe('the guide describes the free plan the code actually enforces', () => {
  it('states the item cap that TIER_LIMITS holds', () => {
    // Written as a word in the prose, which is why this maps rather than greps.
    const words: Record<number, string> = { 10: 'ten', 4: 'four', 3: 'three', 5: 'five' };
    const items = TIER_LIMITS.free.items;
    expect(guide).toContain(`${words[items] ?? items} items`);
  });

  it('does not collapse the two people-caps into a single number', () => {
    // "four people" was the wrong shape even when four was arithmetically
    // involved: recipients and verifiers are separate allowances.
    expect(TIER_LIMITS.free.recipients).toBe(4);
    expect(TIER_LIMITS.free.verifiers).toBe(4);
    expect(guide).not.toMatch(/holds ten items and four people/);
    expect(guide).toMatch(/four people who can receive access/);
    expect(guide).toMatch(/four\s+who can confirm an emergency/);
  });
});

describe('the guide does not promise the withdrawn handover', () => {
  /*
    Estate is refused at the trust boundary — POST /api/rules with
    trigger_type: estate answers 400 — so any sentence implying it is coming
    describes a product that does not exist and will not.
  */
  it('says nothing about waiting on a legal opinion', () => {
    expect(guide).not.toMatch(/legal opinion/i);
    expect(guide).not.toMatch(/when it does arrive/i);
  });

  it('states the limitation the way the Terms and Security pages state it', () => {
    // One wording across surfaces: a family must not get a firmer promise in
    // the printed guide than in the Terms.
    expect(guide).toMatch(/does not offer/i);
    expect(guide).toMatch(/estate or inheritance/i);
  });
});
