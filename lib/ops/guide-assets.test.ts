/**
 * Every asset the user's guide references must actually load.
 *
 * 🔴 ALL TWENTY-FOUR SCREENSHOTS IN THE GUIDE WERE BROKEN IN PRODUCTION, found
 * 2026-08-13 by opening `/guide` and reading the console: 24 × 404, on the one
 * document written for the non-technical half of the audience — the person in a
 * hospital corridor, the parent who was handed a printout.
 *
 * THE CAUSE IS THE REWRITE THAT MADE THE SHORT URL WORK. `next.config.mjs`
 * rewrites `/guide` → `/guide/index.html`, and a rewrite does not change the
 * browser's address. So the document's base URL stays `/guide` (no trailing
 * slash), and a relative `src="screens/x.png"` resolves against the PARENT —
 * `/screens/x.png` — which does not exist. The files were sitting at
 * `/guide/screens/x.png` returning 200 the whole time.
 *
 * Nothing failed loudly. The build passes, the page renders, the text is all
 * there, and the suite was green: every check in this repo tested the guide's
 * WORDS (lib/billing/beta-flag.test.ts reads §2.7) and none tested whether it
 * could draw. A missing image is invisible to a test that reads the file as
 * a string.
 *
 * So this asserts the two halves that together mean "it loads":
 *   1. every referenced asset resolves from the SITE ROOT, never relatively —
 *      which is what makes the reference independent of whether the page is
 *      served at `/guide`, `/guide/`, or `/guide/index.html`;
 *   2. every referenced file exists on disk under `public/`.
 *
 * Checking only (1) would pass on a path to a file nobody shipped; checking
 * only (2) would pass on the exact defect this was written for.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE = 'public/guide/index.html';

/** `src="…"` / `href="…"`, excluding anchors, mail links and external URLs. */
function localAssetRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(ref)) continue;
    out.push(ref);
  }
  return out;
}

describe('the user guide can actually draw itself', () => {
  const html = readFileSync(GUIDE, 'utf8');
  const refs = localAssetRefs(html);

  it('references at least the screenshots it is built around', () => {
    // A guard that passes because the file stopped referencing anything is not
    // a guard. The guide is a walkthrough; it has pictures.
    expect(refs.length).toBeGreaterThan(20);
  });

  it('resolves every asset from the site root, never relatively', () => {
    /*
      THE WHOLE DEFECT, IN ONE ASSERTION. `/guide` is a rewrite, so the base URL
      has no trailing slash and a relative path resolves one level too high.
      Absolute references are correct under every serving path, which is why
      this demands them rather than demanding a trailing slash somewhere else.
    */
    const relative = refs.filter((r) => !r.startsWith('/'));
    expect(relative, `relative refs resolve against / and 404: ${relative.join(', ')}`).toEqual([]);
  });

  it('points every reference at a file that exists', () => {
    const missing = refs
      .filter((r) => r.startsWith('/'))
      // Query strings and fragments are not part of the filename.
      .map((r) => r.split(/[?#]/)[0])
      .filter((r) => !existsSync(join('public', r)));

    expect(missing, `referenced but not shipped: ${missing.join(', ')}`).toEqual([]);
  });
});
