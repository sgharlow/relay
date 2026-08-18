/**
 * The editorial threshold proposal must not tell Steve a prerequisite is
 * outstanding when the log of record says it was met.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, and it was mine. The proposal's
 * pre-flight section read:
 *
 *     "`caregiver_intent`'s Stripe branch is pinned by `lane-b.test.ts` but has
 *      never fired on a real click (MEMORY: 'Lane-B numerator NOT live-proven')"
 *
 * It was false when written. `g1-flight-log.md` had recorded the Lane-B live
 * proof four days earlier — a real click that took the Stripe branch and
 * emitted exactly one `caregiver_intent`. The sentence was composed from a
 * memory note rather than derived from the log, inside a document whose entire
 * purpose is to be ratified. Its cost would have been Steve re-running a proof
 * already in hand, and doubting an instrument that works.
 *
 * ⚠️ WHY THIS IS NOT A NEGATIVE GREP OVER THE WHOLE FILE. The correction quotes
 * the false sentence in order to explain it — so a naive search for "never
 * fired" matches the very edit that fixed the problem. That trap has now bitten
 * three times in this repo (api-reachability's module specifiers,
 * code-entropy's failed_attempts, gates.test.ts's "pending counsel"), and the
 * rule it produced is written down in gates.test.ts: assert what must be
 * PRESENT, and scope any negative to a region that cannot contain commentary.
 * Blockquotes are that region here — a `>` line is annotation, never a claim
 * the document is making in its own voice.
 *
 * Feature: relay-h0-mvp
 * Requirements: g1-arms-length-demand (instrument integrity)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PROPOSAL = 'docs/g1-editorial-threshold-proposal.md';
const FLIGHT_LOG = 'docs/g1-flight-log.md';

const read = (f: string) => readFileSync(f, 'utf8');

/** The document speaking in its own voice: blockquotes (annotation) removed. */
function ownVoice(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

describe('the editorial proposal agrees with the flight log about the instrument', () => {
  it('the flight log records both lane proofs — the anchor for everything below', () => {
    const log = read(FLIGHT_LOG);
    expect(
      /Step 5 — the Lane-B numerator, live-proven/.test(log),
      'the Lane-B proof section has gone from the flight log. If the proof was ' +
        'genuinely withdrawn, this whole guard is wrong and the proposal should ' +
        'go back to naming the pre-flight as outstanding — but that is a decision, ' +
        'not a deletion.',
    ).toBe(true);
    expect(
      /Editorial pre-flight — PASSED/.test(log),
      'the editorial pre-flight record has gone from the flight log',
    ).toBe(true);
  });

  it('the proposal does not claim the numerator is unproven', () => {
    const claims = [
      /has never fired/i,
      /never fired on a real click/i,
      /not live-proven/i,
      /never emitted its numerator/i,
    ];
    const voice = ownVoice(read(PROPOSAL));
    const found = claims.filter((re) => re.test(voice)).map(String);

    expect(
      found,
      found.length
        ? 'The proposal states the Lane-B numerator is unproven, while ' +
          `${FLIGHT_LOG} records a real click that emitted it:\n` +
          found.map((f) => `  ${f}`).join('\n') +
          '\n\nIf a NEW doubt about the instrument is meant, say which run failed ' +
          'and when — an unqualified "never" is the claim the log contradicts.'
        : 'ok',
    ).toEqual([]);
  });

  it('the proposal names both proofs, so a reader can check them rather than trust it', () => {
    const voice = ownVoice(read(PROPOSAL));
    expect(voice, 'the Lane-B proof date is not cited').toMatch(/2026-08-14/);
    expect(voice, 'the Lane-A / editorial pre-flight date is not cited').toMatch(/2026-08-18/);
    // Both lanes named, because they are different clicks and one does not
    // stand in for the other — the distinction the flight log spells out.
    expect(voice, 'the proposal does not distinguish the two lanes').toMatch(/Lane A/);
    expect(voice, 'the proposal does not distinguish the two lanes').toMatch(/Lane B/);
  });
});
