/**
 * Tests for lib/release/triggers.ts
 *
 * Validates: Requirements 6.3–6.6, 6.9
 *  - Property 14: Verifier confirmation idempotency
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../notify/notifications', () => ({ notifyRecipientsOfRelease: vi.fn(async () => 0) }));

import { writeAuditEntry } from '../audit/audit-service';
import { query } from '../db/connection';
import { notifyRecipientsOfRelease } from '../notify/notifications';
import {
  submitConfirmation,
  initiateTrigger,
  cancelTrigger,
  standDownTrigger,
  resendReleaseNotifications,
  TriggerError,
} from './triggers';
import { isPermittedTransition, PERMITTED_TRANSITIONS } from './state-machine';
import type { ReleaseStateRow } from './state-machine';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function makeRow(overrides: Partial<ReleaseStateRow> = {}): ReleaseStateRow {
  return {
    id: 'rs-1',
    owner_id: 'owner-1',
    trigger_type: 'emergency',
    state: 'grace',
    required_confirmations: 2,
    received_confirmations: 0,
    version: 0,
    initiated_by: null,
    initiated_at: null,
    grace_ends_at: '2020-01-01T00:00:00Z', // already elapsed by default
    released_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** In-memory release_state + verifier_confirmations behind the query mock. */
function installSim(initial: ReleaseStateRow, verifierPool = 3) {
  const row = { ...initial } as ReleaseStateRow & { version: number };
  row.version = Number(initial.version);
  const confirmations: Array<{ id: string; release_state_id: string; verifier_id: string }> = [];

  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const p = params ?? [];
    if (sql.includes('FROM verifier_confirmations')) {
      const matches = confirmations.filter((c) => c.release_state_id === p[0] && c.verifier_id === p[1]);
      return qResult(matches.map((c) => ({ id: c.id })));
    }
    if (sql.startsWith('SELECT * FROM release_state')) {
      return qResult([{ ...row }]);
    }
    if (sql.includes('received_denials')) {
      row.received_denials = Number(row.received_denials ?? 0) + 1;
      row.version += 1;
      return qResult([{ ...row }]);
    }
    if (sql.includes('FROM verifiers')) {
      return qResult([{ n: String(verifierPool) }]);
    }
    if (sql.startsWith('UPDATE release_state')) {
      if (Number(p[1]) === row.version) {
        row.received_confirmations += 1;
        row.version += 1;
        return qResult([{ ...row }]);
      }
      return qResult([]); // CAS mismatch
    }
    if (sql.startsWith('INSERT INTO verifier_confirmations')) {
      confirmations.push({ id: `c${confirmations.length}`, release_state_id: p[0] as string, verifier_id: p[1] as string });
      return qResult([]);
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  return { getRow: () => row, confirmations };
}

const machineStub = () => ({
  releaseFromGrace: vi.fn(async (..._a: unknown[]) => ({}) as never),
  transition: vi.fn(async (..._a: unknown[]) => ({}) as never),
  safeResetToArmed: vi.fn(async (..._a: unknown[]) => undefined),
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 14 — verifier confirmation idempotency
// ---------------------------------------------------------------------------

describe('Property 14: verifier confirmation idempotency', () => {
  it('N ≥ 2 submissions from the same verifier increment received by exactly 1', async () => {
    // Feature: relay-h0-mvp, Property 14
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 20 }), async (n) => {
        const sim = installSim(makeRow({ required_confirmations: 100, received_confirmations: 0, version: 0 }));
        const machine = machineStub();
        for (let i = 0; i < n; i++) {
          await submitConfirmation({
            releaseStateId: 'rs-1',
            verifierId: 'v-1',
            machine,
            now: new Date('2026-06-18T00:00:00Z'),
            sleep: async () => {},
          });
        }
        expect(sim.getRow().received_confirmations).toBe(1);
        expect(sim.confirmations.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// submitConfirmation outcomes
// ---------------------------------------------------------------------------

describe('submitConfirmation', () => {
  const now = new Date('2026-06-18T00:00:00Z');

  it('records a confirmation without releasing when quorum is not met', async () => {
    installSim(makeRow({ required_confirmations: 2, received_confirmations: 0 }));
    const machine = machineStub();
    const out = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    expect(out.status).toBe('recorded');
    expect(out.receivedConfirmations).toBe(1);
    expect(machine.releaseFromGrace).not.toHaveBeenCalled();
  });

  it('releases when quorum met AND grace elapsed (Req 6.5)', async () => {
    installSim(makeRow({ required_confirmations: 1, received_confirmations: 0, grace_ends_at: '2020-01-01T00:00:00Z' }));
    const machine = machineStub();
    const out = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    expect(out.status).toBe('released');
    expect(machine.releaseFromGrace).toHaveBeenCalledOnce();
  });

  it('returns pending_grace when quorum met but grace not yet elapsed (Req 6.6)', async () => {
    installSim(makeRow({ required_confirmations: 1, received_confirmations: 0, grace_ends_at: '2999-01-01T00:00:00Z' }));
    const machine = machineStub();
    const out = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    expect(out.status).toBe('pending_grace');
    expect(out.ownerId).toBe('owner-1');
    expect(machine.releaseFromGrace).not.toHaveBeenCalled();
  });

  it('is a no-op duplicate on a second submission', async () => {
    installSim(makeRow({ required_confirmations: 5 }));
    const machine = machineStub();
    await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    const second = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    expect(second.status).toBe('duplicate');
  });

  it('is inactive when the release is not in PENDING/GRACE', async () => {
    installSim(makeRow({ state: 'armed' }));
    const machine = machineStub();
    const out = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });
    expect(out.status).toBe('inactive');
  });
});

// ---------------------------------------------------------------------------
// initiateTrigger / cancelTrigger
// ---------------------------------------------------------------------------

describe('initiateTrigger', () => {
  it('transitions ARMED → PENDING → GRACE and opens the grace window', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'armed', version: 0 })]));
    const machine = machineStub();
    machine.transition
      .mockResolvedValueOnce(makeRow({ state: 'pending', version: 1 }) as never)
      .mockResolvedValueOnce(makeRow({ state: 'grace', version: 2 }) as never);
    const out = await initiateTrigger('owner-1', 'emergency', machine, new Date('2026-06-18T00:00:00Z'));
    expect(machine.transition.mock.calls[0][1]).toBe('armed');
    expect(machine.transition.mock.calls[0][2]).toBe('pending');
    expect(machine.transition.mock.calls[1][1]).toBe('pending');
    expect(machine.transition.mock.calls[1][2]).toBe('grace');
    // the GRACE transition stamps grace_ends_at so verifier confirmations can release
    const graceOpts = machine.transition.mock.calls[1][4] as { updates?: { grace_ends_at?: string } };
    expect(graceOpts.updates?.grace_ends_at).toBeDefined();
    expect(out.state).toBe('grace');
  });

  it('throws 404 when no release_state exists for the trigger', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(initiateTrigger('owner-1', 'emergency', machineStub(), new Date())).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('throws 409 when the trigger is not ARMED', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'pending' })]));
    await expect(initiateTrigger('owner-1', 'emergency', machineStub(), new Date())).rejects.toBeInstanceOf(
      TriggerError,
    );
  });
});

