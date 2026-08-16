/**
 * Share cards may use colour literals — but only the product's colours.
 *
 * `raw-color.test.ts` exempts `opengraph-image.tsx` files, for a real reason it
 * states: "they render a static social card through Satori, which resolves no
 * CSS variables, so a literal is the only thing that can work there."
 *
 * 🔴 THAT EXEMPTION IS EXACTLY WHERE THE DRIFT HID. Nothing checked WHICH
 * literals they used, so when the Warm Archive system landed, the root card was
 * rebuilt and `src/app/caregivers/opengraph-image.tsx` was missed — and stayed
 * on #020617 slate with #fcd34d amber for two days while the page it previews
 * rendered warm paper. Its own sibling's header had already named the failure:
 * "It is the single most-seen surface the brand has (every link anybody pastes
 * anywhere), and it advertised a product that looked nothing like the one
 * behind the link."
 *
 * It mattered more than a normal miss. That card is the preview for the exact
 * page a paid ad lands on, so the first thing a caregiver sees of this product
 * in a Facebook feed was a palette the product no longer uses. It was also the
 * file `docs/ad-assets/PROMPTS.md` cited as evidence its own dark palette was
 * "taken from the shipped product".
 *
 * So the exemption stays and the hole closes: a literal is allowed, an INVENTED
 * literal is not. Every colour in a share card must appear in `globals.css`,
 * which is where the palette is defined.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const palette = readFileSync('src/app/globals.css', 'utf8').toLowerCase();

function ogCards(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) ogCards(full, out);
    else if (/^(opengraph|twitter)-image\.tsx$/.test(entry)) out.push(full.split('\\').join('/'));
  }
  return out;
}

const cards = ogCards('src');

describe('share cards use the product’s palette', () => {
  it('finds the share cards, so this is not vacuous', () => {
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  for (const card of cards) {
    it(`${card} invents no colours`, () => {
      /*
        Comments are stripped: these files EXPLAIN their own palette history
        ("It painted #020617 with #3b82f6 and #fbbf24"), and a check that reads
        an explanation as a use is a check that gets deleted.
      */
      const code = readFileSync(card, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ \t]*\/\/.*$/gm, ' ');

      const used = [...new Set([...code.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase()))];
      const invented = used.filter((hex) => !palette.includes(hex));

      expect(
        invented,
        `${card} paints colours that are not in globals.css: ${invented.join(', ')}. ` +
          `A share card is the first thing anybody sees of this product; painting it in ` +
          `a palette the product does not use advertises something that is not behind the link.`,
      ).toEqual([]);
    });
  }
});
