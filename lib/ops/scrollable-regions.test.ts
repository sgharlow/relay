/**
 * A region that scrolls can be reached from a keyboard.
 *
 * 🔴 WHY A STRUCTURAL CHECK WHEN axe ALREADY TESTS THIS. Because axe can only
 * see it when the content HAPPENS to overflow. `scrollable-region-focusable`
 * fires on a region that is actually scrolling right now, so whether it is
 * caught depends on how many columns a table has, how wide the viewport is, and
 * how much data the audited account holds. On 2026-08-15 `/audit` failed it at
 * 390px and passed at 1280px — the same markup, the same defect, one of them
 * invisible.
 *
 * Two of the three instances found that day were invisible in exactly that way:
 * `/import`'s preview table and `/circle`'s roster are the same shape and were
 * clean only because a disposable account has almost nothing in it. They would
 * have failed for a real owner and passed in every sweep before that.
 *
 * THE CONVENTION EXISTED AND WAS FORGOTTEN, which is the argument for making it
 * a check rather than a note. `/demo` has carried
 * `tabIndex / role="region" / aria-label` since the 2026-08-13 sweep, with a
 * comment naming this exact axe rule — and the three tables written after it
 * were written without. That is the shape this directory exists for: a guard
 * that lives in somebody's memory is a guard on somebody's memory.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 * scrolling introduced from CSS rather than a utility class, and vertical
 * regions (`overflow-y-auto`), which are rarer here and whose keyboard story is
 * usually carried by the focusable content inside them. Both would need the
 * rendered tree, which is what `scripts/a11y-audit.mjs` is for. This is the
 * cheap half that runs on every push.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Utility classes that make a box scroll horizontally. */
const SCROLLS = /\boverflow-x-auto\b|\boverflow-x-scroll\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export interface Region {
  file: string;
  line: number;
  snippet: string;
  focusable: boolean;
  named: boolean;
}

/**
 * Finds each element bearing a horizontal-scroll class and reads the attributes
 * on the SAME element.
 *
 * The element is taken as the text from its opening `<` to the matching `>`,
 * which is what makes "on the same element" meaningful: a `tabIndex` on the
 * table INSIDE the scroll container does not make the container reachable, and a
 * check that searched nearby lines would accept it. Multi-line JSX is the normal
 * shape here, so the scan is over the whole file rather than line by line.
 */
export function scrollableRegions(dir: string = SRC): Region[] {
  const found: Region[] = [];
  for (const file of walk(dir)) {
    if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
    const src = readFileSync(file, 'utf8');

    for (const m of src.matchAll(/<[a-zA-Z][^<>]*>/gs)) {
      const tag = m[0];
      if (!SCROLLS.test(tag)) continue;
      found.push({
        file: file.replace(/\\/g, '/').slice(file.replace(/\\/g, '/').indexOf('/src/')),
        line: src.slice(0, m.index).split('\n').length,
        snippet: tag.replace(/\s+/g, ' ').slice(0, 90),
        focusable: /\btabIndex=\{?\s*(0|-?\d+)/.test(tag),
        named: /\baria-label=|\baria-labelledby=/.test(tag),
      });
    }
  }
  return found;
}

describe('horizontally scrollable regions are keyboard-reachable', () => {
  const regions = scrollableRegions();

  it('finds regions at all — a silent zero would pass vacuously', () => {
    // The failure mode of a filesystem check is finding nothing and calling it
    // success. There are several of these in the product by design.
    expect(regions.length).toBeGreaterThanOrEqual(4);
  });

  it('every one can be focused, so a keyboard can scroll it', () => {
    const stranded = regions
      .filter((r) => !r.focusable)
      .map((r) => `${r.file}:${r.line}  ${r.snippet}`);
    expect(
      stranded,
      'these scroll but cannot be focused — visible content unreachable without a pointer (WCAG 2.1.1)',
    ).toEqual([]);
  });

  /*
    A FOCUS STOP THAT ANNOUNCES NOTHING IS ITS OWN DEFECT. `tabIndex={0}` alone
    satisfies axe, and leaves a screen-reader user landing somewhere with no
    idea what they have stopped on or why. The name is the half that makes the
    focus stop worth having, so it is required here rather than left to taste.
  */
  it('every one says what it is when focus lands on it', () => {
    const anonymous = regions
      .filter((r) => r.focusable && !r.named)
      .map((r) => `${r.file}:${r.line}  ${r.snippet}`);
    expect(anonymous, 'focusable but unnamed — focus lands somewhere unexplained').toEqual([]);
  });

  describe('and it can fail — proven, not assumed', () => {
    const parse = (jsx: string) => {
      const tag = /<[a-zA-Z][^<>]*>/s.exec(jsx)![0];
      return {
        focusable: /\btabIndex=\{?\s*(0|-?\d+)/.test(tag),
        named: /\baria-label=|\baria-labelledby=/.test(tag),
      };
    };

    it('rejects a scroll container with no tabIndex', () => {
      expect(parse('<div className="overflow-x-auto rounded">').focusable).toBe(false);
    });

    it('accepts one carrying both attributes', () => {
      const r = parse('<div className="overflow-x-auto" tabIndex={0} role="region" aria-label="X">');
      expect(r.focusable && r.named).toBe(true);
    });

    /*
      The false pass this check is shaped to avoid: attributes on the table
      INSIDE the container do not make the CONTAINER reachable, and reading
      "nearby text" instead of the element would have accepted it.
    */
    it('does not accept a tabIndex that sits on a different element', () => {
      const jsx = '<div className="overflow-x-auto">\n  <table tabIndex={0} aria-label="X">';
      expect(parse(jsx).focusable).toBe(false);
    });
  });
});
