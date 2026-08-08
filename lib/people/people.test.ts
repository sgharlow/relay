/**
 * Tests for the unified people list.
 *
 * One human entered once, however many roles they hold (J4-R1).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { listPeople, normaliseEmail } from './people';

const mockQuery = vi.mocked(query);

function rows(recipients: unknown[], verifiers: unknown[]) {
  mockQuery
    .mockResolvedValueOnce({ rows: recipients } as never)
    .mockResolvedValueOnce({ rows: verifiers } as never);
}

beforeEach(() => vi.clearAllMocks());

describe('normaliseEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  A@B.COM ')).toBe('a@b.com');
  });
});

describe('listPeople', () => {
  it('merges one human holding both roles into a single entry', async () => {
    rows(
      [{ id: 'r1', name: 'Sam', relationship: 'spouse', email: 'sam@x.com', phone: null, role: 'recipient' }],
      [{ id: 'v1', name: 'Sam', email: 'sam@x.com', phone: null }],
    );

    const people = await listPeople('o-1');

    expect(people).toHaveLength(1);
    expect(people[0].roles).toEqual({ recipient: true, verifier: true, executor: false });
    expect(people[0].recipientId).toBe('r1');
    expect(people[0].verifierId).toBe('v1');
  });

  it('merges across case and whitespace differences', async () => {
    rows(
      [{ id: 'r1', name: 'Sam', relationship: null, email: 'Sam@X.com', phone: null, role: 'recipient' }],
      [{ id: 'v1', name: 'Sam', email: '  sam@x.com ', phone: null }],
    );

    expect(await listPeople('o-1')).toHaveLength(1);
  });

  it('keeps distinct humans separate', async () => {
    rows(
      [{ id: 'r1', name: 'Sam', relationship: null, email: 'sam@x.com', phone: null, role: 'recipient' }],
      [{ id: 'v1', name: 'Alex', email: 'alex@x.com', phone: null }],
    );

    expect(await listPeople('o-1')).toHaveLength(2);
  });

  it('marks an executor', async () => {
    rows(
      [{ id: 'r1', name: 'Sam', relationship: null, email: 'sam@x.com', phone: null, role: 'executor' }],
      [],
    );

    expect((await listPeople('o-1'))[0].roles.executor).toBe(true);
  });

  it('includes a verifier who is not a recipient', async () => {
    rows([], [{ id: 'v1', name: 'Alex', email: 'alex@x.com', phone: '555' }]);

    const people = await listPeople('o-1');
    expect(people[0].roles).toEqual({ recipient: false, verifier: true, executor: false });
    expect(people[0].recipientId).toBeNull();
  });

  it('sorts by name for a stable list', async () => {
    rows(
      [
        { id: 'r1', name: 'Zoe', relationship: null, email: 'z@x.com', phone: null, role: 'recipient' },
        { id: 'r2', name: 'Alex', relationship: null, email: 'a@x.com', phone: null, role: 'recipient' },
      ],
      [],
    );

    expect((await listPeople('o-1')).map((p) => p.name)).toEqual(['Alex', 'Zoe']);
  });

  it('scopes both queries to the owner', async () => {
    rows([], []);
    await listPeople('o-1');

    for (const call of mockQuery.mock.calls) {
      expect(call[0] as string).toMatch(/owner_id = \$1/);
      expect(call[1]).toEqual(['o-1']);
    }
  });

  it('returns an empty list for an owner with nobody designated', async () => {
    rows([], []);
    expect(await listPeople('o-1')).toEqual([]);
  });
});
