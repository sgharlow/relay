/**
 * Tests for the owner approval queue.
 *
 * A delegate proposes; the owner approves. The case this exists for is the
 * delegate designating THEMSELVES as a recipient (J3-R6).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J3-R8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('./recipients', async (io) => {
  const actual = await io<typeof import('./recipients')>();
  return { ...actual, createRecipient: vi.fn(async () => ({ id: 'r-new' })) };
});

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { createRecipient } from './recipients';
import {
  APPROVAL_KINDS,
  enqueueApproval,
  decideApproval,
  delegateActivityDigest,
} from './approvals';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('enqueueApproval', () => {
  it('records the proposing delegate as the audit actor', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ap-1' }] } as never);

    await enqueueApproval('o-1', {
      kind: 'self_designation',
      payload: { name: 'Me', email: 'me@x.com', role: 'recipient' },
      proposedByDelegationId: 'd-1',
    });

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ actor: 'delegate:d-1', action: 'approval_requested' }),
    );
  });

  it('rejects an unknown kind before writing', async () => {
    await expect(
      enqueueApproval('o-1', {
        kind: 'anything' as never,
        payload: {},
        proposedByDelegationId: 'd-1',
      }),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('covers the three proposal kinds', () => {
    expect([...APPROVAL_KINDS]).toEqual(['recipient', 'policy', 'self_designation']);
  });
});

describe('decideApproval', () => {
  /**
   * Routes on SQL rather than call order.
   *
   * These were positional and broke the FIFTH time a query was added ahead of
   * them — the appliable-kind guard, 2026-08-12. A positional mock encodes how
   * many queries the implementation happens to make, which is not what any of
   * these tests are about.
   */
  function pending(kind: string, found = true) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT kind FROM approvals/i.test(sql)) {
        return { rows: found ? [{ kind }] : [], rowCount: found ? 1 : 0 } as never;
      }
      if (/UPDATE approvals/i.test(sql)) {
        return {
          rows: found
            ? [{
                id: 'ap-1',
                owner_id: 'o-1',
                kind,
                payload: { name: 'Me', email: 'me@x.com', role: 'recipient' },
                proposed_by_delegation_id: 'd-1',
                status: kind,
              }]
            : [],
          rowCount: found ? 1 : 0,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  }

  it('APPROVING a self-designation creates the recipient via the validated path', async () => {
    pending('self_designation');

    await expect(decideApproval('o-1', 'ap-1', 'approve')).resolves.toEqual({ applied: true });
    expect(createRecipient).toHaveBeenCalledOnce();
  });

  it('REJECTING applies nothing', async () => {
    pending('self_designation');

    await expect(decideApproval('o-1', 'ap-1', 'reject')).resolves.toEqual({ applied: false });
    expect(createRecipient).not.toHaveBeenCalled();
  });

  it('claims the row atomically, scoped to owner and still-pending', async () => {
    pending('recipient');
    await decideApproval('o-1', 'ap-1', 'approve');

    const claim = mockQuery.mock.calls.find((c) => /UPDATE approvals/i.test(String(c[0])));
    expect(String(claim?.[0])).toMatch(/status\s*=\s*'pending'/i);
    expect(claim?.[1]).toEqual(['ap-1', 'o-1', 'approved']);
  });

  it('rejects when nothing pending matches — no double-apply', async () => {
    pending('recipient', false);

    await expect(decideApproval('o-1', 'ap-1', 'approve')).rejects.toThrow(ValidationError);
    expect(createRecipient).not.toHaveBeenCalled();
  });

  it('always audits the owner as the deciding actor', async () => {
    pending('recipient');
    await decideApproval('o-1', 'ap-1', 'approve');

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ actor: 'owner:o-1', action: 'approval_granted' }),
    );
  });

  it('rejects an invalid decision', async () => {
    await expect(decideApproval('o-1', 'ap-1', 'maybe' as never)).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('delegateActivityDigest', () => {
  it('reads from the audit chain, filtered to delegate actors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await delegateActivityDigest('o-1', '2026-08-01T00:00:00Z');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM audit_log/i);
    expect(sql).toMatch(/actor LIKE 'delegate:%'/i);
    expect(params).toEqual(['o-1', '2026-08-01T00:00:00Z']);
  });
});

describe('🔴 an approval that cannot be applied cannot be approved — 2026-08-12', () => {
  it('refuses to approve a policy suggestion instead of silently doing nothing', async () => {
    // `decideApproval` claimed the row, marked it approved, wrote an audit entry
    // saying so, and left `applied` false. An owner could answer a question
    // about who reaches their vault, be told it was granted, and have nothing
    // change — a silent no-op wearing the costume of a control, on the queue
    // whose whole job is to be where a decision really happens.
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ kind: 'policy' }], rowCount: 1 } as never);

    await expect(decideApproval('o-1', 'ap-1', 'approve')).rejects.toThrow(ValidationError);

    // And critically: the row was never claimed, so it is not left marked
    // approved with nothing applied — the exact state the guard prevents.
    const claimed = mockQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE approvals'));
    expect(claimed).toBe(false);
  });

  it('still allows REJECTING one, because rejecting applies nothing by definition', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'ap-1', owner_id: 'o-1', kind: 'policy', payload: {}, status: 'rejected' }],
      rowCount: 1,
    } as never);

    await expect(decideApproval('o-1', 'ap-1', 'reject')).resolves.toEqual({ applied: false });
  });

  it('leaves the kinds it can apply untouched', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kind: 'recipient' }], rowCount: 1 } as never)
      .mockResolvedValue({ rows: [{ id: 'ap-1', owner_id: 'o-1', kind: 'recipient', payload: { name: 'Sam', email: 's@example.com', role: 'recipient' }, status: 'approved' }], rowCount: 1 } as never);

    await expect(decideApproval('o-1', 'ap-1', 'approve')).resolves.toEqual({ applied: true });
  });
});
