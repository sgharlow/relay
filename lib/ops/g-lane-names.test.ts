/**
 * G4 and G5 mean two different things in the same table, and G8 executes one of them.
 *
 * 🔴 FOUND 2026-08-31 (ROADMAP Sprint 8, item G8 — "G4 and G5 enter `PROJECT.yaml`").
 * `ROADMAP.md` §2-G defines the G-lane as rows. Two of them read:
 *
 *     | G4 | Mobile (§23) survives in rev 3 §2-G with no trigger … |
 *     | G5 | Provider handoff integrations + ingestion tiers 2–4; per-jurisdiction residency |
 *
 * Three rows later, in the same table:
 *
 *     | G8 | On G1 pass: draft G4 (billing MVP) and G5 (audited crypto) as `gates:` entries |
 *
 * and §1's ladder chain agrees with G8: *"G1 ∥ G3 → G4 billing MVP → G5 audited
 * crypto; G4/G5 enter PROJECT.yaml once G1 passes."*
 *
 * So **executing G8 as written creates `gates.g4` and `gates.g5` that contradict
 * the rows named G4 and G5 two lines above it** — permanently, in the register
 * that everything else defers to.
 *
 * ⚠️ WHICH READING IS RIGHT IS NOT CLAUDE'S TO DECIDE — it changes what gets
 * built. The evidence leans one way and is recorded rather than acted on: G2's
 * row says the security audit is *"G5, once G4 exists"*, which makes sense as
 * "audited crypto, once billing exists" and makes none as "provider handoff, once
 * mobile exists". That is an argument, not a ruling.
 *
 * WHAT THIS FILE DOES INSTEAD. It arms at the moment of danger. Today no
 * `gates.g4*`/`g5*` entry exists and this passes. The moment somebody executes
 * G8, it fails unless the two definitions have been reconciled first — so the
 * contradiction cannot be committed into the register silently. A ruling is
 * cheap now and expensive after `gates.g4` has been cited by three documents.
 *
 * This is the "one authoritative definition per cross-boundary contract" rule
 * from the portfolio playbook, applied inside a single file — which is where it
 * is easiest to violate, because nothing crosses a boundary to catch it.
 *
 * Feature: relay-h0-mvp
 * Requirements: G8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const ROADMAP = readFileSync('ROADMAP.md', 'utf8');
const REGISTER = parse(readFileSync('PROJECT.yaml', 'utf8')) as { gates?: { id?: string }[] };

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

const gatesWithId = (prefix: string): string[] =>
  (REGISTER.gates ?? []).map((g) => g.id ?? '').filter((id) => new RegExp(`^${prefix}\\b|^${prefix}-`).test(id));

describe('the G-lane names', () => {
  it('finds the rows at all, so this guard is not vacuous', () => {
    for (const id of ['G4', 'G5', 'G8']) {
      expect(gLaneRow(id), `ROADMAP.md §2-G no longer has a ${id} row this can read`).toBeTruthy();
    }
  });

  it('records the collision that exists today, so it cannot be quietly resolved by deletion', () => {
    /*
      Pinned as a FACT rather than asserted as a failure. If someone rewrites the
      G4 row to say "billing MVP", this test tells them the pin is stale and to
      update it deliberately — which is the moment the ruling gets recorded.
    */
    const g4 = gLaneRow('G4') ?? '';
    const g5 = gLaneRow('G5') ?? '';
    const g4InG8 = g8Parenthetical('G4');
    const g5InG8 = g8Parenthetical('G5');

    expect(g4InG8, 'G8 no longer says what it means by G4').toBeTruthy();
    expect(g5InG8, 'G8 no longer says what it means by G5').toBeTruthy();

    const stillCollides =
      !g4.toLowerCase().includes((g4InG8 ?? '').toLowerCase()) ||
      !g5.toLowerCase().includes((g5InG8 ?? '').toLowerCase());

    expect(
      stillCollides,
      'The G4/G5 collision recorded on 2026-08-31 appears to be RESOLVED — the §2-G rows now agree ' +
        `with G8's parentheticals (G4: "${g4InG8}", G5: "${g5InG8}").\n\n` +
        'If that was deliberate, delete this test and the register entry ' +
        '`g4-and-g5-name-two-different-things`, and record which reading won. If it was ' +
        'accidental, the two definitions have merged without anybody ruling — which is the drift ' +
        'this file exists to make visible.',
    ).toBe(true);
  });

  it('🔴 refuses a gates.g4/g5 entry while the two definitions disagree', () => {
    /*
      THE ONE THAT MATTERS. This is dormant today — no such gate exists — and it
      arms the instant G8 is executed. A contradiction committed into the register
      is expensive in a way the roadmap's own prose is not: `PROJECT.yaml` is what
      `gates.test.ts`, `date-guards` and every status read defer to.
    */
    const created = [...gatesWithId('g4'), ...gatesWithId('g5')];
    expect(
      created,
      created.length
        ? 'G8 has been executed — these gates now exist:\n' +
            created.map((g) => `  ${g}`).join('\n') +
            '\n\nBut ROADMAP.md §2-G still defines G4 and G5 as different things from what G8 ' +
            'says it is creating:\n' +
            `  row G4 : ${(gLaneRow('G4') ?? '').slice(0, 120)}\n` +
            `  row G5 : ${(gLaneRow('G5') ?? '').slice(0, 120)}\n` +
            `  G8 says: G4 (${g8Parenthetical('G4')}), G5 (${g8Parenthetical('G5')})\n\n` +
            'Reconcile the names in ROADMAP.md and record which reading won BEFORE the register ' +
            'carries both. See PROJECT.yaml deferred.g4-and-g5-name-two-different-things.'
        : 'ok',
    ).toEqual([]);
  });

  it('the ladder chain and G8 agree with each other, whatever the rows say', () => {
    // §1's chain is the other place these names carry weight. If IT drifts from
    // G8 too, there are three readings and no anchor at all.
    const chain = /G1 ∥ G3 → G4 ([^→]+) → G5 ([^;]+);/.exec(ROADMAP);
    expect(chain, "§1's ladder chain no longer names G4 and G5 in a shape this can read").toBeTruthy();
    expect(chain![1].trim().toLowerCase()).toContain(String(g8Parenthetical('G4')).toLowerCase());
    expect(chain![2].trim().toLowerCase()).toContain(String(g8Parenthetical('G5')).toLowerCase());
  });
});
