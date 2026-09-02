/**
 * G4 and G5 mean ONE thing each now — this guard keeps it that way.
 *
 * HISTORY, because the collision this file used to pin is the reason it exists.
 * Found 2026-08-31 (Sprint 8): §2-G row G4 said *Mobile*, row G5 said *provider
 * handoff + residency*, while G8 three rows later said "draft G4 (billing MVP)
 * and G5 (audited crypto) as `gates:` entries" — the same table naming the same
 * ids twice, differently, with G8 an instruction to write into the register.
 * The first version of this file pinned that collision as a fact and armed the
 * moment a `gates.g4*`/`g5*` entry appeared, so it could not be committed
 * silently.
 *
 * ✅ RULED 2026-09-01 (Steve, co-pilot sitting): **G8's reading won.** G4 =
 * billing MVP, G5 = audited crypto; Mobile moved to G12, provider handoff and
 * residency to G13. Recorded in `PROJECT.yaml →
 * deferred.g4-and-g5-name-two-different-things.closed`.
 *
 * WHAT THIS FILE DOES NOW. The inverse of what it did: it asserts the three
 * places these names carry weight — the §2-G rows, G8's parentheticals, and
 * §1's ladder chain — all AGREE, and that any `gates.g4*`/`g5*` entry that
 * appears when G8 finally executes (on G1 pass) carries the ruled meaning.
 * A rename in any one place without the others is the drift this catches.
 *
 * Feature: relay-h0-mvp
 * Requirements: G8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const ROADMAP = readFileSync('ROADMAP.md', 'utf8');
const REGISTER = parse(readFileSync('PROJECT.yaml', 'utf8')) as {
  gates?: { id?: string; what?: string }[];
};

/** The ruled meanings. Change these ONLY with a recorded ruling. */
const RULED: Record<string, string> = {
  G4: 'billing mvp',
  G5: 'audited crypto',
};

/** The §2-G row for a given G-lane id, as one line of text. */
function gLaneRow(id: string): string | null {
  const m = new RegExp(`^\\| \\*{0,2}${id}\\*{0,2}(?: NEW)? \\|(.*)$`, 'm').exec(ROADMAP);
  return m ? m[1] : null;
}

/** What G8's own text says G4 and G5 are, read out of its parentheticals. */
function g8Parenthetical(id: string): string | null {
  const row = gLaneRow('G8');
  if (!row) return null;
  const m = new RegExp(`${id}\\s*\\(([^)]+)\\)`).exec(row);
  return m ? m[1].trim() : null;
}

const gatesWithId = (prefix: string): { id: string; what: string }[] =>
  (REGISTER.gates ?? [])
    .map((g) => ({ id: g.id ?? '', what: g.what ?? '' }))
    .filter(({ id }) => new RegExp(`^${prefix}\\b|^${prefix}-`).test(id));

describe('the G-lane names, post-ruling', () => {
  it('finds the rows at all, so this guard is not vacuous', () => {
    for (const id of ['G4', 'G5', 'G8', 'G12', 'G13']) {
      expect(gLaneRow(id), `ROADMAP.md §2-G no longer has a ${id} row this can read`).toBeTruthy();
    }
  });

  it('every place that names G4/G5 agrees with the 2026-09-01 ruling', () => {
    for (const id of ['G4', 'G5'] as const) {
      const row = (gLaneRow(id) ?? '').toLowerCase();
      const inG8 = (g8Parenthetical(id) ?? '').toLowerCase();
      expect(
        row.includes(RULED[id]),
        `§2-G row ${id} no longer says "${RULED[id]}" — a rename without a recorded ruling is the ` +
          'drift this file exists to catch. If a NEW ruling changed it, update RULED here in the ' +
          'same commit and record it in the register.',
      ).toBe(true);
      expect(
        inG8.includes(RULED[id]),
        `G8's parenthetical for ${id} ("${inG8}") drifted from the ruled meaning "${RULED[id]}"`,
      ).toBe(true);
    }
  });

  it('the displaced meanings survived the move — G12 is Mobile, G13 is provider handoff', () => {
    // The ruling moved content, it did not delete it. A lane that vanishes in a
    // rename is scope lost silently.
    expect((gLaneRow('G12') ?? '').toLowerCase()).toContain('mobile');
    expect((gLaneRow('G13') ?? '').toLowerCase()).toContain('provider handoff');
  });

  it("§1's ladder chain still agrees with the ruled names", () => {
    const chain = /G1 ∥ G3 → G4 ([^→]+) → G5 ([^;]+);/.exec(ROADMAP);
    expect(chain, "§1's ladder chain no longer names G4 and G5 in a shape this can read").toBeTruthy();
    expect(chain![1].trim().toLowerCase()).toContain(RULED.G4);
    expect(chain![2].trim().toLowerCase()).toContain(RULED.G5);
  });

  it('a gates.g4*/g5* entry, when G8 finally executes, carries the ruled meaning', () => {
    /*
      Dormant until G1 passes and G8 runs. Then: the entry's id or `what` must
      name the ruled meaning, so the register can never hold a g4 that means
      Mobile. An empty list is the correct state today — G8 is event-gated and
      only its ambiguity was resolved early.
    */
    for (const id of ['G4', 'G5'] as const) {
      for (const g of gatesWithId(id.toLowerCase())) {
        const text = `${g.id} ${g.what}`.toLowerCase();
        expect(
          text.includes(RULED[id].replace(' ', '-')) || text.includes(RULED[id]),
          `Register gate "${g.id}" exists but does not carry the ruled ${id} meaning ` +
            `("${RULED[id]}"). The 2026-09-01 ruling is what makes this entry legal at all — ` +
            'an entry that drifts from it recreates the collision inside the register.',
        ).toBe(true);
      }
    }
  });
});
