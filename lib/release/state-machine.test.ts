/**
 * Tests for lib/release/state-machine.ts
 *
 * Validates: Requirements 5.1–5.10
 *  - Property 11: Only permitted state transitions succeed
 *  - Property 12: GRACE → RELEASED requires both conditions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  ReleaseStateMachine,
  isPermittedTransition,
  isReversibleTrigger,
  canRelease,
  PERMITTED_TRANSITIONS,
  IllegalTransitionError,
  CasMismatchError,
  OccExhaustedError,
  GraceConditionError,
  type ReleaseStateValue,
  type ReleaseStateRow,
} from './state-machine';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

const ALL_STATES: ReleaseStateValue[] = ['armed', 'pending', 'grace', 'released', 'cancelled'];

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function sqlState40001() {
  return Object.assign(new Error('serialization failure'), { code: '40001' });
}

function makeRow(overrides: Partial<ReleaseStateRow> = {}): ReleaseStateRow {
  return {
    id: 'rs-1',
    owner_id: 'owner-1',
    trigger_type: 'emergency',
    state: 'armed',
    required_confirmations: 1,
    received_confirmations: 0,
    version: '0',
    initiated_by: null,
    initiated_at: null,
    grace_ends_at: null,
    released_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Machine with deterministic, instant backoff for tests.
function machine() {
  return new ReleaseStateMachine({ sleep: async () => {}, random: () => 0, maxRetries: 3 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 11 — only permitted transitions succeed
// ---------------------------------------------------------------------------

describe('Property 11: only permitted state transitions succeed', () => {
  it('isPermittedTransition matches the table exactly for all pairs + reversibility', () => {
    // Feature: relay-h0-mvp, Property 11
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        fc.constantFrom(...ALL_STATES),
        fc.boolean(),
        (from, to, reversible) => {
          const expected = PERMITTED_TRANSITIONS.some(
            (t) => t.from === from && t.to === to && (!t.reversibleOnly || reversible),
          );
          expect(isPermittedTransition(from, to, reversible)).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('transition() rejects a non-permitted edge before any DB write', async () => {
    await expect(machine().transition('rs-1', 'armed', 'released', '0')).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('estate (non-reversible) cannot take a reversible-only edge', () => {
    expect(isReversibleTrigger('estate')).toBe(false);
    // RELEASED→ARMED is reversible-only ⇒ forbidden for estate (Req 5.10)
    expect(isPermittedTransition('released', 'armed', false)).toBe(false);
    expect(isPermittedTransition('released', 'armed', true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CAS commit + OCC retry behaviour
// ---------------------------------------------------------------------------

describe('transition() CAS + OCC', () => {
  it('commits a permitted transition and writes an audit entry', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'pending', version: '1' })]));
    const row = await machine().transition('rs-1', 'armed', 'pending', '0');
    expect(row.state).toBe('pending');
    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockAudit.mock.calls[0][1].action).toBe('release_transition_pending');
    // CAS WHERE clause guards on state + version
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('state = $3');
    expect(sql).toContain('version = $4');
  });

  it('throws CasMismatchError (with re-read row) when the CAS matches 0 rows', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([])) // UPDATE matched nothing
      .mockResolvedValueOnce(qResult([makeRow({ state: 'grace', version: '5' })])); // re-read
    try {
      await machine().transition('rs-1', 'armed', 'pending', '0');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CasMismatchError);
      expect((e as CasMismatchError).current?.state).toBe('grace');
    }
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('retries a 40001 and succeeds on the next attempt', async () => {
    let updateCalls = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM release_state')) {
        return qResult([makeRow({ state: 'armed', version: '0' })]); // re-read
      }
      // CAS UPDATE: throw once, then succeed
      updateCalls++;
      if (updateCalls === 1) throw sqlState40001();
      return qResult([makeRow({ state: 'pending', version: '1' })]);
    });

    const row = await machine().transition('rs-1', 'armed', 'pending', '0');
    expect(row.state).toBe('pending');
    expect(updateCalls).toBe(2);
  });

  it('resets to ARMED and throws OccExhaustedError after exhausting retries', async () => {
    let resetCalled = false;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SET state = 'armed'")) {
        resetCalled = true;
        return qResult([makeRow({ state: 'armed', version: '9' })]);
      }
      if (sql.includes('SELECT * FROM release_state')) {
        return qResult([makeRow({ state: 'armed', version: '0' })]);
      }
      throw sqlState40001(); // every CAS UPDATE fails
    });

    await expect(machine().transition('rs-1', 'armed', 'pending', '0')).rejects.toBeInstanceOf(
      OccExhaustedError,
    );
    expect(resetCalled).toBe(true);
  });

  it('propagates a non-40001 DB error without retrying', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '23505' }));
    await expect(machine().transition('rs-1', 'armed', 'pending', '0')).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// safeResetToArmed
// ---------------------------------------------------------------------------

describe('safeResetToArmed', () => {
  it('unconditionally sets state=armed and never throws on failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(machine().safeResetToArmed('rs-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property 12 — GRACE → RELEASED requires both conditions
// ---------------------------------------------------------------------------

describe('Property 12: GRACE → RELEASED requires both conditions', () => {
  it('canRelease is true iff received ≥ required AND grace elapsed', () => {
    // Feature: relay-h0-mvp, Property 12
    fc.assert(
      fc.property(
        fc.record({
          received: fc.nat({ max: 10 }),
          required: fc.integer({ min: 1, max: 10 }),
          graceElapsed: fc.boolean(),
        }),
        ({ received, required, graceElapsed }) => {
          const now = new Date('2026-06-18T00:00:00Z');
          const graceEndsAt = new Date(now.getTime() + (graceElapsed ? -1000 : 1000));
          const expected = received >= required && graceElapsed;
          expect(canRelease(received, required, graceEndsAt.toISOString(), now)).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('canRelease is false when grace_ends_at is null', () => {
    expect(canRelease(5, 1, null, new Date('2026-06-18T00:00:00Z'))).toBe(false);
  });

  it('releaseFromGrace throws GraceConditionError when the guard fails (no DB write)', async () => {
    const row = makeRow({
      state: 'grace',
      received_confirmations: 0,
      required_confirmations: 2,
      grace_ends_at: '2020-01-01T00:00:00Z',
    });
    await expect(machine().releaseFromGrace(row, new Date('2026-06-18T00:00:00Z'))).rejects.toBeInstanceOf(
      GraceConditionError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('releaseFromGrace commits and stamps released_at when both conditions hold', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'released', version: '3' })]));
    const row = makeRow({
      state: 'grace',
      received_confirmations: 2,
      required_confirmations: 2,
      grace_ends_at: '2020-01-01T00:00:00Z',
    });
    const out = await machine().releaseFromGrace(row, new Date('2026-06-18T00:00:00Z'));
    expect(out.state).toBe('released');
    // released_at supplied as an extra SET column in the same CAS commit
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params.some((p) => typeof p === 'string' && p.startsWith('2026-06-18'))).toBe(true);
  });
});
