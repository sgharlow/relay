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

  /*
    The vacuity guard NAMES the palette rather than counting it.

    It used to assert "at least 5 distinct colours", a number calibrated to the
    old slate-and-amber set. Migrating the prompts to Warm Archive on 2026-08-15
    brought that to four — the palette is genuinely more restrained — and the
    guard failed on correct input.

    Lowering the number to 4 would have been the wrong repair: it is the move
    that turns a guard into a rubber stamp, and the next migration would meet
    the same argument with less resistance. Naming the three colours the prompts
    must actually use is a STRONGER assertion than any count — a regex that
    matched nothing, or prompts that silently reverted to slate, both fail it,
    and neither could be waved through by adjusting a threshold.
  */
  it('the prompt blocks really carry the product palette', () => {
    expect(fenced.length, 'no fenced prompt blocks found in PROMPTS.md').toBeGreaterThan(0);

    for (const [role, hex] of [
      ['paper (the ground)', '#f7f4ee'],
      ['ink (text and dark forms)', '#1f1b16'],
      ['ochre (the access state)', '#b4703a'],
    ] as const) {
      expect(cited, `no prompt cites ${role} ${hex}`).toContain(hex);
    }
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

  /*
    ⚠️ THE HEX CHECK ABOVE PASSED ON PROMPTS THAT WOULD HAVE PRODUCED DARK ADS.

    The 2026-08-15 migration to Warm Archive swapped the hexes and left the
    ENGLISH alone, so five blocks shipped reading, verbatim, "on a deep
    near-black slate surface (#f7f4ee)" — a near-white hex introduced by the
    words "near-black slate". The guard above reads `#f7f4ee` and is satisfied.
    An image model reads the sentence, and the sentence wins: it would have
    rendered a dark, moody plate for a warm, LIGHT landing page — the exact
    mismatch `ratified.d5` was decided to end, arriving through the one door the
    new check did not cover.

    That is this repo's recurring shape (`feedback-my-own-check-measured-the-
    wrong-thing`): the guard was proven by planting a wrong HEX, which is the
    half that was already right. These three assertions read the prose, because
    the prose is what the model obeys.

    They are deliberately narrow. Ink IS near-black and ochre IS warm — "deep
    ink-dark brushed metal (#1f1b16)" and "near-black ink (#1f1b16)" are correct
    descriptions of dark SUBJECTS on a light ground, and both must keep passing.
    What cannot be true of any current creative is a dark GROUND.
  */
  const blocks = [...prompts.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);

  /** Every Warm Archive colour that is LIGHT. A dark word in their sentence is a contradiction. */
  const LIGHT_HEXES = ['#f7f4ee', '#fffdf9', '#efeae0', '#f6ead9'];
  const DARK_WORD = /\b(dark|darker|darkest|near-black|charcoal|slate|midnight|navy)\b/i;
  /** What a prompt calls the surface the subject sits on. */
  const GROUND_NOUN = /\b(background|backdrop|ground|field|surface|margin|plate|backdrop)\b/gi;

  it('no sentence describes a light colour in dark words', () => {
    const contradictions: string[] = [];
    for (const block of blocks) {
      for (const sentence of block.split(/(?<=\.)\s+/)) {
        if (!LIGHT_HEXES.some((h) => sentence.toLowerCase().includes(h))) continue;
        const dark = sentence.match(DARK_WORD);
        if (dark) contradictions.push(`"${dark[0]}" beside a light hex — ${sentence.trim()}`);
      }
    }
    expect(
      contradictions,
      `A prompt cites a LIGHT Warm Archive colour in a sentence that calls it dark. The hex ` +
        `check passes and the generated image is still wrong, because the model reads the ` +
        `words:\n\n${contradictions.join('\n\n')}`,
    ).toEqual([]);
  });

  it('no prompt sets a dark ground', () => {
    const grounds: string[] = [];
    for (const block of blocks) {
      for (const m of block.matchAll(GROUND_NOUN)) {
        // The three words immediately before the noun are what qualify it.
        const before = block.slice(Math.max(0, m.index - 40), m.index).split(/\s+/).slice(-3);
        if (before.some((w) => DARK_WORD.test(w))) {
          grounds.push(`"${before.join(' ')} ${m[0]}"`);
        }
      }
    }
    expect(
      grounds,
      `The ground of every current creative is warm paper (#f7f4ee) — that is what "match the ` +
        `destination" means. These prompts set a dark one: ${grounds.join(', ')}. Note that a ` +
        `DARKER element ON paper is fine and passes ("a faint darker grid … in the background"); ` +
        `what fails is dark qualifying the ground itself.`,
    ).toEqual([]);
  });

  it('no prompt uses the retired direction by name', () => {
    /*
      `slate` is the retired palette's own name — this file says so twice, in
      red: "not the retired slate", "The slate in these prompts was never an art
      direction — it was un-migrated legacy." Nothing in Warm Archive is slate.

      `dark mode` and `dark, moody` are whole-image directions rather than a
      single colour, so they survive any hex swap. The brand HAS a sanctioned
      dark (relay-mark-inverse.svg) and no current creative uses it; if one ever
      does, it cites that file and this list is what gets amended, deliberately.
    */
    const retired = [/\bslate\b/i, /\bdark[- ]mode\b/i, /\bdark,\s*moody\b/i];
    const used: string[] = [];
    for (const block of blocks) {
      for (const pattern of retired) {
        const hit = block.match(pattern);
        if (hit) used.push(hit[0]);
      }
    }
    expect(
      used,
      `A prompt block names the retired slate-and-amber direction: ${used.join(', ')}. ` +
        `PROMPTS.md's own correction note calls it "un-migrated legacy from before the Warm ` +
        `Archive system existed".`,
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

  /*
    The sitting sheet restates ONE volatile value — the Reddit destination URL —
    because it is the field being read aloud and typed under time pressure, and
    "go and look it up" is how a sitting acquires a typo. Restating it creates a
    second definition, so the second definition is pinned to the first here.

    The sheet deliberately does NOT restate the creative copy, for exactly the
    reason this file exists; it points at `g1-ad-creatives.md` instead. This test
    is what makes the one exception safe rather than a precedent.
  */
  it('the sitting sheet quotes the same Reddit destination as the runbook', () => {
    const sheet = readFileSync('docs/g1-sitting-sheet.md', 'utf8');

    const runbookReddit = [...md.matchAll(/\*\*Destination:\*\*\s*`([^`]+)`/g)]
      .map((m) => m[1])
      .find((u) => /src=reddit/.test(u));
    expect(runbookReddit, 'no reddit destination in the runbook').toBeTruthy();

    const inSheet = sheet.includes(runbookReddit as string);
    expect(
      inSheet,
      `docs/g1-sitting-sheet.md must quote the runbook's Reddit destination verbatim ` +
        `(${runbookReddit}). A sitting sheet that disagrees with the runbook sends the spend ` +
        `somewhere the gate cannot see.`,
    ).toBe(true);
  });
});
