/**
 * The Google lane, measured rather than eyeballed.
 *
 * `docs/g1-ad-creatives.md` §1b exists because "the ads do not fit the fields as
 * drafted" — every Meta headline in the first draft overflowed, discovered
 * mid-sitting with the card already on file. Google truncates a 31-character
 * headline mid-word and serves it anyway, so the failure is invisible from
 * inside the account.
 *
 * This is the sibling of `ad-copy.test.ts` for the lane that replaced Reddit.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';

import {
  GOOGLE_LIMITS,
  FINAL_URL,
  DISPLAY_PATH,
  HEADLINES,
  DESCRIPTIONS,
  KEYWORD_THEMES,
  NEGATIVE_KEYWORDS,
  CAMPAIGN_SETTINGS,
  pricedDescription,
  freePlanHeadline,
} from '../g1/google-lane';
import { PRICE_YEARLY_USD, isGateQualifyingSrc } from '../../src/app/caregivers/content';
import { TIER_LIMITS } from '../billing/entitlements';

describe('the ads fit the fields Google actually gives us', () => {
  it('every headline is inside 30 characters', () => {
    const over = HEADLINES.filter((h) => h.length > GOOGLE_LIMITS.headlineChars).map(
      (h) => `"${h}" (${h.length})`,
    );
    expect(over, `Google truncates mid-word and serves it anyway: ${over.join(', ')}`).toEqual([]);
  });

  it('every description is inside 90 characters', () => {
    const over = DESCRIPTIONS.filter((d) => d.length > GOOGLE_LIMITS.descriptionChars).map(
      (d) => `"${d}" (${d.length})`,
    );
    expect(over, `over 90 characters: ${over.join(', ')}`).toEqual([]);
  });

  it('the composed price description still fits at the CURRENT price', () => {
    // Composed from PRICE_YEARLY_USD rather than typed, so a price change cannot
    // leave a stale number in a live ad — but a longer price could overflow the
    // field, so the composition is measured too.
    const d = pricedDescription(PRICE_YEARLY_USD);
    expect(d).toContain(`$${PRICE_YEARLY_USD}`);
    expect(d.length, `"${d}" is ${d.length} chars`).toBeLessThanOrEqual(GOOGLE_LIMITS.descriptionChars);
  });

  it('the composed free-plan headline still fits at the CURRENT cap', () => {
    const h = freePlanHeadline(TIER_LIMITS.free.items);
    expect(h).toContain(String(TIER_LIMITS.free.items));
    expect(h.length, `"${h}" is ${h.length} chars`).toBeLessThanOrEqual(GOOGLE_LIMITS.headlineChars);
  });

  it('supplies enough headlines and descriptions for Google to accept the ad', () => {
    // +1 on each side for the composed ones, which are not in the arrays.
    expect(HEADLINES.length + 1).toBeGreaterThanOrEqual(GOOGLE_LIMITS.minHeadlines);
    expect(HEADLINES.length + 1).toBeLessThanOrEqual(GOOGLE_LIMITS.maxHeadlines);
    expect(DESCRIPTIONS.length + 1).toBeGreaterThanOrEqual(GOOGLE_LIMITS.minDescriptions);
    expect(DESCRIPTIONS.length + 1).toBeLessThanOrEqual(GOOGLE_LIMITS.maxDescriptions);
  });

  it('both display path segments fit', () => {
    for (const seg of DISPLAY_PATH) {
      expect(seg.length, `"${seg}"`).toBeLessThanOrEqual(GOOGLE_LIMITS.displayPathChars);
    }
  });

  it('no headline is a duplicate — Google rejects the ad, and it wastes a slot', () => {
    expect(new Set(HEADLINES).size).toBe(HEADLINES.length);
  });
});

describe('the destination carries the measurement', () => {
  it('the final URL still carries a src — but the lane is RETIRED, so it counts nothing', () => {
    /*
      ⛔ CHANGED 2026-08-16 when paid advertising was retired
      (ratified.retire-paid-advertising). This assertion used to read "a src that
      the gate actually counts", and flipping it is the honest edit rather than
      deleting the test.

      The URL is still well-formed and still tagged — that part of the plan was
      correct and is worth keeping pinned, because reviving this lane means adding
      one string to GATE_LANES and the URL must already be right when that happens.
      What changed is that `google-ads` is no longer a declared lane, so the src
      resolves to "counts toward nothing". Both halves are asserted so a future
      revival has to move BOTH deliberately.
    */
    const src = new URL(FINAL_URL).searchParams.get('src');
    expect(src, `no src on ${FINAL_URL}`).toBe('google-ads');
    expect(
      isGateQualifyingSrc(src as string),
      'google-ads is retired; if this is true again the lane was revived — check that was intended',
    ).toBe(false);
  });

  it('points at the landing page, not the interest page', () => {
    // /caregivers/interest is the NUMERATOR. Sending paid traffic straight there
    // would emit caregiver_intent for every click and report ~100% conversion.
    expect(new URL(FINAL_URL).pathname).toBe('/caregivers');
    expect(FINAL_URL).not.toContain('/interest');
  });

  it('is https and on the live custom domain', () => {
    expect(FINAL_URL.startsWith('https://relaystandby.com/')).toBe(true);
  });
});

