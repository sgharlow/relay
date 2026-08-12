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
