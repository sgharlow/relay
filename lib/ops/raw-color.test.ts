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
  'src/app/error.tsx': 9,
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
