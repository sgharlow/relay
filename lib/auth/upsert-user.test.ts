/**
 * Tests for lib/auth/upsert-user.ts
 *
 * The sign-in upsert must NOT depend on a UNIQUE index on users.auth_sub
 * (migration 001 indexes it non-uniquely; Aurora DSQL may not enforce UNIQUE
 * secondary indexes at all). So `upsertUser` uses the app-level intent-read
 * pattern (SELECT → UPDATE or INSERT), the same trade-off lib/release/
 * provisioning.ts already makes — never `ON CONFLICT`.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));

import { query } from '../db/connection';
import { upsertUser } from './upsert-user';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('upsertUser (app-level intent-read; DSQL-safe, no ON CONFLICT)', () => {
  it('updates email/last_active and returns the existing row when the auth_sub is already present', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ id: 'u-1', email: 'old@x.com', is_demo_account: true }])) // intent-read
      .mockResolvedValueOnce(qResult([{ id: 'u-1', email: 'new@x.com', is_demo_account: true }])); // UPDATE returning

    const row = await upsertUser('credentials:new@x.com', 'new@x.com');

    expect(row).toEqual({ id: 'u-1', email: 'new@x.com', is_demo_account: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const selectSql = String(mockQuery.mock.calls[0][0]);
    expect(selectSql).toMatch(/SELECT/i);
    expect(selectSql).toMatch(/auth_sub/);

    const writeSql = String(mockQuery.mock.calls[1][0]);
    expect(writeSql).toMatch(/UPDATE\s+users/i);
    expect(writeSql).not.toMatch(/INSERT/i);
  });

  it('inserts a new row (status active, is_demo_account false) when the auth_sub does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([])) // intent-read: none
      .mockResolvedValueOnce(qResult([{ id: 'u-new', email: 'a@x.com', is_demo_account: false }])); // INSERT returning

    const row = await upsertUser('credentials:a@x.com', 'a@x.com');

    expect(row.id).toBe('u-new');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertSql = String(mockQuery.mock.calls[1][0]);
    expect(insertSql).toMatch(/INSERT\s+INTO\s+users/i);
  });

  it('never issues ON CONFLICT (the DSQL-incompatible path it replaces)', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([])) // none
      .mockResolvedValueOnce(qResult([{ id: 'u-new', email: 'a@x.com', is_demo_account: false }]));

    await upsertUser('credentials:a@x.com', 'a@x.com');

    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toMatch(/ON\s+CONFLICT/i);
    }
  });

  it('passes the email + auth_sub through to the intent-read and the insert', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([]))
      .mockResolvedValueOnce(qResult([{ id: 'u-new', email: 'a@x.com', is_demo_account: false }]));

    await upsertUser('credentials:a@x.com', 'a@x.com');

    expect(mockQuery.mock.calls[0][1]).toContain('credentials:a@x.com'); // SELECT bound on auth_sub
    const insertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain('a@x.com'); // email
    expect(insertParams).toContain('credentials:a@x.com'); // auth_sub
  });

  it('throws when the write returns no row', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([])) // none
      .mockResolvedValueOnce(qResult([])); // insert returned nothing

    await expect(upsertUser('credentials:a@x.com', 'a@x.com')).rejects.toThrow();
  });
});
