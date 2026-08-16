/**
 * The public surface must name who operates Relay.
 *
 * WHY THIS IS A TEST AND NOT A NOTE. Until 2026-08-16 the Terms of Service — a
 * contract a paying customer enters — named no party at all. It said "Relay is
 * early-stage software" and "provided as-is" and never said by whom, and nobody
 * noticed for the life of the document, because nothing was watching and the
 * audience it was written for (paid ad clicks) never checks.
 *
 * The audience changed. `ratified.retire-paid-advertising` makes op-eds in AARP
 * and caregiver.com the route to visibility, and editorial has two gatekeepers
 * who both check: the editor, who needs an attributable author before they will
 * publish, and the reader, who is being asked to hand a stranger their family's
 * passwords. `/security` already described that reader precisely — "a caregiver
 * about to put their mother's bank login into a website run by someone they have
 * never heard of".
 *
 * A page can lose a line in a refactor and look fine. This is the check that
 * makes that loud.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { OPERATOR_NAME, CONTACT_EMAIL } from '../contact';

/** The pages a stranger checks before trusting, or before citing. */
const MUST_NAME_THE_OPERATOR = [
  'src/app/terms/page.tsx',
  'src/app/privacy/page.tsx',
  'src/app/about/page.tsx',
] as const;

describe('the public surface names who is behind Relay', () => {
  it('the operator is defined in exactly one place', () => {
    // Three copies of a person's name is three places to get it wrong — the same
    // rule that collapsed the contact address into lib/contact.ts.
    expect(OPERATOR_NAME.trim().length).toBeGreaterThan(0);
    for (const file of MUST_NAME_THE_OPERATOR) {
      const src = readFileSync(file, 'utf8');
      expect(
        src.includes('OPERATOR_NAME'),
        `${file} must render OPERATOR_NAME from lib/contact, not a retyped literal`,
      ).toBe(true);
    }
  });

  it('no page hardcodes the name as a literal instead of importing it', () => {
    const offenders = MUST_NAME_THE_OPERATOR.filter((file) => {
      const src = readFileSync(file, 'utf8');
      // The name appearing OUTSIDE a comment and outside the import is a second
      // definition. Comments are exempt: they have to be able to explain the rule.
      const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return withoutComments.includes(`'${OPERATOR_NAME}'`) || withoutComments.includes(`>${OPERATOR_NAME}<`);
    });
    expect(
      offenders,
      `these hardcode "${OPERATOR_NAME}" instead of importing OPERATOR_NAME: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the legal pages say the reader is contracting with a person, not with nobody', () => {
    /*
      Asserting the WORDING, not just the constant, because the constant could be
      rendered somewhere decorative while the contract still says nothing about
      who provides it. What matters is the sentence a customer reads.
    */
    for (const file of ['src/app/terms/page.tsx', 'src/app/privacy/page.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} must state there is no company`).toMatch(/there is no\s*\n?\s*company/i);
      expect(src, `${file} must say who to reach`).toContain('CONTACT_MAILTO');
    }
  });

  it('every one of those pages routes to a monitored human', () => {
    for (const file of MUST_NAME_THE_OPERATOR) {
      const src = readFileSync(file, 'utf8');
      expect(src.includes('CONTACT_MAILTO') || src.includes(CONTACT_EMAIL), file).toBe(true);
    }
  });

  it('the About page exists and is reachable from the legal pages', () => {
    // An editor lands on /terms as often as anywhere else; a dead end there is a
    // dead end for the pitch.
    for (const file of ['src/app/terms/page.tsx', 'src/app/privacy/page.tsx']) {
      expect(readFileSync(file, 'utf8'), `${file} should link to /about`).toContain('href="/about"');
    }
  });
});
