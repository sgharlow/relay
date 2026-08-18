/**
 * A lane ratified as RUNNING is a lane something schedules.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FROM, found by the 2026-08-18 reassessment.
 * On 2026-08-16 Steve ratified that G3 — the B2B2C pilot — runs IN PARALLEL with
 * G1 rather than after it. The ruling is recorded three times in PROJECT.yaml:
 * in the `gates:` header comment, in `ratified.retire-paid-advertising`'s
 * `chain_change`, and in g1-arms-length-demand's list of routes that might
 * produce the first arms-length person. All three are prose. For two days
 * `gates:` itself held only G1 and the closed G2, so the half of the strategy
 * that had just been promoted to "running now" had no metric, no target, no
 * owner and no date — and nothing that reads this file for open work could see
 * it at all.
 *
 * That is the failure the `gates:` header names in its own words: a lane can
 * stop being SCHEDULED silently, which is worse than being blocked, because
 * blocked is visible. It got there from the opposite direction the header
 * describes — not a dead precondition, but a live ruling nobody transcribed.
 *
 * So the convention 'when you ratify a lane, add its gate' becomes a structure:
 * the amendment text and the gate entry now fail together or stand together.
 * Structural safety over convention (global CLAUDE.md, 2026-07-05 retrospective).
 *
 * Feature: relay-h0-mvp
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROJECT = readFileSync('PROJECT.yaml', 'utf8');

/** Gate ids, read textually — same approach and same reasons as gates.test.ts. */
function gateIds(): string[] {
  const section = /^gates:\n([\s\S]*?)\n(?=[a-z_]+:)/m.exec(PROJECT);
  if (!section) throw new Error('PROJECT.yaml has no gates: section — that is itself the finding');
  return [...section[1].matchAll(/^\s{2}- id:\s*(\S+)/gm)].map((m) => m[1]);
}

describe('a ratified parallel lane has a gate', () => {
  /*
    Anchored POSITIVELY on the amendment. If the amendment is ever withdrawn the
    anchor disappears and this check retires itself, which is correct: it exists
    to hold the file to a ruling, not to require a gate forever. If the ruling
    stands, the gate must.
  */
  it('G3 is ratified as running in parallel, so a g3 gate exists', () => {
    const amended = /G3 NOW RUNS IN PARALLEL WITH G1/.test(PROJECT);
    if (!amended) return; // the ruling was withdrawn; nothing to enforce

    expect(
      gateIds().filter((id) => id.startsWith('g3-')),
      'PROJECT.yaml says G3 runs in parallel with G1, and `gates:` has no g3 entry. ' +
        'A lane ratified as running now needs a metric, a target, a kill, an owner and a date ' +
        'in the gates section — prose in a comment is not a schedule, and nothing that reads ' +
        'this file for open work can see it.',
    ).not.toHaveLength(0);
  });

  /*
    The second half of the same idea. A gate proposed by me rather than ruled on
    by Steve must SAY so, or it reads as ratified the moment the drafting session
    ends — the failure mode the threshold proposal was kept in a separate
    document to avoid. Whichever way it is resolved, the marker goes away with it.
  */
  it('a gate carrying PROPOSED names an owner and a date to decide by', () => {
    const section = /^gates:\n([\s\S]*?)\n(?=[a-z_]+:)/m.exec(PROJECT)![1];
    for (const block of section.split(/^\s{2}- id:\s*/m).slice(1)) {
      if (!/^\s{4}status:\s*"PROPOSED/m.test(block)) continue;
      const id = block.split('\n')[0].trim();
      expect(/^\s{4}owner:\s*\S/m.test(block), `${id} is PROPOSED with no owner to rule on it`).toBe(true);
      expect(
        /^\s{4}ratify_by:\s*"?\d{4}-\d{2}-\d{2}/m.test(block),
        `${id} is PROPOSED with no ratify_by: date. A draft nobody has to decide by is the ` +
          'silence it was written to end, wearing a different label.',
      ).toBe(true);
    }
  });
});
