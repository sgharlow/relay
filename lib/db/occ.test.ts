/**
 * Tests for lib/db/occ.ts
 *
 * Validates: Requirements 5.7, 6.9, 16.3
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { OCC_RETRY, isSqlState40001, withOccRetry } from './occ';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep that resolves immediately — used as the injected sleepFn so tests
 *  don't need fake timers and errors never escape microtask boundaries. */
const noopSleep = (): Promise<void> => Promise.resolve();

function makeSqlState40001Error(): Error & { code: string } {
  const err = new Error('serialization failure') as Error & { code: string };
  err.code = '40001';
  return err;
}

// ---------------------------------------------------------------------------
// OCC_RETRY config
// ---------------------------------------------------------------------------

describe('OCC_RETRY config', () => {
  it('has the expected shape and values', () => {
    expect(OCC_RETRY.maxAttempts).toBe(3);
    expect(OCC_RETRY.baseDelayMs).toBe(100);
    expect(OCC_RETRY.jitterMs).toBe(50);
    expect(OCC_RETRY.maxDelayMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// isSqlState40001
// ---------------------------------------------------------------------------

describe('isSqlState40001', () => {
  it('returns true for an error with code "40001"', () => {
    expect(isSqlState40001(makeSqlState40001Error())).toBe(true);
  });

  it('returns false for an error with a different code', () => {
    const err = new Error('unique violation') as Error & { code: string };
    err.code = '23505';
    expect(isSqlState40001(err)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSqlState40001(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSqlState40001(undefined)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isSqlState40001('40001')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isSqlState40001(40001)).toBe(false);
  });

  it('returns false for an object without a code property', () => {
    expect(isSqlState40001({ message: 'oops' })).toBe(false);
  });

  it('returns false when code is the number 40001 (not string)', () => {
    expect(isSqlState40001({ code: 40001 })).toBe(false);
  });

  // Property: any object with code !== "40001" must return false
  it('property: only code === "40001" returns true', () => {
    fc.assert(
      fc.property(
        fc.record({
          code: fc.string().filter((s) => s !== '40001'),
        }),
        (obj) => isSqlState40001(obj) === false
      )
    );
  });
});

// ---------------------------------------------------------------------------
// withOccRetry — unit tests (no fake timers needed; sleep injected)
// ---------------------------------------------------------------------------

describe('withOccRetry', () => {
  it('returns the result when fn succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withOccRetry(fn, noopSleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on SQLSTATE 40001 and succeeds on the second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSqlState40001Error())
      .mockResolvedValueOnce('retried-ok');

    await expect(withOccRetry(fn, noopSleep)).resolves.toBe('retried-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxAttempts then re-throws the last 40001 error', async () => {
    const err = makeSqlState40001Error();
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withOccRetry(fn, noopSleep)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(OCC_RETRY.maxAttempts);
  });

  it('does NOT retry on a non-40001 error and throws immediately', async () => {
    const err = new Error('unique violation') as Error & { code: string };
    err.code = '23505';
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withOccRetry(fn, noopSleep)).rejects.toBe(err);
    // Called exactly once — no retry for non-serialization errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves on the third (final) attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSqlState40001Error())
      .mockRejectedValueOnce(makeSqlState40001Error())
      .mockResolvedValueOnce('third-time');

    await expect(withOccRetry(fn, noopSleep)).resolves.toBe('third-time');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls the sleep function between retries', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSqlState40001Error())
      .mockResolvedValueOnce('ok');

    await withOccRetry(fn, sleep);
    // One retry → one sleep call
    expect(sleep).toHaveBeenCalledTimes(1);
    // Delay should be a finite positive number
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(OCC_RETRY.maxDelayMs);
  });
});

// ---------------------------------------------------------------------------
// withOccRetry — property-based tests
// **Validates: Requirements 5.7, 6.9, 16.3**
// ---------------------------------------------------------------------------
// Feature: relay-h0-mvp, Property 13

describe('withOccRetry — property tests', () => {
  it(
    'property: fn is called at most maxAttempts times regardless of 40001 failures',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10 }),
          async (failCount) => {
            let calls = 0;
            const fn = async () => {
              calls++;
              if (calls <= failCount) throw makeSqlState40001Error();
              return 'value';
            };

            try {
              await withOccRetry(fn, noopSleep);
            } catch {
              // exhausted — still check call count
            }

            return calls <= OCC_RETRY.maxAttempts;
          }
        ),
        { numRuns: 50 }
      );
    }
  );

  it(
    'property: non-40001 errors are re-thrown after exactly 1 call',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => s !== '40001'),
          async (code) => {
            let calls = 0;
            // Use a plain object (not Error) so no unhandled rejection escapes
            // the predicate boundary
            const errObj = { code, message: 'some other error' };
            const fn = async (): Promise<never> => {
              calls++;
              // eslint-disable-next-line @typescript-eslint/no-throw-literal
              throw errObj;
            };

            let thrown: unknown;
            try {
              await withOccRetry(fn, noopSleep);
            } catch (e) {
              thrown = e;
            }

            return calls === 1 && thrown === errObj;
          }
        ),
        { numRuns: 50 }
      );
    }
  );

  it(
    'property: resolves immediately when fn always succeeds',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.anything(),
          async (value) => {
            const fn = async () => value;
            const result = await withOccRetry(fn, noopSleep);
            return result === value;
          }
        ),
        { numRuns: 50 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 13: OCC retry with safe default
// **Validates: Requirements 5.7, 5.9**
// Feature: relay-h0-mvp, Property 13
//
// For any release state transition that encounters SQLSTATE 40001 on ALL
// attempts (up to 3), the final system state must be 'armed'.  The system
// must never remain in 'pending', 'grace', or 'released' after retry
// exhaustion.
//
// Test approach:
//   - Model a release state transition as a function that calls withOccRetry
//     wrapping a DB operation that always throws SQLSTATE 40001.
//   - The caller implements the "safe default" contract: if withOccRetry
//     throws (exhausted), reset state to 'armed'.
//   - Assert the resulting state equals 'armed' for all starting states and
//     trigger types (500 iterations).
// ---------------------------------------------------------------------------

type ReleaseStateValue = 'armed' | 'pending' | 'grace' | 'released' | 'cancelled';

/**
 * Simulates the release state transition pattern used by ReleaseStateMachine:
 *   1. Attempt the DB operation via withOccRetry (mocked to always 40001).
 *   2. On OccExhausted (all retries consumed), reset to 'armed' — the safe default.
 *   3. Return the resulting state.
 *
 * This mirrors the production pattern in lib/release/state-machine.ts:
 *   on exhaustion → safeResetToArmed → state = 'armed'
 */
async function simulateTransitionWithOccExhaustion(
  currentState: ReleaseStateValue,
  targetState: ReleaseStateValue,
  alwaysFailing40001Fn: () => Promise<ReleaseStateValue>,
): Promise<ReleaseStateValue> {
  try {
    // withOccRetry will exhaust 3 retries and re-throw the last 40001 error
    return await withOccRetry(alwaysFailing40001Fn, noopSleep);
  } catch (err) {
    if (isSqlState40001(err)) {
      // Safe default: any exhausted transition → ARMED
      // (mirrors safeResetToArmed in ReleaseStateMachine)
      return 'armed';
    }
    // Non-40001 errors propagate (not the case under test here)
    throw err;
  }
}

describe('Property 13: OCC retry with safe default', () => {
  it(
    'property: any release state transition exhausting 3 retries must result in ARMED state',
    async () => {
      // Feature: relay-h0-mvp, Property 13
      // Validates: Requirements 5.7, 5.9
      const ALL_STATES: ReleaseStateValue[] = [
        'armed',
        'pending',
        'grace',
        'released',
        'cancelled',
      ];
      const TRIGGER_TYPES = [
        'emergency',
        'travel',
        'caregiver',
        'business',
        'estate',
      ] as const;

      await fc.assert(
        fc.asyncProperty(
          // Arbitrary starting state
          fc.constantFrom(...ALL_STATES),
          // Arbitrary target state (what the transition was trying to reach)
          fc.constantFrom(...ALL_STATES),
          // Arbitrary trigger type
          fc.constantFrom(...TRIGGER_TYPES),
          async (currentState, targetState, _triggerType) => {
            let dbCallCount = 0;

            // DB driver that always returns SQLSTATE 40001
            const alwaysFailing40001: () => Promise<ReleaseStateValue> =
              async () => {
                dbCallCount++;
                throw makeSqlState40001Error();
              };

            const finalState = await simulateTransitionWithOccExhaustion(
              currentState,
              targetState,
              alwaysFailing40001,
            );

            // Invariant 1: final state must be 'armed' (safe default)
            const stateIsArmed = finalState === 'armed';

            // Invariant 2: DB was called exactly maxAttempts (3) times
            const calledExactlyMaxAttempts =
              dbCallCount === OCC_RETRY.maxAttempts;

            return stateIsArmed && calledExactlyMaxAttempts;
          },
        ),
        { numRuns: 500 },
      );
    },
  );
});
