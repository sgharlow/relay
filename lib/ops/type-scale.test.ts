/**
 * No page invents a tenth step.
 *
 * `tailwind.config.ts` states the rule and nothing enforced it: semantic names
 * rather than a numeric ramp, "because a ramp invites picking a shade, which is
 * how the app ended up with eight H1 sizes and fourteen greys." The nine steps
 * t1–t9 are the type axis of that, and PROJECT.yaml carried the gap as
 * `type-scale-ratchet` — "a rule with no test".
 *
 * 🔴 THE DEFERRAL RECORDED "~9 arbitrary font sizes". The real number, measured
 * 2026-08-15, was 211 across 30 files. Two things had gone wrong: the count had
 * only ever looked at `text-[17px]`-style classes and non-token `fontSize:`
 * values, and nobody had counted the inline literals, which were the larger half.
 * A debt item whose size is wrong by an order of magnitude is not a debt item —
 * it is a wrong belief with a ticket number.
 *
 * WHY THEY WERE MIGRATED RATHER THAN CEILINGED. The deferral's reasoning was
 * "every value in use was audited readable", and that was true at the DEFAULT
 * font size and beside the point at any other. Measured in a real browser on
 * /security with the root raised to 20px, the way a reader who enlarged their
 * text has it: every rem token scaled (16→20, 14→17.5, 48→60) and every px
 * literal did not (17px stayed 17px, 15px stayed 15px). Twenty-one elements on
 * that page alone were frozen against the reader's own accessibility setting, on
 * a product whose access mode exists for people reading under stress. That is a
 * CC8 defect, not tidiness, and it is why this ended up a migration.
 *
 * Ties went to each mode's own ratified floor — access up to t4 (18), owner down
 * to t3 (16) — rather than uniformly up, because globals.css specifies both
 * ("owner body floor: 16. Never lower." / "access body floor: 18") and rounding
 * everything up would have quietly re-specified owner mode as it went.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { offScaleFontSizes } from './type-scale';

/**
 * The only files allowed an off-scale size, and why.
 *
 * BOTH ARE ERROR BOUNDARIES THAT MUST NOT DEPEND ON THE TOKEN PIPELINE. They
 * render because something already failed, and `global-error.tsx` replaces the
 * root `<html>` and `<body>` outright — `var(--t4)` there resolves to nothing,
 * so the declaration is dropped and the text falls back to whatever the UA says.
 * A fallback that depends on the thing that just broke is not a fallback.
 *
 * A codemod DID rewrite both of these on 2026-08-15 and it was wrong to; the
 * change was reverted the same hour, on the strength of the headers those two
 * files already carried. That is what this entry is here to prevent next time.
 */
const EXEMPT: Record<string, { count: number; why: string }> = {
  'src/app/error.tsx': {
    count: 7,
    why:
      'Renders because something already failed, so it must not depend on the ' +
      'stylesheet or the token pipeline that may be part of what broke. Its own ' +
      'header says so, and names the same reason raw-color.test.ts exempts its ' +
      'hex literals.',
  },
  'src/app/global-error.tsx': {
    count: 4,
    why:
      'Next replaces <html> and <body> here, so the root layout — and every CSS ' +
      'variable it provides — is absent by construction. A var(--tN) in this file ' +
      'resolves to nothing and the size silently becomes the browser default.',
  },
};

describe('font sizes stay on the nine-step scale', () => {
  it('no file outside the two error boundaries uses an off-scale size', () => {
    const found = offScaleFontSizes('.');
    const over = Object.entries(found)
      .filter(([f, n]) => n > (EXEMPT[f]?.count ?? 0))
      .map(([f, n]) => `${f}: ${n} (allowed ${EXEMPT[f]?.count ?? 0})`);

    expect(
      over,
      'Off-scale font sizes. Use t1–t9 — `text-t3` in a className, or ' +
        "`fontSize: 'var(--t3)'` inline. A px literal ignores the reader's own " +
        'browser text size, which is measurable: at a 20px root every rem token ' +
        'scales and every px literal does not. If a literal is genuinely ' +
        'unavoidable, add the file to EXEMPT here with the reason, in the same ' +
        'commit.',
    ).toEqual([]);
  });

  it('the exemptions are current, so this is still a ratchet', () => {
    const found = offScaleFontSizes('.');
    const stale = Object.entries(EXEMPT)
      .filter(([f, e]) => (found[f] ?? 0) < e.count)
      .map(([f, e]) => `${f}: allowed ${e.count}, actual ${found[f] ?? 0}`);

    expect(
      stale,
      'A file now has FEWER off-scale sizes than it is allowed. Lower the number ' +
        'here to lock the improvement in — left alone, the allowance silently ' +
        're-permits what was just removed.',
    ).toEqual([]);
  });

  it('every exemption argues for itself', () => {
    for (const [f, e] of Object.entries(EXEMPT)) {
      expect(e.why.length, `${f} needs a real reason, not a placeholder`).toBeGreaterThan(60);
      expect(() => readFileSync(f, 'utf8'), `${f} is exempt but gone`).not.toThrow();
    }
  });

  /*
    🔴 THE CHECK MUST BE ABLE TO FAIL — and this one already failed silently
    once. The first version of `offScaleFontSizes` excluded tokens with a
    negative lookahead, `fontSize:\s*(?!['"]?var\(--t[1-9]\))`, which looks
    right and is not: `\s*` backtracks to zero width, the lookahead is then
    tested against the SPACE, `var(` does not match ` va`, and the negative
    lookahead succeeds on exactly the values it was written to exclude. It
    reported 388 violations, most of them `fontSize: 'var(--t3)'`.

    Ceilings set from that number would have permitted three hundred real
    violations while looking like a working ratchet. So both directions are
    pinned: a token must not be counted, and a literal must be.
  */
  it('does not count a value that IS on the scale', () => {
    const src = "<p style={{ fontSize: 'var(--t3)', margin: 0 }}>x</p>";
    expect(countIn(src)).toBe(0);
    expect(countIn('<p className="text-t3 text-muted">x</p>')).toBe(0);
  });

  it('counts every way of leaving the scale', () => {
    expect(countIn('style={{ fontSize: 17 }}')).toBe(1);
    expect(countIn("style={{ fontSize: '17px' }}")).toBe(1);
    expect(countIn('className="text-[17px]"')).toBe(1);
    // Tailwind's OWN default ramp: the numeric ramp the config refused, wearing
    // the clothes of the one it chose. Nothing in src uses it today.
    expect(countIn('className="text-sm"')).toBe(1);
    expect(countIn('className="text-2xl"')).toBe(1);
  });
});

/**
 * Runs the real patterns over a string, so the two tests above exercise the
 * module's actual matching rather than a copy of it.
 */
function countIn(src: string): number {
  const root = mkdtempSync(join(tmpdir(), 'relay-typescale-'));
  try {
    mkdirSync(join(root, 'src', 'app'), { recursive: true });
    writeFileSync(join(root, 'src', 'app', 'probe.tsx'), src, 'utf8');
    return offScaleFontSizes(root)['src/app/probe.tsx'] ?? 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
