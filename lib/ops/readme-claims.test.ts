/**
 * The README does not hardcode a number that moves.
 *
 * 🔴 IT CLAIMED "28 API ROUTES" AND THERE WERE 75, found 2026-08-15. Not a
 * rounding drift — less than half — in the one document a stranger reads before
 * anything else, on a repo whose own PROJECT.yaml opens with "single source of
 * truth for volatile facts ... prose docs reference this file, they never
 * restate its values."
 *
 * The rule was already written down and already enforced elsewhere:
 * `guide-claims.test.ts` pins the printed guide against `TIER_LIMITS`,
 * `journey-state.test.ts` fails when `user-journeys.md` contradicts
 * `PROJECT.yaml`. The README had no such tether, so it drifted quietly for as
 * long as it took somebody to count.
 *
 * WHAT THIS ASSERTS is deliberately narrow: that the README does not state a
 * countable fact about this codebase as a literal. It cannot check prose for
 * truth, and pretending otherwise would be worse than the gap — a test that
 * looks like it verifies the README is how the next wrong sentence survives
 * review. The test count is exempt because the README labels its number as a
 * historical submission figure and tells the reader to re-derive.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const README = readFileSync('README.md', 'utf8');

function countFiles(dir: string, name: string): number {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countFiles(p, name);
    else if (entry === name) n += 1;
  }
  return n;
}

describe('the README states no countable fact as a literal', () => {
  it('does not hardcode an API-route count', () => {
    const claim = README.match(/(\d+)\s*(?:\*\*\s*)?API routes/i);
    expect(
      claim?.[0],
      claim
        ? `README claims "${claim[0]}" and the real count is ${countFiles('src/app/api', 'route.ts')}. ` +
          'State the derivation, not the number — PROJECT.yaml → derived.api_routes ' +
          'holds the command.'
        : 'ok',
    ).toBeUndefined();
  });

  it('does not hardcode a page count', () => {
    expect(README.match(/(\d+)\s*(?:\*\*\s*)?(?:pages|screens) built/i)?.[0]).toBeUndefined();
  });

  /*
    The number that IS allowed, because it is labelled as history rather than as
    the current state and the sentence tells the reader to re-derive. Pinned so
    that removing the instruction turns it back into a drifting claim.
  */
  it('keeps the re-derive instruction beside the historical test count', () => {
    expect(README).toMatch(/405 at submission; run for the live count/);
    expect(README).toMatch(/run `npx vitest --run` for the live count/);
  });

  /*
    The correction itself is kept in the file. A silently-fixed number teaches
    nobody why the rule exists, and this repo's convention is to record the wrong
    belief next to the right one.

    It is worded WITHOUT repeating the old figure, and that is not squeamishness:
    the first draft said `used to claim "28 API routes"` and the check above
    failed on it, because a scanner cannot tell a claim from a confession of one.
    Proof the check can fail, obtained by accident and kept on purpose.
  */
  it('records why the counts became commands', () => {
    expect(README).toMatch(/used to hardcode the route count/);
    expect(README).toMatch(/PROJECT\.yaml.*derived/s);
  });
});
