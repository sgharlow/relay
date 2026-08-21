/**
 * What the vault screen says after an analysis.
 *
 * 🔴 IT REPORTED A CAPPED RUN AS A COMPLETE ONE. `runIntake` scores at most 300
 * items (Req 11.10) and returns the rest as `remaining`; `/api/ai/intake` did
 * not forward that number and this screen did not ask for it, so an owner with
 * 312 accounts pressed Analyse and read "Looked at 300 items and re-ordered them
 * by what matters most." Twelve accounts had not been looked at, the ordering
 * the page advertises as "most consequential first" did not include them, and
 * nothing anywhere said so.
 *
 * The sentence lives here rather than inside the component because it is the
 * part that was wrong, and a template literal inside a `.tsx` in a node test
 * environment can only be checked by reading the file as text.
 *
 * ⚠️ IT MUST NOT PROMISE A NEXT RUN. There is no "never scored" marker to order
 * by — `importance_score` is NOT NULL DEFAULT 0.5, so an unscored item is
 * indistinguishable from one scored at exactly 0.5 — and every run starts from
 * the same place. "The rest will be done next time" would be the same lie in a
 * kinder register. See the `remaining` field in lib/ai/intake-agent.ts.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.9, 11.10
 */

import { describe, it, expect } from 'vitest';

import { summariseAnalysis } from './analysis-summary';

describe('summariseAnalysis', () => {
  it('tells an owner with nothing stored what to do instead', () => {
    expect(summariseAnalysis({ scored: 0, remaining: 0, warnings: 0 })).toBe(
      'Nothing to analyse yet — add an account first.',
    );
  });

  it('reports a complete run without qualification', () => {
    const s = summariseAnalysis({ scored: 3, remaining: 0, warnings: 0 });
    expect(s).toBe('Looked at 3 items and re-ordered them by what matters most.');
  });

  it('says "item" for one', () => {
    expect(summariseAnalysis({ scored: 1, remaining: 0, warnings: 0 })).toContain('1 item and');
  });

  it('names what the cap left behind', () => {
    const s = summariseAnalysis({ scored: 300, remaining: 12, warnings: 0 });
    expect(s).toContain('300 items');
    expect(s, 'the number the owner is not being told about').toContain('12 other items');
  });

  it('does not imply another run would reach them', () => {
    const s = summariseAnalysis({ scored: 300, remaining: 12, warnings: 0 });
    expect(s).not.toMatch(/next (?:run|time)|will be|later|again soon/i);
    expect(s, 'the truth is that a re-run starts from the same place').toMatch(
      /running it again will not reach them/i,
    );
  });

  it('says nothing about a cap that left nothing behind', () => {
    expect(summariseAnalysis({ scored: 300, remaining: 0, warnings: 0 })).not.toMatch(/other item/);
  });

  it('still reports items that could not be scored', () => {
    const s = summariseAnalysis({ scored: 5, remaining: 0, warnings: 2 });
    expect(s).toContain('2 could not be scored');
  });

  it('reports a cap and a scoring failure together, without conflating them', () => {
    // Two different events: one batch was too big, and two items inside it fell
    // back to the default classification. Reporting only one would misdescribe
    // the other.
    const s = summariseAnalysis({ scored: 300, remaining: 12, warnings: 2 });
    expect(s).toContain('12 other items');
    expect(s).toContain('2 could not be scored');
  });

  it('treats an absent count as none rather than throwing', () => {
    // An older deploy of /api/ai/intake answers without `remaining`. The screen
    // must render, and must not invent a number.
    const s = summariseAnalysis({ scored: 4, remaining: undefined, warnings: 0 });
    expect(s).toBe('Looked at 4 items and re-ordered them by what matters most.');
  });
});
