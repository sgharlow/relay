/**
 * Hardcoded colours, frozen where they are.
 *
 * 🔴 THE DESIGN SYSTEM HAS A HOLE THE CONTRAST TEST CANNOT SEE.
 * `lib/ops/contrast.test.ts` reads the token declarations in globals.css and
 * proves the palette clears WCAG AA. It says nothing about a component that
 * writes `color: '#6b6257'` inline, because that value never appears in the
 * file it reads. The pre-release audit on 2026-08-13 counted 134 such values,
 * concentrated in `(access)/*` — the mode CC8 names as the accessibility-
 * critical one, and the mode the a11y script did not visit either. Between the
 * two checks, the colours that matter most were covered by neither.
 *
 * THIS IS A RATCHET, NOT A BAN. Every pair actually in use was computed during
 * the audit and they all pass — the lowest is 5.41:1 against a 4.5:1 floor. So
 * there is no defect to fix here, and a bulk migration to tokens before beta
 * would be a sweeping visual change to the least-tested mode in the product:
 * the single edit most likely to break something that currently works. The
 * right move is to stop the growth, ship, and migrate afterwards with the axe
 * run (now covering these pages) as the safety net.
 *
 * TO MIGRATE A FILE: replace its literals with tokens and LOWER its number
 * here. The test fails if a count goes up, and also if it goes down without
 * being updated — a stale ceiling is a ratchet that has stopped ratcheting.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
  Borrowed rather than re-implemented: a comment DESCRIBING the defect must not
  be reported as the defect, which is the same reason body-limit.ts strips
  before matching — and this file now carries several such comments.
*/
import { stripComments } from './body-limit';

/**
 * Exact literal counts as of 2026-08-13. A file absent from this map must have
 * none at all.
 *
 * `opengraph-image.tsx` files are exempt below and deliberately not listed:
 * they render a static social card through Satori, which resolves no CSS
 * variables, so a literal is the only thing that can work there.
 */
const CEILING: Record<string, number> = {
  'src/app/(access)/helping/HelpingClient.tsx': 26,
  'src/app/(access)/standby/StandbyClient.tsx': 21,
  'src/app/(access)/standby/AskControl.tsx': 14,
  'src/app/(access)/break-glass/BreakGlassClient.tsx': 10,
  'src/app/(access)/standby/StandbyPasskeyCard.tsx': 10,
  // 9 → 6 on 2026-08-13. Adding the /help link would have made it 11; the
  // literals are now named once in a local palette instead. The inline styles
  // stay — this boundary renders because something already failed and must not
  // depend on the token pipeline — but each value is spelled out exactly once.
  'src/app/error.tsx': 6,
  'src/app/(access)/standby/LeaveControl.tsx': 7,
  'src/app/global-error.tsx': 5,
  'src/app/not-found.tsx': 5,
  'src/app/(access)/standby/HelpingCard.tsx': 4,
  'src/app/(access)/standby/page.tsx': 2,
  'src/app/(owner)/circle/PeopleSections.tsx': 2,
  'src/app/(access)/access/AccessClient.tsx': 1,
  'src/app/(access)/break-glass/page.tsx': 1,
  'src/app/(access)/helping/page.tsx': 1,
};
// 118 across 15 files. Twelve of the fifteen are (access) — which is the whole
// point: the mode CC8 is written about is the mode that opted out of the
// palette. Migrating them is post-beta work, tracked by this ceiling going down.

const HEX = /#[0-9a-fA-F]{6}\b/g;
const BACKSLASH = String.fromCharCode(92);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

function counts(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const f of walk('src')) {
    if (!/\.tsx$/.test(f) || f.includes('.test.')) continue;
    // Satori cannot resolve CSS variables — see the note on CEILING.
    if (/opengraph-image\.tsx$/.test(f)) continue;
    const n = (readFileSync(f, 'utf8').match(HEX) || []).length;
    if (n > 0) found[f] = n;
  }
  return found;
}

