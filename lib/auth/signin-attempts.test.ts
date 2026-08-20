/**
 * The durable sign-in budget, and above all the branch that must never take the
 * front door down.
 *
 * 🔴 THE TEST THAT JUSTIFIES THE MODULE'S SHAPE is `the table is not there yet`.
 * Migration 029 shipped `auth_challenges` and its caller THREW when the table
 * was absent, so deploying the code before the migration stopped passkey
 * registration and sign-in — and it did, for four minutes on 2026-08-15. The
 * lesson was not "apply migrations first". It was that a security control on
 * the front door has to degrade rather than fail closed, and that is a property
 * with a test rather than an intention with a comment.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  durableFailureCount,
  recordDurableFailure,
  clearDurableFailures,
  sweepOldSigninAttempts,
  signinKeyFor,
  _resetSigninAttemptsForTesting,
  _durableStoreUnavailable,
} from './signin-attempts';

const mockQuery = vi.mocked(query);
const EMAIL = 'owner@example.org';
const WINDOW = 15 * 60 * 1000;

/** The error `pg` raises for `relation "x" does not exist`. */
function undefinedTable(): Error & { code: string } {
  return Object.assign(new Error('relation "signin_attempts" does not exist'), { code: '42P01' });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSigninAttemptsForTesting();
});

describe('the address is never stored', () => {
  it('counts against a hash, not an email', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: '0' }] } as never);
    await durableFailureCount(EMAIL, WINDOW);

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).not.toContain('@');
    expect(params[0]).toBe(signinKeyFor(EMAIL));
    expect(String(params[0])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the normalised address, so casing cannot mint a second budget', () => {
    expect(signinKeyFor('  Owner@Example.ORG ')).toBe(signinKeyFor(EMAIL));
  });

  it('gives different addresses different keys', () => {
    expect(signinKeyFor('a@example.org')).not.toBe(signinKeyFor('b@example.org'));
  });

  it('writes the same hash on record, count and clear — or they would not agree', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: '0' }], rowCount: 0 } as never);
    await recordDurableFailure(EMAIL);
    await durableFailureCount(EMAIL, WINDOW);
    await clearDurableFailures(EMAIL);

    const keys = mockQuery.mock.calls.map((c) => (c[1] as unknown[])[0]);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(signinKeyFor(EMAIL));
  });
});

describe('counting', () => {
  it('returns the count the database reports', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: '7' }] } as never);
    expect(await durableFailureCount(EMAIL, WINDOW)).toBe(7);
  });

  it('bounds the count by the window rather than by a delete', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: '0' }] } as never);
    await durableFailureCount(EMAIL, WINDOW);

    const sql = String(mockQuery.mock.calls[0]![0]);
    expect(sql).toContain('failed_at >');
    // Expiry is a predicate on the read path, which is what makes the sweep
    // housekeeping rather than a control — the same ruling auth_challenges has.
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe(900);
  });

  it('appends rather than incrementing — no counter column to race on', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 } as never);
    await recordDurableFailure(EMAIL);

    const sql = String(mockQuery.mock.calls[0]![0]);
    expect(sql).toContain('INSERT INTO signin_attempts');
    expect(sql).not.toContain('UPDATE');
    // ON CONFLICT errored on real DSQL infra and 500'd the first live claim
    // (lib/people/claim.ts). Nothing in this codebase uses it, deliberately.
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('deletes every row for the address on a clear', async () => {
    mockQuery.mockResolvedValue({ rowCount: 3 } as never);
    await clearDurableFailures(EMAIL);
    expect(String(mockQuery.mock.calls[0]![0])).toContain('DELETE FROM signin_attempts');
  });
});

describe('the table is not there yet', () => {
  it('returns null rather than throwing', async () => {
    mockQuery.mockRejectedValue(undefinedTable());
    await expect(durableFailureCount(EMAIL, WINDOW)).resolves.toBeNull();
  });

  it('never throws from any entry point', async () => {
    mockQuery.mockRejectedValue(undefinedTable());
    await expect(recordDurableFailure(EMAIL)).resolves.toBeUndefined();
    await expect(clearDurableFailures(EMAIL)).resolves.toBeUndefined();
    await expect(sweepOldSigninAttempts()).resolves.toBe(0);
  });

  it('latches, so a missing migration costs ONE query per process and not one per attempt', async () => {
    mockQuery.mockRejectedValue(undefinedTable());
    expect(_durableStoreUnavailable()).toBe(false);

    await durableFailureCount(EMAIL, WINDOW);
    expect(_durableStoreUnavailable()).toBe(true);

    mockQuery.mockClear();
    for (let i = 0; i < 20; i += 1) {
      await durableFailureCount(EMAIL, WINDOW);
      await recordDurableFailure(EMAIL);
    }
    // A missing migration must not turn into sustained load on the sign-in path.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('says so exactly once, not on every attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery.mockRejectedValue(undefinedTable());

    await durableFailureCount(EMAIL, WINDOW);
    await durableFailureCount(EMAIL, WINDOW);
    await recordDurableFailure(EMAIL);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('signin_attempts');
    expect(String(warn.mock.calls[0]![0])).toContain('Sign-in is unaffected');
    warn.mockRestore();
  });
});

describe('any other database failure', () => {
  it('reports null — no information, which is not the same as zero', async () => {
    mockQuery.mockRejectedValue(new Error('connection terminated unexpectedly'));
    expect(await durableFailureCount(EMAIL, WINDOW)).toBeNull();
  });

  it('does NOT latch on a transient failure — a blip must not disable the control', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));
    await durableFailureCount(EMAIL, WINDOW);
    expect(_durableStoreUnavailable()).toBe(false);

    mockQuery.mockResolvedValue({ rows: [{ n: '4' }] } as never);
    expect(await durableFailureCount(EMAIL, WINDOW)).toBe(4);
  });

  it('stays quiet, so a DSQL wobble does not bury the log at the moment it is read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 5; i += 1) await durableFailureCount(EMAIL, WINDOW);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats an unreadable answer as null rather than as zero', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never);
    expect(await durableFailureCount(EMAIL, WINDOW)).toBeNull();

    mockQuery.mockResolvedValue({ rows: [{ n: 'not a number' }] } as never);
    expect(await durableFailureCount(EMAIL, WINDOW)).toBeNull();
  });
});

describe('housekeeping', () => {
  it('deletes rows past the grace period and reports how many', async () => {
    mockQuery.mockResolvedValue({ rowCount: 12 } as never);
    expect(await sweepOldSigninAttempts(24)).toBe(12);
    expect(String(mockQuery.mock.calls[0]![0])).toContain('DELETE FROM signin_attempts');
  });

  it('never fails the job it rides on', async () => {
    mockQuery.mockRejectedValue(new Error('DSQL unavailable'));
    expect(await sweepOldSigninAttempts()).toBe(0);
  });
});
