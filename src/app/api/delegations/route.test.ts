/**
 * Tests for the delegation candidate list — J3's missing front door.
 *
 * `POST` takes a `delegateUserId`, a raw UUID no owner could know, so nothing in
 * the product could call it. What makes a create UI possible is answering "who
 * is even eligible", and the answer is deliberately the smallest one that serves
 * the caregiver case.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../lib/http/owner-route');
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'o-1' })) };
});
vi.mock('../../../../lib/people/people', () => ({ listPeople: vi.fn(async () => []) }));

import { query } from '../../../../lib/db/connection';
import { GET } from './route';

const mockQuery = vi.mocked(query);

/** delegations, delegate emails, candidates — in call order. */
function seed(opts: {
  delegations?: { id: string; delegate_user_id: string; status: string; granted_at: null }[];
  candidates?: { user_id: string; name: string; email: string; person_type: string; standby_state: string }[];
}) {
  mockQuery
    .mockResolvedValueOnce({ rows: opts.delegations ?? [], rowCount: 0 } as never)
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    .mockResolvedValueOnce({ rows: opts.candidates ?? [], rowCount: 0 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('candidates', () => {
  it('offers people already in the circle who have accepted', async () => {
    seed({
      candidates: [
        { user_id: 'u-2', name: 'Jordan', email: 'j@example.com', person_type: 'recipient', standby_state: 'confirmed' },
      ],
    });

    const body = (await (await GET()).json()) as { candidates: { user_id: string }[] };
    expect(body.candidates.map((c) => c.user_id)).toEqual(['u-2']);
  });

  it('requires a claimed account and excludes revoked people, in SQL', async () => {
    // Delegation grants setup rights over a vault. Somebody the owner withdrew
    // must never reappear as a suggestion.
    seed({});
    await GET();
    const sql = String(mockQuery.mock.calls[2][0]);
    expect(sql).toMatch(/claimed_user_id IS NOT NULL/);
    expect(sql).toMatch(/<>\s*'revoked'/);
  });

  it('never offers somebody who is already a delegate', async () => {
    seed({
      delegations: [{ id: 'd-1', delegate_user_id: 'u-2', status: 'active', granted_at: null }],
      candidates: [
        { user_id: 'u-2', name: 'Jordan', email: 'j@example.com', person_type: 'recipient', standby_state: 'confirmed' },
      ],
    });

    const body = (await (await GET()).json()) as { candidates: unknown[] };
    expect(body.candidates).toEqual([]);
  });

  it('never offers the owner themselves', async () => {
    // `createDelegation` refuses it anyway; not offering it means the refusal is
    // never reached by an ordinary click.
    seed({
      candidates: [
        { user_id: 'o-1', name: 'Me', email: 'me@example.com', person_type: 'recipient', standby_state: 'confirmed' },
      ],
    });

    const body = (await (await GET()).json()) as { candidates: unknown[] };
    expect(body.candidates).toEqual([]);
  });

  it('has no lookup by email anywhere — that would be an account oracle', async () => {
    seed({});
    await GET();
    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toMatch(/WHERE\s+.*email\s*=/i);
    }
  });
});
