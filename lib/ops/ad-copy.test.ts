/**
 * The ad creatives are checked against the product, and against themselves.
 *
 * WHY. `docs/g1-ad-creatives.md` holds the exact copy that will be pasted into
 * Reddit and Meta for a four-week flight against a ratified $250. Two things in
 * it are load-bearing and neither was checked by anything:
 *
 *   1. **The stated character counts.** §1b exists because "the ads do not fit
 *      the fields as drafted" — every Meta headline and description in the
 *      original draft overflowed, and it says so plainly: "Two mechanical
 *      problems that would have been discovered mid-sitting, with the card
 *      already on file." The rewrite states a count beside each field "so a
 *      later edit can be checked without re-deriving it". That is a promise
 *      about a number in prose, and prose drifts — the portfolio rule about
 *      volatile numbers is exactly this shape. An overflow is not a soft
 *      failure: Meta truncates at 40 characters mid-word, and the ad still runs.
 *
 *   2. **The price.** `$119/yr` is written into the Meta headline and the R1
 *      body, while the product's price lives in `PRICE_YEARLY_USD`. The image
 *      rules in the same document already forbid baking a price into a PNG, for
 *      a reason that applies verbatim to copy: "A number baked into a PNG is a
 *      second definition of a contract that must have exactly one — and it
 *      silently goes stale." A running ad quoting a price the product no longer
 *      charges is a claim problem, not a typo, and it is discovered by a
 *      customer.
 *
 * This is the sibling of `readme-claims` and `guide-claims`: a document that
 * makes checkable claims about the product gets a test that checks them.
 *
 * ⚠️ IT DELIBERATELY DOES NOT CHECK THE PROSE. Claim discipline (§1a, the
 * third-person rule) is a judgement about meaning and belongs to a human
 * reading it. What is asserted here is only what can be decided mechanically:
 * lengths, limits, and whether two numbers agree.
 *
 * Feature: relay-h0-mvp (G1)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { PRICE_YEARLY_USD } from '../../src/app/caregivers/content';
import { GUARANTEE_LABEL } from '../offer';

const DOC = 'docs/g1-ad-creatives.md';
const md = readFileSync(DOC, 'utf8');
const lines = md.split(/\r?\n/);

/** Platform limits, from §1b of the document itself. */
const META_HEADLINE_MAX = 40;
const META_DESCRIPTION_MAX = 25;
const REDDIT_TITLE_MAX = 300;
const REDDIT_TITLE_MOBILE_GUIDANCE = 80;
const BRAND_NAME_MAX = 25;

interface Field {
  label: string;
  stated: number;
  text: string;
  line: number;
}

/**
 * Pulls every `> **Label (N):** copy…` field out of the blockquoted creatives.
 *
 * Continuation lines are joined, which is not a detail: R1's title is 78
 * characters and wraps across two markdown lines, so a parser that read only
 * the first line would measure 71 and report a mismatch against a document that
 * is correct. A check that fails on good input gets deleted, and then nothing
 * checks the ads at all.
 */
function fields(): Field[] {
  const out: Field[] = [];
  const start = /^>\s*\*\*(.+?)\s*\((\d+)(?:\s*chars?)?[^)]*\):?\*\*\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const m = start.exec(lines[i]);
    if (!m) continue;

    let text = m[3].trim();
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!/^>/.test(next)) break; // left the blockquote
      const body = next.replace(/^>\s?/, '');
      if (body.trim() === '') break; // blank quoted line ends the field
      if (/^\*\*/.test(body.trim())) break; // the next labelled field
      text += ' ' + body.trim();
    }

    out.push({ label: m[1].trim(), stated: Number(m[2]), text: text.trim(), line: i + 1 });
  }
  return out;
}

const ALL = fields();

describe('the ad creatives parse at all', () => {
  it('finds the labelled fields, so the assertions below are not vacuously true', () => {
    // A regex that silently matches nothing would make every test here pass
    // while checking no ad copy whatsoever.
    expect(ALL.length).toBeGreaterThanOrEqual(8);
  });

  it('finds both a Title and a Headline, so both platforms are covered', () => {
    expect(ALL.some((f) => /title/i.test(f.label))).toBe(true);
    expect(ALL.some((f) => /headline/i.test(f.label))).toBe(true);
  });
});

describe('every stated character count is true', () => {
  /*
    The counts exist so an edit can be checked without re-deriving them. That is
    only worth anything if the count and the copy are still the same age.
  */
  for (const f of ALL) {
    it(`${DOC}:${f.line} — "${f.label}" says ${f.stated}`, () => {
      expect(
        f.text.length,
        `"${f.label}" claims ${f.stated} characters but is ${f.text.length}:\n  ${f.text}`,
      ).toBe(f.stated);
    });
  }
});

