/**
 * Tests for the scheduler run ledger — the CC9 dead-man's-switch.
 *
 * The heartbeat sweep's success signal is a side effect (rows transitioned). A
 * passing page render proves nothing. The ABSENCE of a run is the condition
 * that must alarm.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { recordSchedulerRun, getSchedulerHealth, STALE_AFTER_SECONDS } from './scheduler-ledger';

const mockQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('STALE_AFTER_SECONDS', () => {
  it('allows one missed hourly run plus slack', () => {
    expect(STALE_AFTER_SECONDS).toBe(9000); // 2.5 h
  });

  it('is longer than the hourly schedule so a single late run does not alarm', () => {
    expect(STALE_AFTER_SECONDS).toBeGreaterThan(3600);
  });
});

describe('recordSchedulerRun', () => {
  it('records a run with its sweep counters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await recordSchedulerRun({ evaluated: 5, transitioned: 2, failures: 0 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO scheduler_runs/i);
    expect(params).toEqual([5, 2, 0]);
  });
});

describe('getSchedulerHealth', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('is healthy when the last run is recent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T11:30:00Z' }] } as never);

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(true);
    expect(health.ageSeconds).toBe(1800);
    expect(health.lastRunAt).toBe('2026-08-06T11:30:00Z');
  });

  it('is UNHEALTHY when the last run is older than the threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T00:00:00Z' }] } as never);

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(false);
    expect(health.ageSeconds).toBe(43200);
  });

  it('is UNHEALTHY when the sweep has never run — the never-scheduled case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(false);
    expect(health.lastRunAt).toBeNull();
    expect(health.ageSeconds).toBeNull();
  });

  it('is healthy exactly at the threshold boundary', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T09:30:00Z' }] } as never);

    const health = await getSchedulerHealth(now);

    expect(health.ageSeconds).toBe(STALE_AFTER_SECONDS);
    expect(health.healthy).toBe(true);
  });

  it('is unhealthy one second past the threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T09:29:59Z' }] } as never);

    expect((await getSchedulerHealth(now)).healthy).toBe(false);
  });

  it('reads the most recent heartbeat run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T11:30:00Z' }] } as never);

    await getSchedulerHealth(now);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY ran_at DESC/i);
    expect(sql).toMatch(/LIMIT 1/i);
    expect(sql).toMatch(/job = 'heartbeat'/i);
  });

  it('always reports the threshold so a monitor can explain itself', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    expect((await getSchedulerHealth(now)).thresholdSeconds).toBe(STALE_AFTER_SECONDS);
  });
});
