/**
 * Tests for verifier decisions: confirm, deny, abstain.
 *
 * A verifier who can only confirm is a rubber stamp. Someone who KNOWS a
 * request is illegitimate — who just spoke to the owner, who knows the
 * requester is estranged — could previously only decline to act, which is
 * indistinguishable from being on a plane. Silence and objection must be
 * different signals, and enough objections must halt a release (J7-R5, J7-R7).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R5, J7-R7, J7-R8, J7-R9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { thresholdUnreachable, evaluateOutcome, DECISIONS } from './verifier-decision';

describe('DECISIONS', () => {
  it('distinguishes objection from silence', () => {
    expect([...DECISIONS]).toEqual(['confirm', 'deny', 'abstain']);
  });
});

describe('thresholdUnreachable', () => {
  it('2-of-3 survives one denial — two verifiers remain, exactly enough', () => {
    expect(thresholdUnreachable(3, 2, 1)).toBe(false);
  });

  it('2-of-3 becomes unreachable at two denials', () => {
    expect(thresholdUnreachable(3, 2, 2)).toBe(true);
  });

  it('1-of-3 needs all three denials', () => {
    expect(thresholdUnreachable(3, 1, 1)).toBe(false);
    expect(thresholdUnreachable(3, 1, 2)).toBe(false);
    expect(thresholdUnreachable(3, 1, 3)).toBe(true);
  });

  it('1-of-1 is unreachable on a single denial', () => {
    expect(thresholdUnreachable(1, 1, 1)).toBe(true);
  });

  it('is never unreachable with zero denials', () => {
    expect(thresholdUnreachable(5, 3, 0)).toBe(false);
  });

  it('Property: unreachable exactly when remaining verifiers < required', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (m, n, denials) => {
          expect(thresholdUnreachable(m, n, denials)).toBe(m - denials < n);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('evaluateOutcome', () => {
  it('advances once confirmations reach the threshold', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 2, denials: 0 })).toBe('advance');
  });

  it('waits below the threshold while denials are still survivable', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 1, denials: 1 })).toBe('wait');
  });

  it('HALTS when denials make the threshold unreachable', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 1, denials: 2 })).toBe('halt');
  });

  it('advance wins if the threshold was already met when a late denial lands', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 2, denials: 1 })).toBe('advance');
  });

  it('abstentions move neither counter, so the release still waits', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 0, denials: 0 })).toBe('wait');
  });

  it('a single verifier denying their own 1-of-1 halts it', () => {
    expect(evaluateOutcome({ m: 1, n: 1, confirmations: 0, denials: 1 })).toBe('halt');
  });

  it('Property: never both advances and halts, and always returns a known outcome', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (m, n, confirmations, denials) => {
          const out = evaluateOutcome({ m, n, confirmations, denials });
          expect(['advance', 'halt', 'wait']).toContain(out);
          // Reaching the threshold always wins: a met quorum is never halted.
          if (confirmations >= n) expect(out).toBe('advance');
        },
      ),
      { numRuns: 500 },
    );
  });
});
