/**
 * The press boilerplate is checked against the product, like the ad copy was.
 *
 * A journalist quoting a stale price in a published article is the one version
 * of a drift bug that cannot be fixed with a commit. Three separate instances of
 * hand-copied facts going stale surfaced in this repo on 2026-08-16 alone; this
 * is the guard for the surface where the mistake is permanent.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

import { oneLine, boilerplate, authorLine, VERIFIABLE_FACTS, BRAND_ASSETS, PRESS_CONTACT } from '../g1/press-kit';
import { TIER_LIMITS } from '../billing/entitlements';
import { OPERATOR_NAME, CONTACT_EMAIL } from '../contact';
import { PRICE_YEARLY_USD } from '../../src/app/caregivers/content';

describe('the press boilerplate quotes the product, not a memory of it', () => {
  it('states the CURRENT price', () => {
    expect(boilerplate()).toContain(`$${PRICE_YEARLY_USD} a year`);
  });

  it('states the CURRENT free cap', () => {
    expect(boilerplate()).toContain(`${TIER_LIMITS.free.items} items`);
  });

  it('names the operator from the single definition', () => {
    expect(boilerplate()).toContain(OPERATOR_NAME);
    expect(authorLine()).toContain(OPERATOR_NAME);
  });

  it('routes press to the monitored address', () => {
    expect(PRESS_CONTACT).toBe(CONTACT_EMAIL);
  });
});

describe('the boilerplate says what the product actually does', () => {
  it('leads with reversibility — the one claim no rival makes', () => {
    // If a piece is going to quote one sentence, it must be the differentiating
    // one. "Seals itself" is the product; "stores passwords" is every rival.
    expect(oneLine().toLowerCase()).toMatch(/seals itself|closes again|checks back in/);
    expect(boilerplate().toLowerCase()).toMatch(/closes again|seals itself/);
  });

  it('does not promise estate handling, which the product refuses', () => {
    /*
      gates.g2-counsel-opinion.declined withdrew estate PERMANENTLY and
      src/app/terms/page.tsx says it is not offered. A press paragraph implying
      otherwise would be published, quoted onward, and impossible to retract —
      and it would advertise a capability the API answers 400 to.
    */
    const text = (oneLine() + ' ' + boilerplate() + ' ' + authorLine()).toLowerCase();
    for (const word of ['estate', 'inheritance', 'after death', 'when you die', 'legacy']) {
      expect(text, `press copy must not imply "${word}"`).not.toContain(word);
    }
  });

  it('makes no claim about employment — the anonymity rule binds bios too', () => {
    const text = (authorLine() + ' ' + boilerplate()).toLowerCase();
    for (const word of ['employer', 'works at', 'day job', 'consultant at']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('what an editor can verify without taking our word for it', () => {
  it('every verifiable fact says where to check it', () => {
    expect(VERIFIABLE_FACTS.length).toBeGreaterThan(0);
    for (const f of VERIFIABLE_FACTS) {
      expect(f.fact.trim().length, 'a fact with no statement').toBeGreaterThan(0);
      expect(f.where.trim().length, `"${f.fact}" has nowhere to check it`).toBeGreaterThan(0);
    }
  });

  it('every brand asset offered to an outlet actually exists on disk', () => {
    // Sending an editor a path to a file that is not there is the kind of small
    // unprofessionalism that costs a placement.
    const missing = BRAND_ASSETS.filter((p) => !existsSync(p));
    expect(missing, `press kit offers files that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});