describe('the negative list protects what the product decided not to sell', () => {
  it('excludes estate, which the product withdrew permanently', () => {
    /*
      gates.g2-counsel-opinion.declined (2026-08-14): estate is "narrowed OUT of
      the product PERMANENTLY rather than held pending an opinion", enforced in
      USER_SELECTABLE_TRIGGER_TYPES, and src/app/terms/page.tsx says it is not
      offered. Buying a click from somebody searching probate pays to send a
      person to a page that refuses them, AND pollutes the denominator with
      demand this product has decided not to serve.
    */
    for (const term of ['estate', 'probate', 'inheritance', 'deceased', 'executor']) {
      expect(NEGATIVE_KEYWORDS as readonly string[], `"${term}" must be negative`).toContain(term);
    }
  });

  it('excludes break-in intent, which no ad can tell apart from a devoted daughter', () => {
    for (const term of ['hack', 'bypass', 'steal', 'without permission']) {
      expect(NEGATIVE_KEYWORDS as readonly string[], `"${term}" must be negative`).toContain(term);
    }
  });

  it('excludes job seekers — caregiving is an occupation as well as a family role', () => {
    for (const term of ['jobs', 'hiring', 'salary', 'career']) {
      expect(NEGATIVE_KEYWORDS as readonly string[], `"${term}" must be negative`).toContain(term);
    }
  });

  it('no negative keyword cancels a keyword we are paying for', () => {
    // A negative that appears inside a targeted phrase silently suppresses the
    // whole theme. This is the check that would have caught "free" if the free
    // plan had ever been the hook.
    const targeted = KEYWORD_THEMES.flatMap((t) => t.keywords).join(' ').toLowerCase();
    const collisions = NEGATIVE_KEYWORDS.filter((n) => targeted.includes(n.toLowerCase()));
    expect(
      collisions,
      `these negatives appear inside keywords we are bidding on, which suppresses them: ${collisions.join(', ')}`,
    ).toEqual([]);
  });
});

describe('the campaign settings that are not defaults', () => {
  it('uses no audience segment — health restrictions, and it would change the measurement', () => {
    /*
      Read from the primary source 2026-08-16 (adspolicy/answer/16701855): the
      health sensitive-category rules restrict advertiser-curated audiences,
      customer match, data segments, audience expansion and lookalikes. They do
      NOT restrict Search keyword targeting, which is the whole reason this lane
      is viable where Reddit was not. Attaching an audience would re-enter the
      restricted surface and stop the keyword being what is measured.
    */
    expect(CAMPAIGN_SETTINGS.audienceSegments).toMatch(/none/i);
  });

  it('keeps Search Partners and the Display Network off', () => {
    // Both are on by default and neither is search intent. Display in particular
    // buys impressions from people who typed nothing at all.
    expect(CAMPAIGN_SETTINGS.searchPartners).toBe(false);
    expect(CAMPAIGN_SETTINGS.displayNetwork).toBe(false);
  });

  it('caps the bid — there is no conversion signal to bid against', () => {
    // Nothing in this account tracks conversions, so every conversion-based
    // strategy is unusable and "maximize clicks" without a cap is unbounded CPC.
    expect(CAMPAIGN_SETTINGS.bidding).toMatch(/maximum CPC bid limit/i);
  });

  it('targets presence, not interest — "interest in the US" includes the whole world', () => {
    expect(CAMPAIGN_SETTINGS.locations).toMatch(/Presence/);
    expect(CAMPAIGN_SETTINGS.locations).toMatch(/NOT "interest in"/);
  });

  it('uses phrase or exact match only — never broad', () => {
    /*
      Broad match with no conversion signal widens to whatever Google guesses is
      related, and every widened click still enters the denominator tagged
      google-ads. On a gate that kills below 0.5%, paying to widen the
      denominator is paying to kill the product.
    */
    for (const { keywords } of KEYWORD_THEMES) {
      for (const k of keywords) {
        const phrase = k.startsWith('"') && k.endsWith('"');
        const exact = k.startsWith('[') && k.endsWith(']');
        expect(phrase || exact, `${k} is broad match`).toBe(true);
      }
    }
  });
});
