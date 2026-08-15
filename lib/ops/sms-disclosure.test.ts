/**
 * The SMS disclosures the public pages have to carry.
 *
 * WHY A TEST AND NOT JUST THE PAGES. A2P 10DLC review reads `/privacy` and
 * `/terms` and one of the commonest rejection reasons is a privacy policy that
 * never mentions text messaging. Both pages were silent on it until 2026-08-15;
 * they are now correct, and the failure mode from here is silent — a copy edit
 * or a redesign drops a paragraph, nothing breaks, no test fails, and the next
 * campaign submission is rejected weeks later for a reason nobody connects to
 * the change.
 *
 * 🔴 THE LOAD-BEARING SENTENCE is the third-party one. `/privacy` lists "the
 * names, emails and phone numbers of people you designate" — so a number can
 * arrive on a roster row typed by SOMEBODY ELSE. Carriers require consent from
 * the person who owns the handset, and it is the right rule regardless: being
 * named by a third party is not agreement to be texted by us.
 *
 * ⚠️ WHAT THIS TEST CANNOT DO, stated so nobody trusts it further than it goes.
 * It pins the PROMISE, not the behaviour. When the opt-in screen is built, the
 * send path must read the number the person entered while signed in, never the
 * roster's `phone` column — and no test here can see that, because the code
 * does not exist yet. If you are the person building it: wiring SMS to
 * `recipients.phone` or `verifiers.phone` makes this page false and the
 * campaign non-compliant in the same stroke.
 *
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Comments out — a note ABOUT a disclosure must never satisfy a check FOR one. */
const copy = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');

const PRIVACY = 'src/app/privacy/page.tsx';
const TERMS = 'src/app/terms/page.tsx';

describe.each([
  ['privacy', PRIVACY],
  ['terms', TERMS],
])('the %s page discloses text messaging', (_name, path) => {
  it('mentions text messages at all', () => {
    expect(copy(path).toLowerCase()).toMatch(/text (you|messages|someone)/);
  });

  it('gives the opt-out keyword carriers require', () => {
    expect(copy(path)).toContain('STOP');
  });

  it('says the rates-and-frequency line', () => {
    const c = copy(path).toLowerCase();
    expect(c).toContain('rates');
    expect(c, 'frequency must be described, not just rates').toMatch(/frequency|how often/);
  });
});

/*
  🔴 THE CROSS-BOUNDARY CONTRACT. Three things have to say the same words: the
  public /sms page a carrier reviewer loads, the campaign copy registered with
  the carriers (docs/a2p-registration-prep.md), and — later — the send path.
  A sample message edited in one place and not the others is a compliance
  discrepancy, and it is the kind nobody notices until a campaign is suspended
  weeks after the edit that caused it.

  Two of the three exist today, so two of the three are pinned here. When the
  send path is built it joins this test.
*/
describe('the /sms page and the registered campaign say the same words', () => {
  const SMS_PAGE = 'src/app/sms/page.tsx';
  const A2P_DOC = 'docs/a2p-registration-prep.md';

  /** Joins `'a ' + 'b'` source concatenations so a literal reads as one string. */
  const literals = (p: string) =>
    readFileSync(p, 'utf8')
      .replace(/'\s*\+\s*\n?\s*'/g, '')
      .replace(/\s+/g, ' ');

  const page = literals(SMS_PAGE);
  /* Blockquote markers stripped BEFORE whitespace collapses: the doc wraps the
     consent wording in a `>` quote, so the markers land mid-sentence and a raw
     comparison fails on markup rather than on content. */
  const doc = readFileSync(A2P_DOC, 'utf8')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ');

  /* Pulled out of the page rather than hard-coded here, so this test cannot
     drift into being a third copy of the very thing it is checking. */
  const samples = [...literals(SMS_PAGE).matchAll(/'(Relay: [^']+)'/g)].map((m) => m[1]);

  it('the page actually carries three sample messages', () => {
    expect(samples).toHaveLength(3);
  });

  it.each([0, 1, 2])('sample %i appears verbatim in the registered campaign copy', (i) => {
    expect(doc).toContain(samples[i]);
  });

  it('every sample carries the opt-out keyword', () => {
    for (const s of samples) expect(s).toContain('Reply STOP to opt out.');
  });

  /*
    The security model, not a courtesy: a message worth intercepting is a
    message worth faking. Asserted on the samples themselves so a future edit
    that slips a code or a link into one fails here.
  */
  it('no sample contains a code, a token or a clickable link', () => {
    for (const s of samples) {
      expect(s, s).not.toMatch(/https?:\/\//);
      expect(s, s).not.toMatch(/token=|code[: ]\s*\w{4,}/i);
    }
  });

  it('the consent wording on the page matches the registered wording', () => {
    const consent = (page.match(/'(Text me if something needs my attention[^']*)'/) || [])[1];
    expect(consent, 'the page must state the tick-box wording').toBeTruthy();
    expect(doc).toContain(consent!);
  });

  it('the page states the promise that consent cannot come from a third party', () => {
    expect(page).toMatch(/Nobody can turn this on for you/i);
  });

  it('the page gives both required keywords', () => {
    expect(page).toContain('STOP');
    expect(page).toContain('HELP');
  });

  /*
    It is the A2P opt-in URL, so a reviewer has to be able to reach it. A page
    that resolves but is linked from nowhere reads as staged for the review.
  */
  it('is reachable from the site, not just by URL', () => {
    expect(readFileSync('src/app/sitemap.ts', 'utf8')).toContain('/sms');
    expect(readFileSync('src/app/page.tsx', 'utf8')).toContain('href="/sms"');
  });
});

describe('the promise that decides whether the campaign is compliant', () => {
  it('privacy: a number entered by somebody else is never used for texts', () => {
    expect(copy(PRIVACY)).toMatch(
      /number somebody else entered for you is never used for text messages/i,
    );
  });

  it('terms: the person turns it on themselves and nobody can do it for them', () => {
    expect(copy(TERMS)).toMatch(/turn this on yourself and nobody can turn it on for you/i);
  });

  /*
    The owner texting a claim code from their own phone is a DIFFERENT act and
    is deliberately still allowed — §3.3 has always described the code being
    "read out, texted, or handed to you". Carriers care about who sends, not
    about the word "text", and collapsing the two would either ban something
    harmless or license something that is not.
  */
  it('terms still permits the owner delivering a code by text themselves', () => {
    expect(copy(TERMS)).toMatch(/read out, texted, or handed to you/i);
  });
});
