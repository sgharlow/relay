/**
 * Tests for the owner challenge.
 *
 * The two properties that matter: a denial must leave release_state completely
 * untouched and consume ZERO verifier attention (J6-R4), and an approval must
 * reach GRACE without inventing an ARMED -> GRACE transition (J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R4, J6-R5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { respondToChallenge } from './challenge';
import { PERMITTED_TRANSITIONS } from './state-machine';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const now = new Date('2026-08-06T12:00:00Z');

function machineStub() {
  let version = 0;
  return {
    transition: vi.fn(async (...args: unknown[]) => {
      const [id, , to] = args as [string, string, string];
      version += 1;
      return {
        id,
        owner_id: 'o-1',
        trigger_type: 'emergency',
        state: to,
        version,
        required_confirmations: 2,
        received_confirmations: 0,
      } as never;
    }),
  };
}

function claimReturns(row: unknown) {
  mockQuery.mockResolvedValueOnce({ rows: row ? [row] : [] } as never);
}

beforeEach(() => vi.clearAllMocks());

describe('respondToChallenge — deny', () => {
  it('closes the request and NEVER touches release_state', async () => {
    claimReturns({ id: 'req-1', recipient_id: 'r-1', trigger_type: 'emergency', case_id: 'RLY-AAAA-BBBB' });
    const machine = machineStub();

    const out = await respondToChallenge({
      requestId: 'req-1',
      ownerId: 'o-1',
      response: 'deny',
      machine,
      now,
    });

    expect(out).toEqual({ state: 'armed', status: 'denied_by_owner' });
    expect(machine.transition).not.toHaveBeenCalled();

    // Only the request row was written — no release_state statement at all.
    for (const call of mockQuery.mock.calls) {
      expect(call[0] as string).not.toMatch(/release_state/i);
    }
  });

  it('records that zero verifiers were contacted', async () => {
    claimReturns({ id: 'req-1', recipient_id: 'r-1', trigger_type: 'emergency', case_id: 'RLY-AAAA-BBBB' });

    await respondToChallenge({ requestId: 'req-1', ownerId: 'o-1', response: 'deny', machine: machineStub(), now });

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({
        action: 'request_denied_by_owner',
        detail: expect.objectContaining({ verifiersContacted: 0 }),
      }),
    );
  });

  it('rejects a request that is not open', async () => {
    claimReturns(null);

    await expect(
      respondToChallenge({ requestId: 'gone', ownerId: 'o-1', response: 'deny', machine: machineStub(), now }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('respondToChallenge — approve', () => {
  function approveSetup() {
    claimReturns({ id: 'req-1', recipient_id: 'r-1', trigger_type: 'emergency', case_id: 'RLY-AAAA-BBBB' });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'rs-1',
          owner_id: 'o-1',
          trigger_type: 'emergency',
          state: 'armed',
          version: 0,
          required_confirmations: 2,
          received_confirmations: 0,
        },
      ],
    } as never);
  }

  it('reaches GRACE through ARMED -> PENDING -> GRACE, never a direct hop', async () => {
    approveSetup();
    const machine = machineStub();

    const out = await respondToChallenge({
      requestId: 'req-1',
      ownerId: 'o-1',
      response: 'approve',
      machine,
      now,
    });

    expect(out).toEqual({ state: 'grace', status: 'approved_by_owner' });
    expect(machine.transition).toHaveBeenCalledTimes(2);

    const [first, second] = machine.transition.mock.calls as unknown as string[][];
    expect([first[1], first[2]]).toEqual(['armed', 'pending']);
    expect([second[1], second[2]]).toEqual(['pending', 'grace']);
  });

  it('NEVER requests an armed -> grace transition', async () => {
    approveSetup();
    const machine = machineStub();

    await respondToChallenge({ requestId: 'req-1', ownerId: 'o-1', response: 'approve', machine, now });

    for (const call of machine.transition.mock.calls as unknown as string[][]) {
      expect(`${call[1]}->${call[2]}`).not.toBe('armed->grace');
    }
  });

  it('suppresses verifier notification on the PENDING hop', async () => {
    approveSetup();
    const machine = machineStub();

    await respondToChallenge({ requestId: 'req-1', ownerId: 'o-1', response: 'approve', machine, now });

    const opts = machine.transition.mock.calls[0][4] as unknown as { auditDetail: Record<string, unknown> };
    expect(opts.auditDetail).toMatchObject({ ownerConsented: true, notifySuppressed: true });
  });

  it('auto-satisfies the quorum, because owner consent outranks it', async () => {
    approveSetup();
    const machine = machineStub();

    await respondToChallenge({ requestId: 'req-1', ownerId: 'o-1', response: 'approve', machine, now });

    const opts = machine.transition.mock.calls[1][4] as unknown as {
      updates: Record<string, unknown>;
      auditDetail: Record<string, unknown>;
    };
    expect(opts.updates.received_confirmations).toBe(2);
    expect(opts.auditDetail).toMatchObject({ quorumAutoSatisfied: true });
  });
});

describe('the transition set', () => {
  it('is still exactly seven — no eighth was added for this flow', () => {
    expect(PERMITTED_TRANSITIONS).toHaveLength(7);
  });

  it('still contains no armed -> grace edge', () => {
    const direct = PERMITTED_TRANSITIONS.find((t) => t.from === 'armed' && t.to === 'grace');
    expect(direct).toBeUndefined();
  });
});
