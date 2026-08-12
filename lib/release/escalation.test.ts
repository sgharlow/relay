/**
 * Tests for challenge-window escalation.
 *
 * The gap this closes: CHALLENGE_WINDOW_SECONDS is documented as "how long the
 * owner gets to answer before verifiers are contacted", access_requests.expires_at
 * is stored NOT NULL and returned to the client, and NOTHING read it. claimRequest
 * accepts only owner_id and no sweeper existed, so when the owner was
 * incapacitated — the case this product is sold for — a request sat in
 * awaiting_owner forever.
 *
 * The property that matters most here: escalation must NOT auto-satisfy the
 * quorum. Owner consent does that deliberately, because an owner agreeing is
 * stronger than third parties attesting on their behalf. A lapse is the opposite
 * — it is the absence of a signal — so verifiers must actually confirm.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R5, J6-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { isChallengeLapsed, escalateLapsedRequest, escalateLapsedRequests } from './escalation';
import { PERMITTED_TRANSITIONS } from './state-machine';

const mockQuery = vi.mocked(query);
const now = new Date('2026-08-11T12:00:00Z');

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

const REQUEST = {
  id: 'req-1',
  owner_id: 'o-1',
  trigger_type: 'emergency',
  case_id: 'RLY-AAAA-BBBB',
};

const ARMED_ROW = {
  id: 'rs-1',
  owner_id: 'o-1',
  trigger_type: 'emergency',
  state: 'armed',
  version: 3,
  required_confirmations: 2,
  received_confirmations: 0,
};

/** query order per escalation: CAS-claim the request, then read release_state. */
function escalationQueries(claimed: unknown, releaseRow: unknown) {
  mockQuery.mockResolvedValueOnce({ rows: claimed ? [claimed] : [] } as never);
  mockQuery.mockResolvedValueOnce({ rows: releaseRow ? [releaseRow] : [] } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // NOT redundant. `clearAllMocks` resets call records but leaves the
  // `mockResolvedValueOnce` QUEUE intact, so a test that short-circuits before
  // consuming everything it queued (the no-op cases below both do) silently
  // hands its leftovers to the next test. `mockReset` is what empties the queue.
  mockQuery.mockReset();
});

describe('isChallengeLapsed', () => {
  it('is true once the window has passed and the owner has not answered', () => {
    expect(
      isChallengeLapsed({ status: 'awaiting_owner', expires_at: '2026-08-11T11:59:59Z' }, now),
    ).toBe(true);
  });

  it('is false while the window is still open — the owner still owns the decision', () => {
    expect(
      isChallengeLapsed({ status: 'awaiting_owner', expires_at: '2026-08-11T12:00:01Z' }, now),
    ).toBe(false);
  });

  it('is false for any status the owner has already resolved', () => {
    for (const status of ['denied_by_owner', 'approved_by_owner', 'escalated', 'closed']) {
      expect(isChallengeLapsed({ status, expires_at: '2020-01-01T00:00:00Z' }, now)).toBe(false);
    }
  });

  it('treats an unparseable expiry as NOT lapsed — never escalate on bad data', () => {
    expect(isChallengeLapsed({ status: 'awaiting_owner', expires_at: 'not-a-date' }, now)).toBe(
      false,
    );
  });
});

describe('escalateLapsedRequest', () => {
  it('claims the request to escalated and walks ARMED -> PENDING -> GRACE', async () => {
    escalationQueries(REQUEST, ARMED_ROW);
    const machine = machineStub();

    const out = await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    expect(out).toMatchObject({ requestId: 'req-1', caseId: 'RLY-AAAA-BBBB' });

    const claimSql = String(mockQuery.mock.calls[0][0]);
    expect(claimSql).toContain('UPDATE access_requests');
    expect(claimSql).toContain("status = 'awaiting_owner'");

    const [first, second] = machine.transition.mock.calls;
    expect([first[1], first[2]]).toEqual(['armed', 'pending']);
    expect([second[1], second[2]]).toEqual(['pending', 'grace']);
  });

  it('does NOT auto-satisfy the quorum — a lapse is an absence, not consent', async () => {
    escalationQueries(REQUEST, ARMED_ROW);
    const machine = machineStub();

    await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    const graceOpts = machine.transition.mock.calls[1][4] as { updates: Record<string, unknown> };
    expect(graceOpts.updates).not.toHaveProperty('received_confirmations');
    expect(graceOpts.updates).toHaveProperty('grace_ends_at');
  });

  it('introduces no new transition — every edge it walks is already permitted', async () => {
    escalationQueries(REQUEST, ARMED_ROW);
    const machine = machineStub();

    await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    for (const call of machine.transition.mock.calls) {
      const [, from, to] = call as unknown as [string, string, string];
      expect(PERMITTED_TRANSITIONS.some((t) => t.from === from && t.to === to)).toBe(true);
    }
    expect(PERMITTED_TRANSITIONS).toHaveLength(7);
  });

  it('records who caused the release, so the audit can tell a lapse from an owner', async () => {
    escalationQueries(REQUEST, ARMED_ROW);
    const machine = machineStub();

    await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    const pendingOpts = machine.transition.mock.calls[0][4] as { updates: Record<string, string> };
    expect(pendingOpts.updates.initiated_by).toContain('challenge_lapsed');
    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ action: 'request_escalated_to_verifiers' }),
    );
  });

  it('is a no-op when another writer already claimed the request', async () => {
    escalationQueries(null, ARMED_ROW);
    const machine = machineStub();

    const out = await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    expect(out).toBeNull();
    expect(machine.transition).not.toHaveBeenCalled();
  });

  it('does not force a release that is no longer ARMED', async () => {
    escalationQueries(REQUEST, { ...ARMED_ROW, state: 'grace' });
    const machine = machineStub();

    const out = await escalateLapsedRequest({ requestId: 'req-1', machine, now });

    expect(out).toBeNull();
    expect(machine.transition).not.toHaveBeenCalled();
  });

  it('does not throw when the owner has no release state for that trigger', async () => {
    escalationQueries(REQUEST, null);
    const machine = machineStub();

    await expect(
      escalateLapsedRequest({ requestId: 'req-1', machine, now }),
    ).resolves.toBeNull();
  });
});

describe('escalateLapsedRequests — the sweep', () => {
  it('escalates every lapsed request and leaves in-window ones alone', async () => {
    // 1: the lapsed-request lookup. The SQL filters, so only lapsed rows come back.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1' }, { id: 'req-2' }] } as never);
    escalationQueries(REQUEST, ARMED_ROW);
    escalationQueries({ ...REQUEST, id: 'req-2' }, { ...ARMED_ROW, id: 'rs-2' });

    const machine = machineStub();
    const out = await escalateLapsedRequests(machine, now);

    expect(out).toHaveLength(2);
    const lookupSql = String(mockQuery.mock.calls[0][0]);
    expect(lookupSql).toContain("status = 'awaiting_owner'");
    expect(lookupSql).toContain('expires_at');
  });

  it('one failing request does not abort the sweep', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1' }, { id: 'req-2' }] } as never);
    mockQuery.mockRejectedValueOnce(new Error('conflict'));
    escalationQueries({ ...REQUEST, id: 'req-2' }, { ...ARMED_ROW, id: 'rs-2' });

    const machine = machineStub();
    const out = await escalateLapsedRequests(machine, now);

    expect(out).toHaveLength(1);
    expect(out[0].requestId).toBe('req-2');
  });
});
