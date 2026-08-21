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
            // Object.is, NOT ===. `fc.anything()` generates NaN on some seeds,
            // and NaN === NaN is false, so this property failed at random
            // roughly whenever fast-check happened to pick it — a latent flake
            // that fired in CI on 2026-08-12 while passing locally on a
            // different seed. Object.is is also the comparison this property
            // actually means: the identical value came back out.
            return Object.is(result, value);
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
// ---------------------------------------------------------------------------
/*
  🔴 THIS PROPERTY USED TO TEST A COPY OF THE CODE IT WAS ABOUT.

  What stood here was `simulateTransitionWithOccExhaustion`, a function defined
  in this file that called `withOccRetry`, caught the exhausted 40001 itself and
  `return 'armed'`. The property then asserted that this function returns
  'armed'. Its own comment said it "mirrors the production pattern in
  lib/release/state-machine.ts" — and a mirror is exactly the problem: delete
  `safeResetToArmed` from the real machine and every assertion here still
  passed. The safe-default invariant is described in CLAUDE.md as "the core
  correctness story", and its property-based proof was a tautology about a
  fixture.

  It now drives `ReleaseStateMachine.transition` itself, over every permitted
  edge and both reversibility settings, and asserts the two things that are
  actually load-bearing: `OccExhaustedError` is thrown, and the reset UPDATE was
  ISSUED — the row is left ARMED by a statement, not by a return value.

  ⚠️ THE MOCK MUST NOT FAIL EVERY QUERY, and getting that wrong is how this
  would go quietly decorative again. `transition` re-READS the row between
  retries, and that read is outside its inner try — so a mock that throws 40001
  on everything makes the raw 40001 escape from `readRow` and the exhaustion
  path is never reached. Only the CAS UPDATE fails here; the re-read and the
  reset succeed, which is the real shape of a serialization conflict.
*/

vi.mock('./connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

describe('Property 13: OCC retry with safe default', () => {
  it('any permitted transition that exhausts its retries issues the reset to ARMED', async () => {
    // Feature: relay-h0-mvp, Property 13
    // Validates: Requirements 5.7, 5.9
    const { query } = await import('./connection');
    const { ReleaseStateMachine, PERMITTED_TRANSITIONS, OccExhaustedError } = await import(
      '../release/state-machine'
    );
    const mockQuery = vi.mocked(query);

    const edges = PERMITTED_TRANSITIONS.map((t) => ({ ...t }));
    expect(edges.length, 'no permitted edges — this property would assert nothing').toBeGreaterThan(0);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...edges),
        fc.boolean(),
        async (edge, reversible) => {
          // Skip the combinations the machine refuses before any DB write; the
          // illegal-edge half is Property 11's job, not this one's.
          if (edge.reversibleOnly && !reversible) return true;

          mockQuery.mockReset();
          let resetIssued = false;
          let casAttempts = 0;

          mockQuery.mockImplementation((async (sql: string) => {
            if (/^\s*SELECT/i.test(sql)) {
              return {
                rows: [{ id: 'rs-1', owner_id: 'owner-1', state: edge.from, version: '0' }],
                rowCount: 1,
              };
            }
            if (/SET state = 'armed'/.test(sql)) {
              resetIssued = true;
              return { rows: [{ id: 'rs-1', owner_id: 'owner-1', state: 'armed', version: '1' }], rowCount: 1 };
            }
            casAttempts += 1;
            throw Object.assign(new Error('serialization failure'), { code: '40001' });
          }) as never);

          const machine = new ReleaseStateMachine({
            sleep: async () => {},
            random: () => 0,
            maxRetries: OCC_RETRY.maxAttempts,
          });

          let thrown: unknown;
          try {
            await machine.transition('rs-1', edge.from, edge.to, '0', { reversible });
          } catch (e) {
            thrown = e;
          }

          return (
            thrown instanceof OccExhaustedError &&
            resetIssued &&
            casAttempts === OCC_RETRY.maxAttempts
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