describe('cancelTrigger', () => {
  it('cancels a reversible GRACE trigger', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', trigger_type: 'emergency' })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'cancelled' }) as never);
    const out = await cancelTrigger('owner-1', 'rs-1', machine);
    expect(machine.transition.mock.calls[0][2]).toBe('cancelled');
    expect(out.state).toBe('cancelled');
  });

  it('rejects cancelling an estate trigger (409)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', trigger_type: 'estate' })]));
    await expect(cancelTrigger('owner-1', 'rs-1', machineStub())).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('rejects a cross-owner cancel (403)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', owner_id: 'someone-else' })]));
    await expect(cancelTrigger('owner-1', 'rs-1', machineStub())).rejects.toMatchObject({ httpStatus: 403 });
  });
});

/**
 * standDownTrigger — the false-alarm control.
 *
 * THE DEFECT THESE EXIST FOR (found 2026-08-08 by driving production): the UI's
 * only stop-control was Cancel, which lands in CANCELLED. Nothing transitions
 * out of CANCELLED and processCheckin does not touch it, so standing down a
 * false alarm permanently retired the access rule — on a product whose headline
 * claim is that emergency access reverses.
 *
 * The critical assertion is the LAST one: this must not become an eighth
 * transition. It reuses pending→armed and grace→armed, which already existed.
 */
