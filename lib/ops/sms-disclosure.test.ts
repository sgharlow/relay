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
