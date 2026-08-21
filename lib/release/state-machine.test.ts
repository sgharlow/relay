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
  /*
    🔴 EVERY OTHER TEST IN THIS BLOCK USES THE TABLE AS ITS OWN ORACLE. The
    property below computes `expected` from PERMITTED_TRANSITIONS and then
    asserts `isPermittedTransition` agrees with it — which it must, since the
    function reads the same array. Flip any `reversibleOnly` flag and the whole
    file stays green. Elsewhere the table is pinned only by its LENGTH (7, in
    challenge.test.ts, escalation.test.ts and triggers.test.ts), and a flipped
    flag does not change the length.

    A flag flip is not hypothetical damage. `armed → pending` with
    `reversibleOnly: true` would silently exempt non-reversible triggers from
    ever arming; `released → armed` with it FALSE would hand estate the exact
    edge Req 5.10 forbids. So the seven rows are transcribed here literally from
    design.md's Permitted Transition Table — the authoritative source named in
    CLAUDE.md — and this is the one assertion in the file that does not consult
    the code to decide what the code should say. Order included: a reordering is
    harmless but it is also not a thing anyone should be doing silently.

    Added 2026-08-21.
  */
  it('is exactly the seven rows design.md specifies, with their flags', () => {
    expect(PERMITTED_TRANSITIONS).toEqual([
      { from: 'armed', to: 'pending', reversibleOnly: false },
      { from: 'pending', to: 'grace', reversibleOnly: false },
      { from: 'pending', to: 'armed', reversibleOnly: true },
      { from: 'grace', to: 'released', reversibleOnly: false },
      { from: 'grace', to: 'armed', reversibleOnly: true },
      { from: 'grace', to: 'cancelled', reversibleOnly: true },
      { from: 'released', to: 'armed', reversibleOnly: true },
    ]);
  });

  /*
    The three forward edges every release takes, asserted for a NON-reversible
    trigger. Nothing tested these directly: `reversible` was only ever exercised
    as the thing that makes a reversible-only edge legal, so an edge wrongly
    marked reversible-only would have failed no assertion here.
  */
  it.each([
    ['armed', 'pending'],
    ['pending', 'grace'],
    ['grace', 'released'],
  ] as const)('%s → %s is open to a non-reversible trigger', (from, to) => {
    expect(isPermittedTransition(from, to, false)).toBe(true);
  });

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

  /*
    The retry loop's OTHER exit, uncovered until 2026-08-21. After a 40001 the
    loop re-reads the row and re-evaluates whether the ORIGINAL destination is
    still reachable from wherever the row has landed; if it is not, the retry is
    abandoned with the row it found rather than retried against a state the
    caller never asked about. Cancelled is the sharpest case — a terminal state
    with no outgoing edge — and retrying into it would mean a serialization
    failure could complete a transition an owner had just cancelled.
  */
  it('abandons the retry when the row moved somewhere the edge no longer applies', async () => {
    mockQuery
      .mockRejectedValueOnce(sqlState40001()) // CAS UPDATE
      .mockResolvedValueOnce(qResult([makeRow({ state: 'cancelled', version: '9' })])); // re-read

    try {
      await machine().transition('rs-1', 'armed', 'pending', '0');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CasMismatchError);
      expect((e as CasMismatchError).current?.state).toBe('cancelled');
    }
    // Abandoned, not retried: no second UPDATE, and no reset of a cancelled row.
    expect(mockQuery).toHaveBeenCalledTimes(2);
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
  it('never throws on failure — a failed reset must not mask the original error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(machine().safeResetToArmed('rs-1')).resolves.toBeUndefined();
  });

  /*
    🔴 THE ONE WRITE IN THE RELEASE SUBSYSTEM THAT IGNORED THE TRANSITION TABLE,
    guarded 2026-08-21. It was `WHERE id = $1` and nothing else — no state
    predicate, no permitted-transition check — so "default to locked" was
    implemented as a write that could undo a COMMITTED release.

    Two callers reach it, and both can race a release: `transition()` on OCC
    exhaustion, and the J7-R7 denial halt, which reads the row, then does five
    queries' worth of eligibility work, then resets. A confirmation landing in
    that gap releases the row; the halt then quietly closed the access that had
    just legitimately opened — no recipient notice, no closure mail, stale
    counters. For estate it was worse: released→armed is precisely the edge
    Req 5.10 forbids, and this was the one path that could take it.

    The guard is the two states where nothing has opened yet. A row already
    RELEASED, ARMED or CANCELLED is left exactly where it is, which is what
    "default-safe: any ambiguity holds the locked state" actually asks for —
    holding, not reversing.
  */
  it('does NOT reset a RELEASED row — default-to-locked never means undo a release', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await machine().safeResetToArmed('rs-1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/state\s+IN\s*\(\s*'pending'\s*,\s*'grace'\s*\)/);
    expect(params).toEqual(['rs-1']);
    // No row matched ⇒ nothing happened, and nothing is logged as if it had.
    expect(mockAudit).not.toHaveBeenCalled();
  });

  /*
    The halt is a RE-ARM, so it owes the same clean tally every other re-arm
    path now gives (see rearm-clears-the-ledger.test.ts). It did not: the
    denials that caused the halt, and any confirmations already cast, survived
    into ARMED. The next emergency on that trigger then started carrying the
    old objections — enough of them to halt it again before anybody answered.
  */
  it('clears the tally as it re-arms, so the next release starts at 0/N with 0 denials', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed', version: '4' })]));
    await machine().safeResetToArmed('rs-1');

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/received_confirmations\s*=\s*0/);
    expect(sql).toMatch(/received_denials\s*=\s*0/);
    expect(sql).toMatch(/grace_ends_at\s*=\s*NULL/i);
    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockAudit.mock.calls[0][1].action).toBe('release_safe_reset_armed');
  });

  /*
    THE SECOND CALLER, PINNED RATHER THAN INHERITED. The tally clear above was
    argued for the denial halt only — "a halt is a re-arm" — but it lands on
    `transition()`'s OCC-exhaustion path too, and that path includes
    GRACE→RELEASED with a quorum already met. So a serialization storm at the
    exact moment of release now discards confirmations verifiers legitimately
    cast, where before this change they survived into the next emergency.

    That is the RIGHT direction and the argument was missing, not wrong.
    Discarding a met quorum re-asks people; preserving it would release on
    answers nobody re-gave. It is also what makes the initiated_at-scoped
    idempotency coherent (`lib/release/triggers.ts` — a confirmation only counts
    as a duplicate if it lands at or after the current `initiated_at`): a
    re-armed row stamps a NEW instant, so every verifier is asked again and
    every fresh answer counts. Preserve the old tally and those fresh answers
    increment ON TOP of it — a double count, and a release reached on half the
    confirmations it claims.

    An undiscussed second caller is how this class of change comes back as a
    surprise, so it gets its own assertion rather than riding on the halt's.
  */
  it('clears the tally on the OCC-exhaustion caller too, not just the denial halt', async () => {
    let resetSql = '';
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SET state = 'armed'")) {
        resetSql = sql;
        return qResult([makeRow({ state: 'armed', version: '9' })]);
      }
      if (sql.includes('SELECT * FROM release_state')) {
        return qResult([makeRow({ state: 'grace', version: '3' })]);
      }
      throw sqlState40001(); // every CAS UPDATE fails
    });

    await expect(
      machine().transition('rs-1', 'grace', 'released', '3'),
    ).rejects.toBeInstanceOf(OccExhaustedError);

    expect(resetSql).toMatch(/received_confirmations\s*=\s*0/);
    expect(resetSql).toMatch(/received_denials\s*=\s*0/);
    expect(resetSql).toMatch(/grace_ends_at\s*=\s*NULL/i);
    // And it is still bounded by the state predicate — a row that raced to
    // RELEASED underneath the retry loop must be left alone.
    expect(resetSql).toMatch(/state\s+IN\s*\(\s*'pending'\s*,\s*'grace'\s*\)/);
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