describe('standDownTrigger', () => {
  it('takes a GRACE trigger back to ARMED', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', version: 3 })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed', version: 4 }) as never);

    const out = await standDownTrigger('owner-1', 'rs-1', machine);

    expect(machine.transition.mock.calls[0][1]).toBe('grace');
    expect(machine.transition.mock.calls[0][2]).toBe('armed');
    expect(out.state).toBe('armed');
  });

  it('takes a PENDING trigger back to ARMED — a false alarm can be caught early', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'pending', version: 1 })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed', version: 2 }) as never);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(machine.transition.mock.calls[0][1]).toBe('pending');
    expect(machine.transition.mock.calls[0][2]).toBe('armed');
  });

  it('passes reversible:true, since both reverse edges are reversible-only', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace' })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed' }) as never);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(machine.transition.mock.calls[0][4]).toMatchObject({ reversible: true });
  });

  it('REFUSES an estate handoff — permanence is the point (409)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', trigger_type: 'estate' })]));
    await expect(standDownTrigger('owner-1', 'rs-1', machineStub())).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it.each(['armed', 'cancelled'] as const)('refuses to stand down from %s (409)', async (state) => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state })]));
    await expect(standDownTrigger('owner-1', 'rs-1', machineStub())).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it('CLOSES a RELEASED trigger — the differentiator, and the state it matters most in', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'released', version: 4 })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed', version: 5 }) as never);

    const out = await standDownTrigger('owner-1', 'rs-1', machine);

    expect(machine.transition.mock.calls[0][1]).toBe('released');
    expect(machine.transition.mock.calls[0][2]).toBe('armed');
    expect(out.state).toBe('armed');
  });

  it('clears release bookkeeping on re-arm, so the NEXT emergency is not pre-confirmed', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'released', received_confirmations: 3 })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed' }) as never);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(machine.transition.mock.calls[0][4]).toMatchObject({
      updates: { received_confirmations: 0, grace_ends_at: null, released_at: null },
    });
  });

  it('does NOT clear bookkeeping when standing down from GRACE — nothing was released', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace' })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed' }) as never);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect((machine.transition.mock.calls[0][4] as { updates?: unknown }).updates).toBeUndefined();
  });

  it('rejects a cross-owner stand-down (403)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace', owner_id: 'someone-else' })]));
    await expect(standDownTrigger('owner-1', 'rs-1', machineStub())).rejects.toMatchObject({
      httpStatus: 403,
    });
  });

  it('404s on an unknown release state', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(standDownTrigger('owner-1', 'nope', machineStub())).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('writes an audit entry naming the state it came from', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace' })]));
    const machine = machineStub();
    machine.transition.mockResolvedValueOnce(makeRow({ state: 'armed' }) as never);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'trigger_stood_down', detail: expect.objectContaining({ from: 'grace' }) }),
    );
  });

  it('uses ONLY edges already in PERMITTED_TRANSITIONS — no eighth transition', () => {
    for (const from of ['pending', 'grace', 'released'] as const) {
      expect(isPermittedTransition(from, 'armed', true)).toBe(true);
    }
    expect(PERMITTED_TRANSITIONS).toHaveLength(7);
  });
});

