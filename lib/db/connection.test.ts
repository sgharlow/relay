/**
 * Unit tests for lib/db/connection.ts
 *
 * Tests cover:
 *  - getPool() routing logic (DSQL_USE_SECONDARY, unhealthy window, totalCount)
 *  - markPrimaryUnhealthy / isPrimaryUnhealthy window semantics
 *  - query() failover on connection errors
 *  - query() propagation of non-connection errors
 *  - closeAllPools()
 *
 * Feature: relay-h0-mvp, Task 3.1
 * Requirements: 14.2, 14.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type pg from 'pg';
import {
  getPool,
  query,
  markPrimaryUnhealthy,
  isPrimaryUnhealthy,
  resetUnhealthyState,
  closeAllPools,
  _setPoolsForTesting,
} from './connection.js';

// ---------------------------------------------------------------------------
// Shared mock pool factory
// ---------------------------------------------------------------------------

function makeMockPool(overrides: {
  totalCount?: number;
  query?: ReturnType<typeof vi.fn>;
  end?: ReturnType<typeof vi.fn>;
} = {}): pg.Pool {
  return {
    totalCount: overrides.totalCount ?? 1,
    query: overrides.query ?? vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: overrides.end ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as pg.Pool;
}

// ---------------------------------------------------------------------------
// Reset state before every test
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

beforeEach(() => {
  resetUnhealthyState();
  _setPoolsForTesting(null, null); // clear injected pools
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

// ---------------------------------------------------------------------------
// Tests: isPrimaryUnhealthy / markPrimaryUnhealthy
// ---------------------------------------------------------------------------

describe('isPrimaryUnhealthy', () => {
  it('returns false initially', () => {
    expect(isPrimaryUnhealthy()).toBe(false);
  });

  it('returns true immediately after markPrimaryUnhealthy', () => {
    markPrimaryUnhealthy();
    expect(isPrimaryUnhealthy()).toBe(true);
  });

  it('returns false after the 60-second window has elapsed', () => {
    vi.useFakeTimers();
    markPrimaryUnhealthy();
    expect(isPrimaryUnhealthy()).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(isPrimaryUnhealthy()).toBe(false);

    vi.useRealTimers();
  });

  it('resets the internal flag to false once window expires', () => {
    vi.useFakeTimers();
    markPrimaryUnhealthy();
    vi.advanceTimersByTime(60_001);

    expect(isPrimaryUnhealthy()).toBe(false);
    // idempotent: second check still false
    expect(isPrimaryUnhealthy()).toBe(false);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Tests: getPool() routing
// ---------------------------------------------------------------------------

describe('getPool() routing', () => {
  it('throws when DSQL_PRIMARY_ENDPOINT is not set and primary is selected', () => {
    delete process.env.DSQL_PRIMARY_ENDPOINT;
    delete process.env.DSQL_SECONDARY_ENDPOINT;
    delete process.env.DSQL_USE_SECONDARY;
    // pools cleared, no injection → will try to construct primary
    expect(() => getPool()).toThrow('DSQL_PRIMARY_ENDPOINT is not set');
  });

  it('throws when DSQL_SECONDARY_ENDPOINT is not set and secondary is selected', () => {
    process.env.DSQL_USE_SECONDARY = 'true';
    delete process.env.DSQL_SECONDARY_ENDPOINT;
    expect(() => getPool()).toThrow('DSQL_SECONDARY_ENDPOINT is not set');
  });

  it('returns secondary pool when DSQL_USE_SECONDARY=true', () => {
    const secondary = makeMockPool({ totalCount: 1 });
    const primary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    process.env.DSQL_USE_SECONDARY = 'true';
    expect(getPool()).toBe(secondary);
  });

  it('returns secondary pool when primary is unhealthy', () => {
    const secondary = makeMockPool({ totalCount: 1 });
    const primary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    process.env.DSQL_USE_SECONDARY = 'false';
    markPrimaryUnhealthy();
    expect(getPool()).toBe(secondary);
  });

  it('returns secondary when primaryPool.totalCount === 0', () => {
    const secondary = makeMockPool({ totalCount: 1 });
    const primary = makeMockPool({ totalCount: 0 });
    _setPoolsForTesting(primary, secondary);

    process.env.DSQL_USE_SECONDARY = 'false';
    expect(getPool()).toBe(secondary);
  });

  it('returns primary pool under normal conditions (totalCount > 0, not unhealthy, no env flag)', () => {
    const primary = makeMockPool({ totalCount: 2 });
    const secondary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    process.env.DSQL_USE_SECONDARY = 'false';
    expect(getPool()).toBe(primary);
  });

  it('returns primary again after the unhealthy window expires', () => {
    vi.useFakeTimers();

    const primary = makeMockPool({ totalCount: 2 });
    const secondary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    process.env.DSQL_USE_SECONDARY = 'false';
    markPrimaryUnhealthy();

    expect(getPool()).toBe(secondary);

    vi.advanceTimersByTime(61_000);
    expect(getPool()).toBe(primary);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Tests: query() — connection-error failover
// ---------------------------------------------------------------------------

describe('query() connection-error failover', () => {
  it('retries on secondary when primary throws ECONNREFUSED', async () => {
    const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const secondaryResult = { rows: [{ id: 1 }], rowCount: 1 };

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(connErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue(secondaryResult),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    const result = await query('SELECT 1');
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).toHaveBeenCalledTimes(1);
  });

  it('retries on secondary when primary throws ETIMEDOUT', async () => {
    const connErr = Object.assign(new Error('connection timeout'), { code: 'ETIMEDOUT' });

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(connErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await query('SELECT 1');
    expect(secondary.query).toHaveBeenCalledTimes(1);
  });

  it('retries on secondary when primary throws ENOTFOUND', async () => {
    const connErr = Object.assign(new Error('getaddrinfo ENOTFOUND primary.dsql.us-east-1.on.aws'), {
      code: 'ENOTFOUND',
    });

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(connErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await query('SELECT 1');
    expect(secondary.query).toHaveBeenCalledTimes(1);
  });

  it('marks primary unhealthy after a connection error', async () => {
    const connErr = Object.assign(new Error('connection timeout'), { code: 'ETIMEDOUT' });

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(connErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await query('SELECT 1');
    expect(isPrimaryUnhealthy()).toBe(true);
  });

  it('does NOT retry on secondary for non-connection errors (e.g. constraint violation)', async () => {
    const queryErr = new Error('duplicate key value violates unique constraint');

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(queryErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await expect(query('INSERT INTO test VALUES ($1)', [1])).rejects.toThrow(
      'duplicate key value violates unique constraint',
    );
    expect(secondary.query).not.toHaveBeenCalled();
    expect(isPrimaryUnhealthy()).toBe(false);
  });

  it('does NOT retry for SQLSTATE 40001 (OCC — handled by callers)', async () => {
    const occErr = Object.assign(new Error('could not serialize access due to concurrent update'), {
      code: '40001',
    });

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(occErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await expect(query('UPDATE release_state SET ...')).rejects.toThrow(occErr.message);
    expect(secondary.query).not.toHaveBeenCalled();
  });

  it('propagates secondary pool errors after failover', async () => {
    const connErr = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const secondaryErr = new Error('secondary also down');

    const primary = makeMockPool({
      totalCount: 1,
      query: vi.fn().mockRejectedValue(connErr),
    });
    const secondary = makeMockPool({
      query: vi.fn().mockRejectedValue(secondaryErr),
    });
    _setPoolsForTesting(primary, secondary);
    process.env.DSQL_USE_SECONDARY = 'false';

    await expect(query('SELECT 1')).rejects.toThrow('secondary also down');
  });

  it('passes sql and params through to the pool', async () => {
    const mockFn = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const primary = makeMockPool({ totalCount: 1, query: mockFn });
    _setPoolsForTesting(primary, null);
    process.env.DSQL_USE_SECONDARY = 'false';

    await query('SELECT * FROM users WHERE id = $1', ['abc-123']);
    expect(mockFn).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', ['abc-123']);
  });
});

// ---------------------------------------------------------------------------
// Tests: closeAllPools
// ---------------------------------------------------------------------------

describe('closeAllPools', () => {
  it('calls end() on both pools when both have been initialised', async () => {
    const primary = makeMockPool({ totalCount: 2 });
    const secondary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    await closeAllPools();

    expect(primary.end).toHaveBeenCalledTimes(1);
    expect(secondary.end).toHaveBeenCalledTimes(1);
  });

  it('does not throw if pools were never initialised', async () => {
    _setPoolsForTesting(null, null);
    await expect(closeAllPools()).resolves.toBeUndefined();
  });

  it('resets the unhealthy state after closing', async () => {
    const primary = makeMockPool({ totalCount: 1 });
    const secondary = makeMockPool({ totalCount: 1 });
    _setPoolsForTesting(primary, secondary);

    markPrimaryUnhealthy();
    expect(isPrimaryUnhealthy()).toBe(true);

    await closeAllPools();
    expect(isPrimaryUnhealthy()).toBe(false);
  });

  it('calls end() only on primary if secondary was never initialised', async () => {
    const primary = makeMockPool({ totalCount: 2 });
    _setPoolsForTesting(primary, null);

    await closeAllPools();
    expect(primary.end).toHaveBeenCalledTimes(1);
  });
});
