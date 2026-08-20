/**
 * The product's own answer to its own question.
 *
 * THE FINDING (`PROJECT.yaml → deferred → relays-own-continuity-is-unstated`,
 * C7). Relay's entire subject is what happens when the person holding
 * everything cannot act. It is run by one individual
 * (`ratified.relay-operator-is-an-individual`) and said nothing at all about
 * what becomes of a customer's vault if THAT individual is the one who stops.
 * It is the first question a cautious reader asks of a one-person custodian.
 *
 * WHY IT IS A TEST AND NOT JUST COPY. Three of these sentences are the kind a
 * later edit softens without meaning to — the uncomfortable one especially. A
 * page that says "your data is safe with us" and drops "a stopped service
 * releases nothing" would read better and be worse, and nothing would notice.
 * `operator-named.test.ts` pins WHO runs Relay; this pins what that costs.
 *
 * ⚠️ IT ALSO PINS WHAT MUST **NOT** BE SAID. The honest answer is that there is
 * no escrow, no successor and no enforceable wind-down commitment. Those are the
 * three things it would be easiest and most tempting to imply, and implying any
 * of them turns a trustworthy page into a promise nobody can keep.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ABOUT = readFileSync(join(process.cwd(), 'src/app/about/page.tsx'), 'utf8');
const TERMS = readFileSync(join(process.cwd(), 'src/app/terms/page.tsx'), 'utf8');

describe('/about answers the question the product is about', () => {
  it('raises operator continuity at all', () => {
    expect(ABOUT).toMatch(/what happens to relay if something happens to me/i);
  });

  it('says the service stopping means nobody is released to — the uncomfortable half', () => {
    // The sharpest consequence, and the one a reassuring rewrite would drop:
    // the thing that would give a recipient access IS the thing that is gone.
    expect(ABOUT).toContain('A stopped service cannot release anything to anyone.');
  });

  it('says the CONTENT is not at risk, and scopes that claim to content', () => {
    // Scoped deliberately. /privacy now discloses that the owner's own sign-in
    // authenticator secret IS stored readably, so an unqualified "I can never
    // read anything" would contradict the page next door.
    expect(ABOUT).toMatch(/encrypted in your\s*\n?\s*browser/i);
    expect(ABOUT).toMatch(/could not read them/i);
  });

  it('names the remedy, and that it needs nothing from the operator', () => {
    expect(ABOUT).toMatch(/export/i);
    expect(ABOUT).toContain('needs nothing from me');
  });
});

describe('the Terms carry it where it is contractual', () => {
  it('states there is no successor and no escrow', () => {
    expect(TERMS).toContain('There is no successor and no escrow.');
  });

  it('points at the export as the thing that survives', () => {
    expect(TERMS).toMatch(/export your vault/i);
  });

  it('links to the fuller answer rather than duplicating it', () => {
    const at = TERMS.indexOf('There is no successor and no escrow.');
    expect(TERMS.slice(at, at + 1200)).toContain('href="/about"');
  });
});

describe('what it must never claim', () => {
  const both = `${ABOUT}\n${TERMS}`;

  it('does not promise a successor, an escrow, or a trustee', () => {
    // Each of these would be the easy, comforting sentence. None of them is true.
    for (const claim of [
      /we will transfer your (data|vault) to/i,
      /held in escrow/i,
      /a trustee will/i,
      /your data will be (preserved|maintained) (indefinitely|forever)/i,
    ]) {
      expect(claim.test(both), `a promise nobody can keep: ${claim}`).toBe(false);
    }
  });

  it('marks the wind-down commitment as an intention, not a guarantee', () => {
    // It is the one forward-looking promise on the page, and it is unenforceable
    // by construction — there is nobody to enforce it against.
    expect(ABOUT).toMatch(/intention/i);
    expect(ABOUT).toMatch(/not dressing it up as a\s*\n?\s*guarantee/i);
    expect(TERMS).toMatch(/intention rather than a guarantee/i);
  });
});