/**
 * An opacity modifier on a token colour produces NOTHING, silently.
 *
 * 🔴 THE STEP-UP DIALOG SHIPPED WITH NO BACKDROP, found 2026-08-15 by looking at
 * a screenshot of it. It asked for `bg-ink/40`. Every colour in
 * tailwind.config.ts is `var(--x)` resolving to a hex, and Tailwind cannot split
 * a hex behind a variable into channels, so `bg-ink/40` compiles to a
 * background-color of `rgba(0, 0, 0, 0)` — measured in the browser, not
 * reasoned about. Fully transparent.
 *
 * WHAT MAKES IT WORTH A TEST rather than a note: nothing fails. The class name
 * is valid, the build passes, the element exists, and the only symptom is a
 * modal that does not dim the page behind it — which reads as a design choice
 * to anyone who did not write it. The same silent shape as `bg-ink/10` for a
 * subtle wash, or `border-rule/50` for a hairline: all of them vanish.
 *
 * The fix is a token that carries its own alpha (`--scrim`), and the rule is
 * that alpha belongs IN the token, never in a modifier.
 */
describe('opacity modifiers are never applied to token colours', () => {
  const TOKENS = [
    'paper', 'paper-raised', 'paper-sunken', 'ink', 'muted', 'faint', 'rule', 'rule-strong',
    'sage', 'sage-text', 'sage-soft', 'ochre', 'ochre-text', 'ochre-soft', 'clay', 'clay-soft',
    'scrim', 'background', 'foreground',
  ];
  const MODIFIED = new RegExp(
    `\\b(?:bg|text|border|ring|divide|from|to|via|shadow|outline)-(?:${TOKENS.join('|')})/\\d+`,
    'g',
  );

  it('no component asks for a token colour at partial opacity', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      if (!/\.tsx$/.test(f) || f.includes('.test.')) continue;
      for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(MODIFIED)) {
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      offenders.length
        ? 'These compile to a fully transparent colour, silently:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\nEvery colour in tailwind.config.ts is a CSS variable holding a hex, ' +
          'and Tailwind cannot apply an opacity modifier to one. Add a token that ' +
          'carries its own alpha — see --scrim in globals.css — and use it whole.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    The fix itself, pinned. A scrim that stopped carrying alpha would dim the
    page to solid and hide it entirely, which is a different bug in the same
    place.
  */
  it('the scrim token carries its own alpha', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const m = css.match(/--scrim:\s*([^;]+);/);
    expect(m?.[1], '--scrim must be declared').toBeDefined();
    expect(m?.[1]).toMatch(/rgba?\([^)]*[\d.]+\s*\)/);
    const alpha = Number(/,\s*([\d.]+)\s*\)/.exec(m?.[1] ?? '')?.[1] ?? NaN);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('hardcoded colours do not spread', () => {
  it('no file exceeds its recorded count, and no new file introduces any', () => {
    const found = counts();
    const over = Object.entries(found)
      .filter(([f, n]) => n > (CEILING[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} (ceiling ${CEILING[f] ?? 0})`);

    expect(
      over,
      'New hardcoded colours. Use the tokens in src/app/globals.css instead — ' +
        'they are the only values lib/ops/contrast.test.ts can verify, and a ' +
        'literal is invisible to it. If a literal is genuinely unavoidable, ' +
        'raise the ceiling here and say why in the same commit.',
    ).toEqual([]);
  });

  it('the ceilings are current, so this is still a ratchet', () => {
    const found = counts();
    const stale = Object.entries(CEILING)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ceiling ${n}, actual ${found[f] ?? 0}`);

    expect(
      stale,
      'A file now has FEWER hardcoded colours than its ceiling allows. Good — ' +
        'lower the number here to lock the improvement in. Left alone, the ' +
        'ceiling silently re-permits what was just removed.',
    ).toEqual([]);
  });
});
