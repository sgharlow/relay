/**
 * Font sizes that are not on the nine-step scale.
 *
 * THE RULE WITH NO TEST. `tailwind.config.ts` says it deliberately: semantic
 * names rather than a numeric ramp, "because a ramp invites picking a shade,
 * which is how the app ended up with eight H1 sizes and fourteen greys. If a
 * name is missing, that is a prompt to ask what job the colour does, not to add
 * another step." The nine steps `t1`–`t9` are the type equivalent, and "no page
 * may invent a tenth step" was policy that nothing enforced — so pages invented
 * tenth steps, which is what `raw-color.test.ts` was written about one axis over.
 *
 * A RATCHET, NOT A BAN, for the same reason as raw colours: every value in use
 * was audited readable, and a bulk re-size of the least-tested mode is the exact
 * sweeping visual change that gets shipped and then quietly breaks something.
 * Stop the growth; migrate a file at a time and lower its number.
 *
 * THREE WAYS TO LEAVE THE SCALE, all counted:
 *   - `fontSize: 17` or `fontSize: '17px'` in an inline style;
 *   - `text-[17px]`, Tailwind's arbitrary-value escape hatch;
 *   - `text-sm` / `text-lg` / `text-2xl`, Tailwind's OWN default ramp, which is
 *     the sneakiest of the three. It looks like using the design system and is
 *     the numeric ramp the config explicitly refused.
 *
 * `fontSize: 'var(--t3)'` is ON the scale and is not counted — the boundary
 * screens use inline styles deliberately (they render because something already
 * failed and must not depend on the token pipeline) and that is fine as long as
 * the value is a token.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BACKSLASH = String.fromCharCode(92);

/**
 * Every inline `fontSize:` and its value. Whether the value is on the scale is
 * decided in code below, NOT by a lookahead in this pattern.
 *
 * 🔴 THE LOOKAHEAD VERSION SILENTLY COUNTED EVERYTHING. It read
 * `fontSize:\s*(?!['"]?var\(--t[1-9]\))…`, which looks right and is not: `\s*`
 * backtracks to zero width, the lookahead is then evaluated against the SPACE
 * rather than the value, `var(` does not match ` va`, and the negative
 * lookahead therefore succeeds on exactly the tokens it was written to exclude.
 * It reported 388 off-scale sizes across 60 files, most of them
 * `fontSize: 'var(--t3)'`. A ratchet whose ceilings were set from that number
 * would have permitted 300-odd real violations on day one — which is worse than
 * no ratchet, because it would have looked like one.
 */
const INLINE_FONT_SIZE = /fontSize:\s*([^,}\n]+)/g;

/** A value that IS a step: `'var(--t3)'`, `"var(--t7)"`, `var(--t1)`. */
const ON_SCALE_VALUE = /^['"`]?var\(--t[1-9]\)['"`]?$/;

/** Tailwind's arbitrary-value escape hatch: `text-[17px]`, `text-[1.05rem]`. */
const ARBITRARY_CLASS = /\btext-\[[0-9.]+(?:px|rem|em)\]/g;

/**
 * Tailwind's own default ramp. Counted because it is the numeric ramp the
 * design system refused, wearing the clothes of the one it chose.
 *
 * `text-base` is included: it is a size, and a page that says `text-base`
 * has opted out of saying which of t1–t9 it means.
 */
const DEFAULT_RAMP = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

/**
 * Off-scale font sizes per file. Files with none are absent.
 *
 * `opengraph-image.tsx` is exempt for the same reason `raw-color.test.ts`
 * exempts it: Satori renders the social card and resolves no CSS variables, so
 * a literal is the only thing that can work there.
 */
export function offScaleFontSizes(repoRoot = '.'): Record<string, number> {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');

  const found: Record<string, number> = {};
  for (const abs of walk(join(repoRoot, 'src'))) {
    const f = rel(abs);
    if (!/\.tsx$/.test(f) || f.includes('.test.')) continue;
    if (/opengraph-image\.tsx$/.test(f)) continue;

    const src = readFileSync(abs, 'utf8');

    let inline = 0;
    for (const m of src.matchAll(INLINE_FONT_SIZE)) {
      if (!ON_SCALE_VALUE.test(m[1].trim())) inline += 1;
    }

    const n =
      inline + (src.match(ARBITRARY_CLASS) || []).length + (src.match(DEFAULT_RAMP) || []).length;

    if (n > 0) found[f] = n;
  }
  return found;
}
