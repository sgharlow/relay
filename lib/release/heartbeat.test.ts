/**
 * Tests for lib/release/heartbeat.ts
 *
 * Validates: Requirements 4.2, 4.3, 4.5, 4.7
 *  - Property 9:  Heartbeat overdue detection
 *  - Property 10: Heartbeat recovery (PENDING → ARMED); estate rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { isOverdue, processCheckin, runHeartbeatSweep } from './heartbeat';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 9 — overdue detection
// ---------------------------------------------------------------------------

describe('Property 9: heartbeat overdue detection', () => {
  it('isOverdue is true iff elapsed time strictly exceeds the interval', () => {
    // Feature: relay-h0-mvp, Property 9
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }), // intervalDays
        fc.integer({ min: -400, max: 400 }), // offset days vs the exact boundary
        (intervalDays, offsetDays) => {
          const now = new Date('2026-06-18T00:00:00Z');
          // last_active_at = now - (intervalDays + offsetDays) days
          const elapsedDays = intervalDays + offsetDays;
          const lastActiveAt = new Date(now.getTime() - elapsedDays * MS_PER_DAY);
          const expected = elapsedDays * MS_PER_DAY > intervalDays * MS_PER_DAY;
          expect(isOverdue(lastActiveAt, intervalDays, now)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exactly-at-interval is not yet overdue', () => {
    const now = new Date('2026-06-18T00:00:00Z');
    const last = new Date(now.getTime() - 30 * MS_PER_DAY);
    expect(isOverdue(last, 30, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 10 — heartbeat recovery
// ---------------------------------------------------------------------------

describe('Property 10: heartbeat recovery (PENDING → ARMED); estate rejected', () => {
  it('reversible triggers in PENDING reset to ARMED; estate is blocked', async () => {
    // Feature: relay-h0-mvp, Property 10
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('emergency', 'travel', 'caregiver', 'business', 'estate'),
        fc.constantFrom('pending', 'grace'),
        async (triggerType, state) => {
          vi.clearAllMocks();
          const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);

          mockQuery.mockImplementation(async (sql: string) => {
            if (sql.startsWith('UPDATE users')) return qResult([]);
            if (sql.includes('FROM release_state')) {
              return qResult([{ id: 'rs-1', trigger_type: triggerType, state, version: '0' }]);
            }
            return qResult([]);
          });

          const result = await processCheckin('owner-1', { transition } as never);

          if (triggerType === 'estate') {
            expect(result.blocked).toEqual(['estate']);
            expect(result.reset).toEqual([]);
            expect(transition).not.toHaveBeenCalled();
          } else {
            expect(result.reset).toEqual([triggerType]);
            expect(result.blocked).toEqual([]);
            expect(transition).toHaveBeenCalledOnce();
            // transitions to 'armed' from the current PENDING/GRACE state
            expect(transition.mock.calls[0][2]).toBe('armed');
            expect(transition.mock.calls[0][1]).toBe(state);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('records the heartbeat (updates last_active_at) and writes an audit entry', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      return qResult([]); // no pending/grace rows
    });
    await processCheckin('owner-1', { transition } as never);
    expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users SET last_active_at');
    expect(mockAudit.mock.calls[0][1].action).toBe('owner_checkin');
  });

  it('re-arms a RELEASED reversible trigger (closing access) and resets the bookkeeping', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-1', trigger_type: 'emergency', state: 'released', version: '3' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result.reset).toEqual(['emergency']);
    expect(transition).toHaveBeenCalledOnce();
    expect(transition.mock.calls[0][1]).toBe('released'); // from
    expect(transition.mock.calls[0][2]).toBe('armed'); // to
    const opts = transition.mock.calls[0][4] as { updates?: Record<string, unknown> };
    expect(opts.updates).toMatchObject({ received_confirmations: 0, grace_ends_at: null, released_at: null });
  });

  it('blocks a RELEASED estate trigger (permanent — cannot reverse)', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-2', trigger_type: 'estate', state: 'released', version: '3' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result.blocked).toEqual(['estate']);
    expect(transition).not.toHaveBeenCalled();
  });

  it('does not fail the whole check-in if one reversible row races (CAS error)', async () => {
    const transition = vi.fn(async () => {
      throw new Error('CAS mismatch');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-1', trigger_type: 'emergency', state: 'pending', version: '0' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result).toEqual({ reset: [], blocked: [] });
  });
});

// ---------------------------------------------------------------------------
// Cron sweep
// ---------------------------------------------------------------------------

describe('runHeartbeatSweep', () => {
  function setupOwners(armedRows: Record<string, unknown>[]) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return qResult([{ id: 'owner-1' }]);
      if (sql.includes("state = 'armed'")) return qResult(armedRows);
      return qResult([]);
    });
  }

  it('advances each overdue ARMED release_state through PENDING into GRACE', async () => {
    setupOwners([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
    const transition = vi
      .fn()
      .mockResolvedValueOnce({ id: 'rs-1', version: 1 } as never) // armed -> pending
      .mockResolvedValueOnce({ id: 'rs-1', version: 2 } as never); // pending -> grace

    const res = await runHeartbeatSweep({ transition } as never, { sleep: async () => {}, now: () => new Date('2026-06-18T00:00:00Z') });
    expect(res).toEqual({ evaluated: 1, transitioned: 1, failures: 0 });
    expect(transition.mock.calls[0][1]).toBe('armed');
    expect(transition.mock.calls[0][2]).toBe('pending');
    expect(transition.mock.calls[1][1]).toBe('pending');
    expect(transition.mock.calls[1][2]).toBe('grace');
    // the GRACE transition stamps the grace window
    expect((transition.mock.calls[1][4] as { updates?: { grace_ends_at?: string } }).updates?.grace_ends_at).toBeDefined();
  });

  it('retries a failing owner then logs + counts a failure (Req 4.7)', async () => {
    setupOwners([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
    const transition = vi.fn(async () => {
      throw new Error('transient');
    });
    const sleep = vi.fn(async () => {});

    const res = await runHeartbeatSweep({ transition } as never, { sleep, now: () => new Date('2026-06-18T00:00:00Z') });
    expect(res).toEqual({ evaluated: 1, transitioned: 0, failures: 1 });
    expect(transition).toHaveBeenCalledTimes(3); // max 3 attempts
    expect(sleep).toHaveBeenCalledTimes(2); // backoff between attempts
  });
});
