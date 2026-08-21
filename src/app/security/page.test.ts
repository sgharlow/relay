/**
 * The trust page may not describe a withdrawn capability as a mechanism.
 *
 * 🔴 /security SAID BOTH THINGS, ON ONE PAGE, TO THE SAME READER:
 *
 *     "Relay does not offer estate or inheritance services and confers no legal
 *      authority on anyone."                                      (the answer)
 *     "Emergencies reverse; estate handoffs are permanent by construction."
 *                                                        (the design principle)
 *
 * The second sentence presents estate handoffs as one of the two reversibility
 * classes the product operates. It is stale rather than dishonest — the domain
 * really does still carry an `estate` trigger type for legacy rows, and
 * `graceWindowMs` really does branch on it — but no user can create one, and
 * `gates.g2-counsel-opinion` was DECLINED on 2026-08-14, which "narrowed estate
 * OUT of the product PERMANENTLY". The page a cautious caregiver reads before
 * paying is the wrong place to advertise a door that is bricked up.
 *
 * ⚠️ WHY THE EXISTING GUARD DID NOT CATCH IT. lib/ops/gates.test.ts sweeps for
 * FORWARD-LOOKING phrasing, because the failure it was written for was copy that
 * read as "not yet". This sentence has no hedge in it at all; it states estate as
 * a present property, so it sailed past. A positive assertion on the page is what
 * that needs, in the shape of the SITE_DESCRIPTION check in that same file.
 *
 * ⚠️ That sweep reads COMMENTS as well as copy, and it has no exemption for this
 * file — so quoting the phrases it looks for, even to explain them, fails it.
 * They are described here rather than reproduced. (Found by doing it.)
 *
 * Feature: relay-standby
 * Requirements: J10 (withdrawn)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PAGE = 'src/app/security/page.tsx';

/** The page as a reader meets it: comments gone, whitespace as rendered. */
function prose(): string {
  return readFileSync(PAGE, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ');
}

describe('/security does not offer estate', () => {
  it('mentions estate only to say it is not offered', () => {
    /*
      Every sentence containing the word is inspected rather than the word being
      banned outright: the page SHOULD say estate is not offered, and a guard
      that forbade the word would delete the disclosure along with the drift.
    */
    const sentences = prose()
      .split(/(?<=[.!?])\s+/)
      .filter((s) => /\bestate\b/i.test(s));

    const offenders = sentences.filter(
      (s) => !/does not offer|not offered|no permanent|is not available|withdrawn/i.test(s),
    );

    expect(
      offenders,
      offenders.length
        ? 'These sentences on /security present estate as something the product does:\n' +
          offenders.map((o) => `  “${o.trim()}”`).join('\n') +
          '\n\ng2-counsel-opinion was declined on 2026-08-14 and estate is withdrawn ' +
          'permanently. Describe the mechanism actually operated.'
        : 'ok',
    ).toEqual([]);
  });

  it('still describes reversibility, which is the real property', () => {
    // Deleting the clause must not delete the point. Reversibility being derived
    // from the trigger type rather than a settable flag is a genuine design
    // decision and one of the better answers on the page.
    expect(prose(), '/security should still explain how reversibility is decided').toMatch(
      /derived from the trigger type/i,
    );
  });

  it('does not make a claim that expires at the first arms-length sale', () => {
    /*
      "no paying customers yet" was defensible on the day it was written and
      becomes false at the exact event the demand lane exists to produce — on the
      page somebody reads BEFORE paying, which is the worst possible place for a
      sentence that goes stale silently. src/app/terms/page.tsx records the same
      sentence going wrong there once already: it "said 'no paying customers yet'
      for a day after the first live charge".
    */
    expect(prose(), 'this sentence has already gone stale once, on /terms').not.toMatch(
      /no paying customers yet/i,
    );
  });

  it('still tells a reader the product is young — the honesty is the point', () => {
    expect(prose()).toMatch(/early-stage/i);
  });
});
