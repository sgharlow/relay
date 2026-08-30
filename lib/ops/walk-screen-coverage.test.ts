/**
 * Which screens has a real browser actually driven?
 *
 * 🔴 WHY THIS EXISTS: THE ANSWER WAS REMEMBERED, AND THE MEMORY WAS WRONG THREE
 * TIMES IN ONE SESSION (2026-08-30). A readiness plan recorded that `e2e-ui.ts`
 * "covers two screens — the step-up dialog and the owner picker". That sentence
 * came from the file's own header, which describes why the walk was WRITTEN. By
 * then it drove four (`/account`, `/access`, `/vault`, `/circle`) and carried 35
 * checks; `/circle` was added on 2026-08-21 and the header was never re-read.
 * The same session then recorded that six circle components were untested when
 * `circle-surfaces.test.tsx` already covered them, and that a cluster decision
 * was outstanding when it had been ruled ten days earlier.
 *
 * All three are the same mistake: a fact about the repository, taken from prose
 * instead of from the repository. This turns one of them into a derivation.
 *
 * ⚠️ IT DOES NOT ASSERT FULL COVERAGE, and must not. Requiring every screen to
 * be walked would fail on the day it is written and stay failing, which is the
 * alarm-that-gets-muted shape this directory keeps finding. What it asserts is
 * that coverage does not silently SHRINK: a screen the walk drives today is a
 * screen it must still drive tomorrow, and the gap is printed so the number is
 * read rather than assumed.
 *
 * ⚠️ AND IT SAYS NOTHING ABOUT WHETHER THE WALK RAN. That is
 * `verify-live-freshness.test.ts`'s job — the stamp and its dead-man. This is
 * only about what the walk WOULD cover when something runs it. A screen listed
 * here and a screen proven are different claims, and the register's whole D4
 * entry exists because the second one has no schedule.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the walks half), CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WALK = 'scripts/e2e-ui.ts';
const APP = 'src/app';

/** Route groups whose screens a person meets while signed in, or under stress. */
const DRIVEN_GROUPS = ['(owner)', '(access)', '(verify)'];

/**
 * Every page route under the given group, as the URL path a browser would visit.
 * Route groups in parentheses do not appear in the URL, which is why they are
 * stripped rather than kept.
 */
function routesUnder(group: string): string[] {
  const root = join(APP, group);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, url: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        // Dynamic segments cannot be visited without a real id; the walk reaches
        // them through links, and asserting on them here would be asserting on a
        // URL nobody can type.
        if (e.name.startsWith('[')) continue;
        walk(join(dir, e.name), `${url}/${e.name}`);
      } else if (e.name === 'page.tsx') {
        out.push(url === '' ? '/' : url);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

const allScreens = DRIVEN_GROUPS.flatMap(routesUnder);

/**
 * Screens the walk navigates to, read from its `goto` calls.
 *
 * Textual, and conservative in the safe direction: a `goto` built from a
 * variable would be missed, which under-reports coverage. Under-reporting makes
 * the shrink check stricter, never blinder — the opposite of the
 * api-reachability false-positive trade, and the right way round for a list
 * whose failure mode is over-claiming.
 */
function screensDriven(src: string): string[] {
  const out = new Set<string>();
  for (const [, path] of src.matchAll(/goto\(\s*`\$\{BASE\}(\/[a-z0-9/-]*)`/gi)) {
    out.add(path === '' ? '/' : path);
  }
  return [...out].sort();
}

const walkSrc = readFileSync(WALK, 'utf8');
const driven = screensDriven(walkSrc);

/**
 * The screens driven as of 2026-08-30, after PART 5 was added.
 *
 * ⚠️ THIS LIST MAY GROW AND MUST NOT SHRINK. Removing a screen from the walk is
 * a deliberate act — it means giving up the only automated look this product
 * has at that screen's client state — so it should require editing this line
 * and saying why, not merely deleting a block.
 */
const COVERED_ON_2026_08_30 = ['/account', '/access', '/circle', '/triggers', '/vault'];

describe('the browser walk drives the screens it is recorded as driving', () => {
  it('finds screens and a walk at all, so this guard is not vacuous', () => {
    expect(allScreens.length).toBeGreaterThan(10);
    expect(driven.length).toBeGreaterThan(0);
  });

  it('still drives every screen it drove on 2026-08-30', () => {
    const lost = COVERED_ON_2026_08_30.filter((s) => !driven.includes(s));
    expect(
      lost,
      lost.length
        ? `${WALK} no longer drives:\n` +
          lost.map((s) => `  ${s}`).join('\n') +
          '\n\nThese are the only screens in this product a real browser ever visits. Dropping ' +
          'one gives up the only automated look at its client state — the class of defect the ' +
          'walk exists for, which every HTTP walk in both chains is blind to. If it was ' +
          'deliberate, update COVERED_ON_2026_08_30 in the same commit and say why.'
        : 'ok',
    ).toEqual([]);
  });

  it('reports the gap rather than asserting it away', () => {
    /*
      Printed, not failed. Full coverage is not the bar — a walk that visited
      every screen would take long enough that nobody runs it, and this walk is
      already the half of the release gate that depends on somebody remembering.
      What the number is for is that the next person to write "the walk covers N
      screens" can derive N instead of recalling it.
    */
    const gap = allScreens.filter((s) => !driven.includes(s));
    console.log(
      `\n  browser-walk screen coverage: ${driven.length}/${allScreens.length}` +
        `\n  driven:     ${driven.join(', ')}` +
        `\n  not driven: ${gap.join(', ')}\n`,
    );
    expect(driven.length).toBeGreaterThanOrEqual(COVERED_ON_2026_08_30.length);
  });

  it('drives at least one screen in access mode, which is read under stress', () => {
    /*
      CC8 names access mode specifically — the mode an elderly recipient reads
      during an emergency. The a11y job cannot audit it in CI (no database
      credentials to mint a session, `deferred.the-read-only-identity-is-not-in-
      the-cloud`), so the walk is the only automated thing that meets it.
    */
    const accessScreens = routesUnder('(access)');
    expect(
      driven.some((s) => accessScreens.includes(s)),
      'the walk drives no access-mode screen. That mode is read by somebody under acute ' +
        'stress, CC8 calls its accessibility a functional requirement, and CI cannot audit it ' +
        'because owner-mode sessions need credentials the runner does not hold.',
    ).toBe(true);
  });
});
