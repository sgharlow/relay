/**
 * The owner side of a 401 needs a door, not only a better sentence.
 *
 * 🔴 `signInHref` WAS BUILT AND WIRED TO NOTHING. It was added on 2026-08-21 as
 * part of the owner 401 fix — "Added signInHref(path) with a callbackUrl" — and
 * the only two places it appeared were its own definition and its own test. No
 * owner screen rendered a link, so an owner returning to a tab left open past
 * the session still read a sentence with nothing to press: exactly the defect
 * the same change describes /standby and /helping being fixed for.
 *
 * The seam already tells a 401 apart from an outage (`SignedOutError`), and it
 * is the right place for that. The DOOR belongs on the one component that
 * renders on every owner screen: `ReadinessBanner` sits in the owner layout, and
 * it had the worse half of the same bug — it swallowed every non-2xx into
 * `setData(null)` and returned `null`, so the screen an owner was looking at
 * lost its standing status line and gained no explanation.
 *
 * Assertions read the source, in the shape of the (access) way-back guard: the
 * test environment is `node`, so a rendered branch cannot be exercised here, and
 * a guard over the file stays true of every branch rather than of one.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNER = 'src/app/(owner)/_components/ReadinessBanner.tsx';
const API = 'src/app/(owner)/_lib/api.ts';

const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const code = (file: string) => stripComments(readFileSync(file, 'utf8'));

/**
 * Every non-test source file under the owner route group, in POSIX form.
 *
 * ⚠️ THE SEPARATOR IS NOT COSMETIC. `join` returns backslashes on Windows, so
 * comparing against a hand-written 'src/app/(owner)/_lib/api.ts' silently
 * matched nothing and left api.ts — which contains the declaration — in the list
 * of "screens that call it". The first run of this guard passed on the very
 * defect it was written for, which is the third time that has happened in this
 * repo.
 */
function ownerFiles(dir = 'src/app/(owner)'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).split('\\').join('/');
    if (statSync(full).isDirectory()) out.push(...ownerFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the owner 401 has something to press', () => {
  it('signInHref is called by a screen, not only by its own test', () => {
    const callers = ownerFiles()
      .filter((f) => f !== API)
      .filter((f) => /signInHref\s*\(/.test(code(f)));
    expect(
      callers,
      `${API} exports signInHref and nothing renders it. A callbackUrl nobody can click is ` +
        'the same dead end the message was fixed for — the sentence improved, the door was ' +
        'never built.',
    ).not.toEqual([]);
  });

  it('the banner tells a signed-out session apart from a failure', () => {
    // It used to `.then((r) => (r.ok ? r.json() : null))` — a 401, a 500 and a
    // 404 all becoming "render nothing", on the component whose whole job is to
    // be believed about whether the plan works.
    expect(code(BANNER), `${BANNER} should branch on 401 rather than on r.ok alone`).toMatch(
      /status === 401/,
    );
  });

  it('the banner offers a sign-in link when the session has ended', () => {
    const src = code(BANNER);
    expect(src, 'the door must be built from signInHref, so the callbackUrl is validated').toMatch(
      /signInHref\(/,
    );
    // A link, not a sentence. `href={` rather than a bare string.
    expect(src).toMatch(/href=\{signInHref\(/);
  });

  it('does not send a signed-out owner away automatically', () => {
    /*
      A redirect from a client effect would throw away whatever the owner had
      typed on the screen behind it — and a session that ended mid-form is
      exactly when they have typed something. The door is offered, never walked
      through for them.
    */
    expect(code(BANNER)).not.toMatch(/window\.location\.(assign|href|replace)/);
    expect(code(BANNER)).not.toMatch(/router\.(push|replace)\(/);
  });
});
