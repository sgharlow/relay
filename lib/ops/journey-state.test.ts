/**
 * The document may not contradict the source of truth about build state.
 *
 * 🔴 IT DID, FOR A WEEK, IN THREE PLACES AT ONCE. docs/user-journeys.md calls
 * itself the user-requirements layer, and by 2026-08-13 its own tables
 * disagreed with each other: a live sweep at the top recorded J1, J3, J6 and J7
 * passing on production, while a summary table eight hundred lines down tagged
 * all four `[GAP]` and Part VIII described the delegation model, the access
 * request flow and the entire verifier UI as unbuilt. One line was not merely
 * stale but wrong about PROJECT.yaml itself, asserting `monetization_path: none`
 * four days after a real card was charged through live-mode Stripe.
 *
 * The document had declined to retag by hand, reasoning that asserting 74 build
 * states invites a wrong one. That reasoning was right, and the fix follows it
 * rather than overruling it: state each journey ONCE in PROJECT.yaml — where
 * the volatile-facts rule already puts test counts, gates and dated decisions —
 * and let the prose point at it.
 *
 * This test is what makes that structural instead of aspirational. Restating a
 * journey's state in the document is now a failing test rather than a thing
 * somebody might notice.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = readFileSync('docs/user-journeys.md', 'utf8');
const YAML = readFileSync('PROJECT.yaml', 'utf8');

/**
 * Deliberately a narrow line-scanner rather than a YAML parser: this asserts
 * one shape in one file, and adding a parser dependency to check ten lines
 * would be the more fragile choice.
 */
function journeyStates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of YAML.split('\n')) {
    const m = /^\s{2}(J\d+):\s*\{[^}]*status:\s*([a-z]+)/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('journey build state lives in exactly one place', () => {
  it('PROJECT.yaml records all ten journeys', () => {
    const states = journeyStates();
    const missing = Array.from({ length: 10 }, (_, i) => `J${i + 1}`).filter((j) => !states[j]);
    expect(missing, 'PROJECT.yaml: journeys is incomplete').toEqual([]);
  });

  it('every recorded state is one the vocabulary allows', () => {
    /*
      A free-text status is a status that means whatever the writer felt that
      day, which is how "DONE" came to mean five different things across this
      portfolio. `live` = walked end to end on production. `gated` = deliberately
      refused at the trust boundary, with the gate named. `open` = not built.
      `withdrawn` = refused at the trust boundary and NOT coming back.

      🔴 `withdrawn` WAS ADDED 2026-08-14 BECAUSE `gated` WAS LYING. J10 was
      recorded as `gated`, naming g2-counsel-opinion; that gate was then declined rather
      than met, so the journey is not waiting on anything — it is withdrawn. Left
      as `gated` it would have read as temporary on every future status pass,
      which is exactly how a deliberately-removed capability gets quietly
      rebuilt by someone completing what looked like an unfinished plan.

      The distinction is worth a word: `gated` still owes an answer, `withdrawn`
      does not.
    */
    const bad = Object.entries(journeyStates()).filter(
      ([, s]) => !['live', 'gated', 'open', 'withdrawn'].includes(s),
    );
    expect(bad, 'unrecognised journey status').toEqual([]);
  });

  /*
    THE SPECIFIC CONTRADICTION THAT PROMPTED THIS. The old summary table carried
    a State column of `[GAP]` / `[BUILT]`+ tags per journey. It is gone; if
    anybody reintroduces a per-journey state column, this fails and points them
    at PROJECT.yaml.
  */
  it('the summary table no longer carries a State column', () => {
    const table = DOC.slice(DOC.indexOf('### Summary table'), DOC.indexOf('## Part III'));
    expect(
      /\|\s*Success condition\s*\|\s*State\s*\|/.test(table),
      'The summary table has a State column again. Per-journey build state ' +
        'belongs in PROJECT.yaml: journeys — this table held the copy that went ' +
        'wrong, tagging four passing journeys as [GAP].',
    ).toBe(false);
  });

  it('no journey marked live in PROJECT.yaml is tagged a gap in the document', () => {
    const live = Object.entries(journeyStates())
      .filter(([, s]) => s === 'live')
      .map(([j]) => j);

    /*
      Scoped to the summary and coverage tables — the two places that made
      journey-level claims. The per-STEP tags inside each journey's happy path
      are a different thing: they describe individual steps, many of which are
      genuinely still open inside a journey that works end to end, and the
      document is explicit that they are as-of-authoring.
    */
    const coverage = DOC.slice(DOC.indexOf('### Coverage'), DOC.indexOf('### Sequencing'));
    const offenders = live.filter((j) => {
      const row = new RegExp(`^\\|\\s*${j}\\b.*\\[GAP\\]`, 'm');
      return row.test(coverage);
    });

    expect(
      offenders,
      'These journeys are recorded live in PROJECT.yaml and tagged [GAP] in the ' +
        'coverage table. One of the two is wrong, and the sweep evidence decides which.',
    ).toEqual([]);
  });

  it('the corrected monetization line does not restate a value', () => {
    /*
      The failure was not a stale tag, it was a hardcoded fact about another
      file. The corrected line must keep pointing rather than re-asserting.
    */
    expect(
      /monetization_path: none/.test(DOC),
      'docs/user-journeys.md asserts `monetization_path: none` again. That value ' +
        'lives in PROJECT.yaml and was wrong here for four days after live Stripe ' +
        'shipped. Reference the field; do not copy its value.',
    ).toBe(false);
  });

  it('the document points readers at PROJECT.yaml for build state', () => {
    expect(DOC).toContain('PROJECT.yaml: journeys');
  });
});
