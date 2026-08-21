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

/*
 * 🔴 THE DEAD-MAN'S SWITCH ONLY EVER PROVED THE CRON RAN.
 *
 * Every sweep writes `failures`, and until now nothing read the column: health
 * was `ran_at` plus a threshold. So a heartbeat firing punctually every hour
 * while failing EVERY transition — OCC exhaustion, a DB fault, a bad deploy —
 * answered 200 healthy the entire time.
 *
 * The job being watched IS the dead-man's switch: the thing that advances an
 * overdue release when an owner has stopped checking in. A silent total failure
 * means nobody's release ever opens, and the probe built to catch precisely that
 * says everything is fine. Running is necessary, not sufficient.
 */
describe('the probe notices a sweep that runs and achieves nothing', () => {
  const now = new Date('2026-08-06T12:00:00Z');
  const run = (over: Record<string, unknown>) =>
    ({ rows: [{ ran_at: '2026-08-06T11:30:00Z', transitioned: 0, failures: 0, ...over }] }) as never;

  it('is UNHEALTHY when every attempted transition failed', async () => {
    mockQuery.mockResolvedValueOnce(run({ transitioned: 0, failures: 5 }));

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(false);
    expect(health.failures).toBe(5);
    // Fresh, and still not healthy — which is the whole point.
    expect(health.ageSeconds).toBe(1800);
  });

  it('stays healthy on a PARTIAL failure, which the next sweep retries', async () => {
    // Alarming on one lost CAS race would train people to ignore the alarm.
    mockQuery.mockResolvedValueOnce(run({ transitioned: 4, failures: 1 }));

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(true);
    expect(health.failures).toBe(1); // reported anyway
  });

  it('stays healthy on an idle sweep — zero of zero is not a failure', async () => {
    mockQuery.mockResolvedValueOnce(run({ transitioned: 0, failures: 0 }));
    await expect(getSchedulerHealth(now)).resolves.toMatchObject({ healthy: true });
  });

  it('reports the counts even when healthy, so a number is never unreadable again', async () => {
    mockQuery.mockResolvedValueOnce(run({ transitioned: 3, failures: 0 }));

    const health = await getSchedulerHealth(now);

    expect(health.transitioned).toBe(3);
    expect(health.failures).toBe(0);
  });

  it('treats NULL counts as zero rather than crashing an unauthenticated probe', async () => {
    // Rows written before these columns were populated.
    mockQuery.mockResolvedValueOnce(run({ transitioned: null, failures: null }));
    await expect(getSchedulerHealth(now)).resolves.toMatchObject({ healthy: true, failures: 0 });
  });

  it('still reads the failure column at all', async () => {
    mockQuery.mockResolvedValueOnce(run({}));
    await getSchedulerHealth(now);
    expect(String(mockQuery.mock.calls[0][0])).toContain('failures');
  });
});

/*
 * 🔴 AND IT ONLY EVER WATCHED THE FIRST PHASE. Closed 2026-08-21.
 *
 * `transitioned` and `failures` come from `runHeartbeatSweep`, which does one
 * thing: ARMED → PENDING → GRACE. The two legs that run after it in the same
 * cron reported into a JSON response nobody reads and swallowed their failures
 * without so much as a stderr line:
 *
 *   - `resolveElapsedGrace` — GRACE → RELEASED. The transition that actually
 *     opens a vault once quorum is met and the window has passed. THE product
 *     event.
 *   - `escalateLapsedRequests` — a request the owner never answered, handed on
 *     to the verifiers.
 *
 * So the exact failure the `didWork` rule was written for could recur one phase
 * later and this probe would answer 200 forever: sweep runs punctually, arms
 * nothing because nothing is overdue, `failures: 0`, healthy — while every
 * quorum-met release in the database sits in GRACE and never opens.
 *
 * MEASURED FROM THE WORK ITSELF, NOT FROM A COUNTER THE SWEEP REMEMBERS TO
 * WRITE. The obvious fix was new scheduler_runs columns, which needs a
 * migration in two regions and is a second thing that can silently stop being
 * written — the same shape as the bug. The rows that OUGHT to have been
 * resolved are queryable directly, so the probe asks the database what is stuck
 * rather than asking the sweep how it thinks it did. It also works for a
 * failure that never reached the sweep at all: a cron that stopped invoking the
 * later legs, a deploy where the call was dropped.
 */
describe('the probe notices the phases the sweep never reported', () => {
  const now = new Date('2026-08-06T12:00:00Z');
  const run = (over: Record<string, unknown>) =>
    ({
      rows: [
        {
          ran_at: '2026-08-06T11:30:00Z',
          transitioned: 0,
          failures: 0,
          grace_overdue: 0,
          escalation_overdue: 0,
          ...over,
        },
      ],
    }) as never;

  it('is UNHEALTHY when a quorum-met GRACE row has stayed unreleased past the threshold', async () => {
    mockQuery.mockResolvedValueOnce(run({ grace_overdue: 1 }));

    const health = await getSchedulerHealth(now);

    // Punctual, zero failures, and still not healthy — the vault that should
    // have opened has not.
    expect(health.ageSeconds).toBe(1800);
    expect(health.failures).toBe(0);
    expect(health.healthy).toBe(false);
    expect(health.graceOverdue).toBe(1);
  });

  it('is UNHEALTHY when a lapsed request has sat unescalated past the threshold', async () => {
    mockQuery.mockResolvedValueOnce(run({ escalation_overdue: 2 }));

    const health = await getSchedulerHealth(now);

    expect(health.healthy).toBe(false);
    expect(health.escalationOverdue).toBe(2);
  });

  /*
    A row becomes due the instant its window passes, and the cron is hourly, so
    "due right now" is the ordinary state of affairs. Only a row still due after
    a whole missed run plus slack means the resolver is not running — the same
    threshold and the same reasoning as the staleness check, so a single lost
    CAS race never pages anyone.
  */
  it('asks only about rows that have been due longer than one missed run', async () => {
    mockQuery.mockResolvedValueOnce(run({}));

    await getSchedulerHealth(now);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM release_state/i);
    expect(sql).toMatch(/FROM access_requests/i);
    // now − STALE_AFTER_SECONDS, not now.
    expect(params).toEqual([new Date(now.getTime() - STALE_AFTER_SECONDS * 1000).toISOString()]);
  });

  it('is healthy when nothing is stuck', async () => {
    mockQuery.mockResolvedValueOnce(run({}));
    await expect(getSchedulerHealth(now)).resolves.toMatchObject({
      healthy: true,
      graceOverdue: 0,
      escalationOverdue: 0,
    });
  });

  /*
    A probe that 500s is a probe that cannot tell a monitor anything, and this
    endpoint is public and unauthenticated. Absent columns read as zero rather
    than NaN — which would make `> 0` false and silently disable the check, so
    the test says which direction the fallback goes.
  */
  it('treats absent overdue counts as zero rather than crashing the probe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ran_at: '2026-08-06T11:30:00Z' }] } as never);
    await expect(getSchedulerHealth(now)).resolves.toMatchObject({
      healthy: true,
      graceOverdue: 0,
      escalationOverdue: 0,
    });
  });
});
