/**
 * The support content, held to the promises the rest of the product makes.
 *
 * The FAQ is the one place where every claim in Relay gets restated in short
 * form to somebody who is worried. That makes it the easiest place for a
 * comforting inaccuracy to creep in — and a comforting inaccuracy here is worse
 * than elsewhere, because it is read by people deciding whether to trust the
 * thing at all.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { FAQ, faqFor, searchFaq, AUDIENCE_LABELS, type Audience } from './faq';

describe('the FAQ as data', () => {
  it('has unique ids, so every answer can be linked to', () => {
    const ids = FAQ.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all three audiences', () => {
    for (const a of Object.keys(AUDIENCE_LABELS) as Audience[]) {
      expect(faqFor(a).length, `${a} has no entries`).toBeGreaterThan(0);
    }
  });

  it('every entry actually answers something', () => {
    for (const e of FAQ) {
      expect(e.question.endsWith('?') || e.question.endsWith('.'), e.id).toBe(true);
      expect(e.answer.length, `${e.id} has no answer`).toBeGreaterThan(0);
      for (const p of e.answer) expect(p.trim().length).toBeGreaterThan(20);
    }
  });

  it('carries no markup — every consumer decides its own presentation', () => {
    for (const e of FAQ) {
      for (const p of e.answer) expect(p, e.id).not.toMatch(/[<>]|\*\*|\[.*\]\(/);
    }
  });
});

describe('the promises it must not soften', () => {
  const all = FAQ.flatMap((e) => [e.question, ...e.answer]).join(' ').toLowerCase();

  /*
    The anti-phishing promise is the one a support page is most tempted to
    hedge. It must appear, and it must be absolute.
  */
  it('states that Relay never sends a sign-in link', () => {
    expect(all).toMatch(/never sends? (you )?a link that signs you in/);
  });

  it('says plainly that we cannot read a vault', () => {
    const e = FAQ.find((x) => x.id === 'can-you-read');
    expect(e?.answer.join(' ')).toMatch(/^No\./);
  });

  /*
    The two answers where somebody is genuinely stuck must be MARKED, not
    softened. Somebody with no recovery codes needs to stop looking for a
    button, and the page renders a plain statement for exactly these.
  */
  it('marks the answers where nobody can help, including us', () => {
    const irreversible = FAQ.filter((e) => e.irreversible).map((e) => e.id);
    expect(irreversible).toContain('no-recovery-codes');
    expect(irreversible).toContain('estate');
  });

  it('does not promise a rescue it cannot perform', () => {
    const stuck = FAQ.find((e) => e.id === 'no-recovery-codes');
    expect(stuck?.answer.join(' ')).toMatch(/nobody can let you back in/i);
    expect(stuck?.answer.join(' ')).toMatch(/not us either/i);
  });

  /*
    Estate is gated pending counsel and /terms disclaims it. The FAQ is a public
    page and would be the fourth surface to sell it by accident.
  */
  it('does not offer estate as something available today', () => {
    const e = FAQ.find((x) => x.id === 'estate');
    expect(e?.answer.join(' ')).toMatch(/not today/i);
  });

  it('never tells anybody to send us a code or a password', () => {
    expect(all).not.toMatch(/send us your (code|password)|paste your (code|password)/);
  });
});

describe('searchFaq', () => {
  it('finds an answer by the words somebody would actually type', () => {
    expect(searchFaq('lost my phone').map((e) => e.id)).toContain('lost-phone');
    expect(searchFaq('code not working').map((e) => e.id)).toContain('code-not-working');
  });

  it('returns nothing for an empty or trivial query rather than everything', () => {
    expect(searchFaq('')).toEqual([]);
    expect(searchFaq('a of')).toEqual([]);
  });

  it('ranks a closer match first', () => {
    const r = searchFaq('recovery codes lost authenticator');
    expect(r.length).toBeGreaterThan(0);
    expect(['lost-phone', 'no-recovery-codes']).toContain(r[0].id);
  });
});
