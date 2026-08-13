/**
 * The palette's contrast, as arithmetic that runs in CI.
 *
 * 🔴 EVERY SIGNED-IN SCREEN FAILED WCAG AA until 2026-08-13. `--ink-faint`
 * measured 3.53:1 on paper and the active sidebar item 3.60:1, against a 4.5:1
 * requirement — 46 failing elements on /vault alone. It went unnoticed because
 * nothing checked, and the one heuristic that tried was wrong.
 *
 * scripts/a11y-audit.mjs is the real check, but it needs a browser and cannot
 * run in CI. This is the half that can: the tokens are hex literals, contrast is
 * a pure function of two of them, and a regression here is a colour someone
 * edits — which is exactly the change this catches. It does NOT prove the pairs
 * are used as declared; that is the browser audit's job, and the two are meant
 * to be run together.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/app/globals.css', 'utf8');

/**
 * Reads a token by scanning lines rather than building a regex from a string.
 * A `\s` written into a generated string collapses to a plain `s` and the
 * pattern then silently matches nothing — which is how the first version of this
 * file failed every assertion for a reason that had nothing to do with colour.
 */
function token(name: string): string {
  const prefix = `--${name}:`;
  for (const line of CSS.split('\n')) {
    const t = line.trim();
    if (!t.startsWith(prefix)) continue;
    const hex = t.slice(prefix.length).trim().split(';')[0].trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  }
  throw new Error(`token --${name} not found as a hex literal in globals.css`);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every text colour, on every ground it is actually rendered against. */
const PAIRS: [string, string, string][] = [
  ['ink', 'paper', 'body text'],
  ['ink', 'paper-raised', 'body text on a card'],
  ['ink-muted', 'paper', 'secondary text'],
  ['ink-muted', 'paper-raised', 'secondary text on a card'],
  ['ink-faint', 'paper', 'meta — the line under each vault item'],
  ['ink-faint', 'paper-raised', 'meta on a card'],
  ['ink-faint', 'paper-sunken', 'meta in a well — the darkest ground it sits on'],
  ['paper-faint', 'ink', 'sidebar navigation, unselected'],
  ['paper', 'ochre-deep', 'sidebar navigation, selected'],
  ['sage-text', 'paper', 'armed / safe wording'],
  ['ochre-text', 'paper', 'in-motion wording'],
];

describe('palette contrast (WCAG AA, 4.5:1 for normal text)', () => {
  for (const [fg, bg, what] of PAIRS) {
    it(`--${fg} on --${bg} — ${what}`, () => {
      const r = contrast(token(fg), token(bg));
      expect(
        Number(r.toFixed(2)),
        `--${fg} (${token(fg)}) on --${bg} (${token(bg)}) is ${r.toFixed(2)}:1. ` +
          'Normal text needs 4.5:1. Adjust the token, then re-run ' +
          'scripts/a11y-audit.mjs, which checks what is actually rendered.',
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  /*
    No single value can clear 4.5:1 against both the paper family and the ink
    sidebar — the first needs luminance <= 0.183, the second >= 0.226. That is
    why --paper-faint exists as a separate token rather than being a tweak to
    --ink-faint, and this records the reason so nobody "simplifies" it back.
  */
  it('one faint token could not have served both grounds', () => {
    expect(contrast(token('ink-faint'), token('ink'))).toBeLessThan(4.5);
    expect(contrast(token('paper-faint'), token('paper'))).toBeLessThan(4.5);
  });
});