describe('every field fits the platform that will render it', () => {
  /*
    §1b: "Meta truncates hard: ~125 characters of primary text before the
    'See More' fold, 40 for the headline, ~25 for the description." An
    overflowing headline does not fail to publish — it publishes truncated.
  */
  for (const f of ALL.filter((x) => /headline/i.test(x.label))) {
    it(`headline at line ${f.line} fits Meta's ${META_HEADLINE_MAX}`, () => {
      expect(f.text.length, `"${f.text}"`).toBeLessThanOrEqual(META_HEADLINE_MAX);
    });
  }

  for (const f of ALL.filter((x) => /description/i.test(x.label))) {
    it(`description at line ${f.line} fits Meta's ${META_DESCRIPTION_MAX}`, () => {
      expect(f.text.length, `"${f.text}"`).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    });
  }

  for (const f of ALL.filter((x) => /title/i.test(x.label))) {
    it(`Reddit title at line ${f.line} fits, and stays inside the mobile guidance`, () => {
      expect(f.text.length, `"${f.text}"`).toBeLessThanOrEqual(REDDIT_TITLE_MAX);
      // Reddit's own guidance favours under 80 for mobile, and this audience is
      // overwhelmingly on a phone.
      expect(f.text.length, `over the ${REDDIT_TITLE_MOBILE_GUIDANCE}-char mobile guidance: "${f.text}"`)
        .toBeLessThanOrEqual(REDDIT_TITLE_MOBILE_GUIDANCE);
    });
  }

  it('the brand display name fits Reddit’s 25-character field', () => {
    const m = /\*\*Brand display name:\*\*\s*`([^`]+)`/.exec(md);
    expect(m, 'no brand display name found in the runbook').not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(BRAND_NAME_MAX);
  });
});

describe('the ads cannot quote a price the product does not charge', () => {
  /*
    PRICE_YEARLY_USD is the definition. Everything here is a restatement, and a
    restatement that can drift is a second definition — which is what the
    document's own image rules forbid, for a reason that does not care whether
    the number is in a PNG or in a headline.

    Budget figures ($250 ceiling, $150 / $100 lane caps) are deliberately not
    matched: the patterns below are price-shaped — a figure attached to a year.
  */
  const PRICE_SHAPED = /\$(\d+)(?:\s*\/\s*yr|\s*\/\s*year|\s+a\s+year|\s+per\s+year)/gi;

  it(`states only $${PRICE_YEARLY_USD} as the yearly price`, () => {
    const quoted = [...md.matchAll(PRICE_SHAPED)].map((m) => Number(m[1]));
    expect(quoted.length, 'no yearly price found in the ad copy at all').toBeGreaterThan(0);

    const wrong = [...new Set(quoted)].filter((n) => n !== PRICE_YEARLY_USD);
    expect(
      wrong,
      `these prices appear in ${DOC} but the product charges $${PRICE_YEARLY_USD}: ${wrong.join(', ')}`,
    ).toEqual([]);
  });

  it('states the guarantee in the words lib/offer.ts defines', () => {
    // The refund stance is ratified and issued by hand; an ad that paraphrases
    // it is making a slightly different promise than the Terms do.
    expect(md.toLowerCase()).toContain(GUARANTEE_LABEL.toLowerCase());
  });
});

/*
  The image spec makes one checkable claim, and it is the load-bearing one.

  `docs/ad-assets/PROMPTS.md` heads its palette with: "Palette, taken from the
  shipped product so the click-through reads as continuous — these are the real
  values in `src/app/caregivers/opengraph-image.tsx` and `src/app/icon.svg`, NOT
  INVENTED." Every concept prompt then quotes those hexes into the image a model
  will generate.

  A colour that is not in the product is therefore two failures at once: the
  creative does not match the destination, and the sentence promising it does is
  false. Neither is visible until the assets exist — or worse, until they run.
*/
describe('the image palette is really taken from the product', () => {
  const productSource = [
    'src/app/globals.css',
    'src/app/icon.svg',
    'src/app/caregivers/opengraph-image.tsx',
  ]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .toLowerCase();

  const prompts = readFileSync('docs/ad-assets/PROMPTS.md', 'utf8');

  /*
    Only the FENCED BLOCKS are checked — those are the text pasted into an image
    model, and a colour reaches a generated asset only from there.

    The surrounding prose is deliberately exempt, for the same reason four other
    checks in this repo strip comments before matching: the document has to be
    able to NAME a retired colour in order to explain what went wrong with it.
    The correction note above this file's palette says "#f59e0b is not in the
    product at all" — a true sentence that a naive whole-file scan would flag as
    the very defect it is describing. A check that cannot tell an example from a
    use will be silenced, and then it checks nothing.
  */
  const fenced = [...prompts.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).join('\n');
  const cited = [...new Set([...fenced.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase()))];

  it('finds colours inside the prompt blocks, so this is not vacuous', () => {
    expect(fenced.length, 'no fenced prompt blocks found in PROMPTS.md').toBeGreaterThan(0);
    expect(cited.length).toBeGreaterThanOrEqual(5);
  });

  it('every colour it cites exists somewhere in the product', () => {
    const invented = cited.filter((hex) => !productSource.includes(hex));
    expect(
      invented,
      `docs/ad-assets/PROMPTS.md says its palette is "not invented", but these appear ` +
        `nowhere in globals.css, icon.svg or opengraph-image.tsx: ${invented.join(', ')}. ` +
        `An ad generated from an invented colour cannot match the page it lands on.`,
    ).toEqual([]);
  });
});

describe('the destination URLs carry the measurement', () => {
  /*
    "the `src` is the whole measurement. A URL without it is invisible to the
    gate and the spend is wasted." Both lane destinations are asserted to carry
    one, because this is the single field where a silent mistake costs the
    entire flight rather than one creative.
  */
  it('every ad destination URL carries a src parameter', () => {
    const destinations = [...md.matchAll(/\*\*Destination:\*\*\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(destinations.length, 'no destination URLs found').toBeGreaterThanOrEqual(2);

    for (const url of destinations) {
      expect(url, `${url} has no ?src= — it would be invisible to the gate`).toMatch(/[?&]src=[^&\s]+/);
    }
  });
});
