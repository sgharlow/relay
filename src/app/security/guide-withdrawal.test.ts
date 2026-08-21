/**
 * The user's guide must not describe the withdrawn handover as "not yet".
 *
 * 🔴 THE SAME DOCUMENT SAID BOTH THINGS. Part 6 of public/guide/index.html is
 * unambiguous — "It does not do estates, and it is not going to… not offered,
 * not scheduled, and not waiting on anything." Two earlier sections hedged:
 *
 *   §4.3 "…that is not available to customers yet. See Part 6."
 *   §4.6 "The permanent handover that would speak to any of that is not offered
 *         today (Part 6)."
 *
 * "yet" and "today" are the words that turn a permanent withdrawal back into a
 * roadmap item. PROJECT.yaml says exactly why that matters: a gated framing
 * "would keep it reading as temporary… which is how a withdrawn capability gets
 * quietly rebuilt". Both sentences even point AT Part 6, which contradicts them.
 *
 * ⚠️ lib/ops/guide-claims.test.ts forbids "legal opinion" and "when it does
 * arrive" — the phrasings the earlier version of this drift used. It has no
 * pattern for "yet" or "today", which is why these two survived it. Extending
 * that file's negative list is the lane fix; this is the local half.
 *
 * ⚠️ THE PDF IS GENERATED AND HAS NOT BEEN REGENERATED. public/guide/relay-guide.pdf
 * is printed from the served page by scripts/guide-pdf.mjs, which needs
 * `next build && next start`. The HTML is corrected here; the PDF still carries
 * the old sentences until someone runs that script. Recorded rather than left to
 * be noticed.
 *
 * Feature: relay-h0-mvp
 * Requirements: J10 (withdrawn)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const GUIDE = 'public/guide/index.html';

const text = () =>
  readFileSync(GUIDE, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ');

describe('the guide describes the handover as withdrawn, not delayed', () => {
  it.each([
    ['not available to customers yet', /not available to customers yet/i],
    ['not offered today', /not offered today/i],
  ])('does not say "%s"', (_label, re) => {
    expect(
      text(),
      `${GUIDE} frames the permanent handover as temporary, which its own Part 6 denies`,
    ).not.toMatch(re);
  });

  it('says no temporal hedge about the handover at all', () => {
    /*
      Broader than the two known sentences: any "not … yet/today/for now" within
      a few words of the handover is the same drift wearing different clothes.
    */
    const hedged = /permanent handover[^.]{0,120}\b(yet|today|for now|at the moment|currently)\b/i;
    expect(hedged.exec(text())?.[0] ?? null).toBeNull();
  });

  it('still tells the reader the handover does not exist', () => {
    // Deleting the hedge must not delete the answer. Somebody reading §4.6 is
    // asking whether Relay settles an estate, and it must still say no.
    expect(text()).toMatch(/no permanent handover|does not do estates|not offered/i);
  });
});
