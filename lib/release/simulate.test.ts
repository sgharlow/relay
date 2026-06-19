/**
 * Tests for lib/release/simulate.ts
 *
 * Validates: Requirements 9.2–9.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { runSimulation } from './simulate';
import { TriggerError } from './triggers';
import type { ReleaseStateRow } from './state-machine';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function makeRow(overrides: Partial<ReleaseStateRow> = {}): ReleaseStateRow {
  return {
    id: 'rs-1',
    owner_id: 'owner-1',
    trigger_type: 'emergency',
    state: 'armed',
    required_confirmations: 2,
    received_confirmations: 0,
    version: 0,
    initiated_by: null,
    initiated_at: null,
    grace_ends_at: null,
    released_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('runSimulation', () => {
  const now = () => new Date('2026-06-18T00:00:00Z');

  it('advances ARMED → PENDING → GRACE → RELEASED via real CAS transitions', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed', version: 0 })]));

    // The machine returns the next row each call, threading the version.
    const transition = vi.fn(async (..._a: unknown[]) => {
      const to = _a[2] as string;
      const next: Record<string, number> = { pending: 1, grace: 2, released: 3 };
      return makeRow({ state: to as never, version: next[to] }) as never;
    });

    const res = await runSimulation({
      ownerId: 'owner-1',
      triggerType: 'emergency',
      machine: { transition } as never,
      sleep: async () => {},
      now,
    });

    expect(res.states).toEqual(['pending', 'grace', 'released']);
    expect(transition).toHaveBeenCalledTimes(3);
    expect(transition.mock.calls[0][2]).toBe('pending');
    expect(transition.mock.calls[1][2]).toBe('grace');
    expect(transition.mock.calls[2][2]).toBe('released');
  });

  it('tags every transition audit with simulated:true and auto-satisfies the quorum (Req 9.4/9.6)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed', required_confirmations: 5 })]));
    const transition = vi.fn(async (..._a: unknown[]) =>
      makeRow({ state: _a[2] as never, required_confirmations: 5 }) as never,
    );

    await runSimulation({ ownerId: 'owner-1', triggerType: 'emergency', machine: { transition } as never, sleep: async () => {}, now });

    // PENDING→GRACE call auto-satisfies received = required and carries the bypass flag.
    const graceOpts = transition.mock.calls[1][4] as { updates: Record<string, unknown>; auditDetail: Record<string, unknown> };
    expect(graceOpts.updates.received_confirmations).toBe(5);
    expect(graceOpts.auditDetail.simulated).toBe(true);
    expect(graceOpts.auditDetail.confirmations_bypassed).toBe(true);
    // every transition carries simulated:true
    for (const call of transition.mock.calls) {
      expect((call[4] as { auditDetail: Record<string, unknown> }).auditDetail.simulated).toBe(true);
    }
  });

  it('writes a suppressed-notification audit event (Req 9.5)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed' })]));
    const transition = vi.fn(async (..._a: unknown[]) => makeRow({ state: _a[2] as never }) as never);

    await runSimulation({ ownerId: 'owner-1', triggerType: 'emergency', machine: { transition } as never, sleep: async () => {}, now });

    const suppressed = mockAudit.mock.calls.find((c) => c[1].action === 'notification_suppressed');
    expect(suppressed).toBeDefined();
    expect(suppressed![1].detail).toMatchObject({ suppressed: true });
  });

  it('sleeps 3 + 3 + 4 = 10s across the three steps (Req 9.2)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed' })]));
    const transition = vi.fn(async (..._a: unknown[]) => makeRow({ state: _a[2] as never }) as never);
    const sleep = vi.fn(async (..._a: unknown[]) => {});

    await runSimulation({ ownerId: 'owner-1', triggerType: 'emergency', machine: { transition } as never, sleep, now });

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000, 3000, 4000]);
  });

  it('throws 409 without any transition when not ARMED (Req 9.7)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'pending' })]));
    const transition = vi.fn();
    await expect(
      runSimulation({ ownerId: 'owner-1', triggerType: 'emergency', machine: { transition } as never, sleep: async () => {}, now }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(transition).not.toHaveBeenCalled();
  });

  it('throws 404 when no release_state exists for the trigger', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(
      runSimulation({ ownerId: 'owner-1', triggerType: 'emergency', machine: { transition: vi.fn() } as never, sleep: async () => {}, now }),
    ).rejects.toBeInstanceOf(TriggerError);
  });
});