describe('resendReleaseNotifications', () => {
  const mockNotify = vi.mocked(notifyRecipientsOfRelease);

  it('notifies recipients for an owned, RELEASED trigger', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'released', version: 4 })]));
    mockNotify.mockResolvedValueOnce(2);
    const n = await resendReleaseNotifications('owner-1', 'rs-1');
    expect(n).toBe(2);
    expect(mockNotify).toHaveBeenCalledWith({ releaseStateId: 'rs-1', ownerId: 'owner-1', triggerType: 'emergency', version: 4 });
  });

  it('404 when the release state is missing', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(resendReleaseNotifications('owner-1', 'rs-1')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('403 on a cross-owner request', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'released', owner_id: 'someone-else' })]));
    await expect(resendReleaseNotifications('owner-1', 'rs-1')).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('409 when the trigger is not RELEASED', async () => {
    mockQuery.mockResolvedValueOnce(qResult([makeRow({ state: 'grace' })]));
    await expect(resendReleaseNotifications('owner-1', 'rs-1')).rejects.toMatchObject({ httpStatus: 409 });
  });
});

// ---------------------------------------------------------------------------
// Verifier decisions: deny and abstain (J7-R5, J7-R7, J7-R8)
// ---------------------------------------------------------------------------

describe('submitConfirmation — deny and abstain', () => {
  const now = new Date('2026-06-18T00:00:00Z');

  it('a denial that leaves the quorum reachable only records it', async () => {
    // 3 verifiers, need 2, one denies -> 2 remain, still exactly enough.
    installSim(makeRow({ required_confirmations: 2, received_confirmations: 0 }), 3);
    const machine = machineStub();

    const out = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      decision: 'deny',
      machine,
      now,
    });

    expect(out.status).toBe('recorded');
    expect(machine.safeResetToArmed).not.toHaveBeenCalled();
    expect(machine.releaseFromGrace).not.toHaveBeenCalled();
  });

  it('HALTS to ARMED when denials make the quorum unreachable', async () => {
    // 3 verifiers, need 2, already one denial -> this second one makes it 2.
    installSim(
      makeRow({ required_confirmations: 2, received_confirmations: 0, received_denials: 1 }),
      3,
    );
    const machine = machineStub();

    const out = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-2',
      decision: 'deny',
      machine,
      now,
    });

    expect(out.status).toBe('halted');
    expect(machine.safeResetToArmed).toHaveBeenCalledWith('rs-1');
  });

  it('a sole verifier denying a 1-of-1 halts it immediately', async () => {
    installSim(makeRow({ required_confirmations: 1, received_confirmations: 0 }), 1);
    const machine = machineStub();

    const out = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      decision: 'deny',
      machine,
      now,
    });

    expect(out.status).toBe('halted');
    expect(machine.safeResetToArmed).toHaveBeenCalledOnce();
  });

  it('a denial NEVER increments received_confirmations', async () => {
    const sim = installSim(makeRow({ required_confirmations: 2, received_confirmations: 0 }), 3);
    const machine = machineStub();

    await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      decision: 'deny',
      machine,
      now,
    });

    expect(sim.getRow().received_confirmations).toBe(0);
  });

  it('an abstention moves NEITHER counter and never releases', async () => {
    const sim = installSim(makeRow({ required_confirmations: 1, received_confirmations: 0 }), 3);
    const machine = machineStub();

    const out = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      decision: 'abstain',
      machine,
      now,
    });

    expect(out.status).toBe('recorded');
    expect(sim.getRow().received_confirmations).toBe(0);
    expect(Number(sim.getRow().received_denials ?? 0)).toBe(0);
    expect(machine.releaseFromGrace).not.toHaveBeenCalled();
    expect(machine.safeResetToArmed).not.toHaveBeenCalled();
  });

  it('an absent decision still behaves exactly as confirm', async () => {
    installSim(makeRow({ required_confirmations: 1, received_confirmations: 0, grace_ends_at: '2020-01-01T00:00:00Z' }), 3);
    const machine = machineStub();

    const out = await submitConfirmation({ releaseStateId: 'rs-1', verifierId: 'v-1', machine, now });

    expect(out.status).toBe('released');
  });
});
