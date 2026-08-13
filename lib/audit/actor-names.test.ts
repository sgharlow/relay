/**
 * Tests for read-time audit actor names.
 *
 * The load-bearing property is NEGATIVE: this must never be able to alter what
 * was stored, and must never resolve a person belonging to somebody else.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { resolveActorNames } from './actor-names';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

const R = 'fc3ee2d3-eb86-40d1-b099-37fde0270656';
const V = '7b79c827-9aeb-4350-af8c-4ab933256eae';

describe('resolveActorNames', () => {
  it('names a recipient and a verifier', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: R, name: 'Jordan Rivera' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: V, name: 'Dr. Alex Chen' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(resolveActorNames('o-1', [`recipient:${R}`, `verifier:${V}`])).resolves.toEqual({
      [`recipient:${R}`]: 'Jordan Rivera',
      [`verifier:${V}`]: 'Dr. Alex Chen',
    });
  });

  it('scopes EVERY lookup to the owner', async () => {
    // No foreign keys in this data layer, so a cross-owner reference is refused
    // in the application or not at all. A name lookup that would happily resolve
    // somebody else's recipient becomes a leak the moment a caller changes.
    await resolveActorNames('o-1', [`recipient:${R}`, `verifier:${V}`, `owner:${R}`]);

    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).toMatch(/owner_id = \$1|WHERE id = \$1/);
      expect((call[1] as unknown[])[0]).toBe('o-1');
    }
  });

  it('omits an actor it cannot resolve, so the raw value is rendered', async () => {
    // A person the owner has since deleted. The record outlives the roster row
    // on purpose; inventing a name would be worse than showing an id.
    await expect(resolveActorNames('o-1', [`recipient:${R}`])).resolves.toEqual({});
  });

  it('ignores actors with no id and never queries for them', async () => {
    await expect(resolveActorNames('o-1', ['system', 'cron', 'simulate'])).resolves.toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses a non-UUID id rather than passing it to the database', async () => {
    await expect(resolveActorNames('o-1', ["recipient:' OR 1=1 --"])).resolves.toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('deduplicates repeated actors', async () => {
    await resolveActorNames('o-1', [`recipient:${R}`, `recipient:${R}`, `recipient:${R}`]);
    expect((mockQuery.mock.calls[0][1] as unknown[])[1]).toEqual([R]);
  });
});

describe('🔴 delegates were the one actor type without a name — 2026-08-12', () => {
  const D = 'a56479e4-6705-4466-aa02-b1443e7ffd58';

  it('names a helper, and says they were helping', async () => {
    // The helper workspace and this resolver were built the same day and left
    // unconnected, so the actor an owner is most likely to be curious about —
    // somebody else working inside their vault — rendered as a raw UUID while
    // everybody else had a name.
    // Routed on SQL: the empty-array branches never call `query` at all, so a
    // positional mock counts calls the implementation does not make.
    mockQuery.mockImplementation(async (sql: string) =>
      (/FROM delegations/.test(sql)
        ? { rows: [{ id: D, display_name: 'Jordan Rivera', email: 'j@example.com' }] }
        : { rows: [] }) as never,
    );

    await expect(resolveActorNames('o-1', [`delegate:${D}`])).resolves.toEqual({
      [`delegate:${D}`]: 'Jordan Rivera (helping you)',
    });
  });

  it('hops delegation → user, because the id is not a user id', async () => {
    await resolveActorNames('o-1', [`delegate:${D}`]);
    const sql = String(mockQuery.mock.calls.map((c) => String(c[0])).find((q) => q.includes('delegations')));
    expect(sql).toMatch(/JOIN users u ON u\.id = d\.delegate_user_id/);
  });

  it('scopes the lookup to this owner, like every other one here', async () => {
    await resolveActorNames('o-1', [`delegate:${D}`]);
    const call = mockQuery.mock.calls.find((c) => String(c[0]).includes('delegations'));
    expect(String(call?.[0])).toMatch(/d\.owner_id = \$1/);
    expect((call?.[1] as unknown[])[0]).toBe('o-1');
  });

  it('falls back to the address when the helper set no name', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      (/FROM delegations/.test(sql)
        ? { rows: [{ id: D, display_name: null, email: 'j@example.com' }] }
        : { rows: [] }) as never,
    );

    await expect(resolveActorNames('o-1', [`delegate:${D}`])).resolves.toEqual({
      [`delegate:${D}`]: 'j@example.com (helping you)',
    });
  });
});
