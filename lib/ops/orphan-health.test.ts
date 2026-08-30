/**
 * The probe that answers D4's countable half.
 *
 * These assert the two things a monitor's value rests on: that it goes RED on
 * the state it exists for, and that it says nothing it should not.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4, CC9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  getOrphanHealth,
  buildCensusSql,
  DANGLING_BASELINE,
  MAX_AGE_HOURS,
} from './orphan-health';
import { OWNER_COLUMNS, RETAINED_BY_DESIGN } from './disposable-accounts';

const mockQuery = vi.mocked(query);

const NOW = new Date('2026-08-30T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

interface Fixture {
  users: Array<{ id: string; email: string; created_at: string }>;
  subscriptions: Array<{ owner_id: string }>;
  roles: Array<{ user_id: string; n: string }>;
  dangling: Array<{ label: string; n: string }>;
  retained: Array<{ label: string; n: string }>;
}

let fx: Fixture;

/** Routed on the SQL, so a reordering cannot silently swap two answers. */
function route(sql: unknown): { rows: unknown[] } {
  const s = String(sql);
  if (/FROM users WHERE email LIKE/.test(s)) return { rows: fx.users };
  if (/FROM subscriptions WHERE owner_id = ANY/.test(s)) return { rows: fx.subscriptions };
  if (/FROM recipients WHERE claimed_user_id/.test(s)) return { rows: fx.roles };
  // The two censuses are distinguished by which table they lead with.
  if (/FROM audit_log/.test(s)) return { rows: fx.retained };
  if (/FROM vault_items WHERE owner_id/.test(s)) return { rows: fx.dangling };
  throw new Error('unexpected query: ' + s.slice(0, 120));
}

beforeEach(() => {
  vi.clearAllMocks();
  fx = {
    users: [],
    subscriptions: [],
    roles: [],
    dangling: [{ label: 'verifier_codes.owner_id', n: String(DANGLING_BASELINE) }],
    retained: [{ label: 'audit_log.owner_id', n: '3486' }],
  };
  mockQuery.mockImplementation(async (sql: unknown) => route(sql) as never);
});

describe('a clean cluster', () => {
  it('is healthy with no disposable accounts', async () => {
    const h = await getOrphanHealth(NOW);
    expect(h.healthy).toBe(true);
    expect(h.disposableAccounts).toBe(0);
    expect(h.staleDisposableAccounts).toBe(0);
    expect(h.oldestDisposableHours).toBeNull();
  });

  it('skips the held-account lookups entirely when nothing is disposable', async () => {
    /*
      ⚠️ MATCHED ON `= ANY($1)`, NOT ON THE TABLE NAME. `subscriptions` is also
      one of OWNER_COLUMNS, so the dangling census legitimately mentions it on
      every run — a looser regex here passed against the census and would have
      reported this skip as working whether or not it did.
    */
    await getOrphanHealth(NOW);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM subscriptions WHERE owner_id = ANY/.test(s))).toBe(false);
    expect(sqls.some((s) => /claimed_user_id = ANY/.test(s))).toBe(false);
  });

  it('reports retained rows without treating them as a defect', async () => {
    // A dangling audit_log row is the DESIGNED end state of every correct
    // closure. Counting it is useful; failing on it is the alarm that gets muted.
    const h = await getOrphanHealth(NOW);
    expect(h.retainedRows).toBe(3486);
    expect(h.healthy).toBe(true);
  });
});

describe('a walk left something behind', () => {
  it('goes RED on an account older than a day', async () => {
    fx.users = [{ id: 'u-1', email: 'relay-e2e-123@example.test', created_at: hoursAgo(30) }];
    const h = await getOrphanHealth(NOW);
    expect(h.healthy).toBe(false);
    expect(h.staleDisposableAccounts).toBe(1);
    expect(h.oldestDisposableHours).toBe(30);
  });

  it('stays green while a walk may still be running', async () => {
    // Under the threshold is "in flight", not "leaked". Alarming here would fire
    // on every run of verify:live.
    fx.users = [{ id: 'u-1', email: 'relay-e2e-123@example.test', created_at: hoursAgo(2) }];
    const h = await getOrphanHealth(NOW);
    expect(h.healthy).toBe(true);
    expect(h.staleDisposableAccounts).toBe(0);
    expect(h.disposableAccounts).toBe(1);
  });

  it('never counts a HELD account as stale, even when it is old', async () => {
    /*
      "A disposable-looking account holding live billing" is a recorded trap in
      this portfolio. The probe must not report something as sweepable that the
      sweep itself would refuse to touch.
    */
    fx.users = [{ id: 'u-1', email: 'old@example.test', created_at: hoursAgo(400) }];
    fx.subscriptions = [{ owner_id: 'u-1' }];
    const h = await getOrphanHealth(NOW);
    expect(h.staleDisposableAccounts).toBe(0);
    expect(h.heldDisposableAccounts).toBe(1);
    expect(h.healthy).toBe(true);
  });

  it('holds an account that stands by in somebody else’s roster', async () => {
    fx.users = [{ id: 'u-1', email: 'old@example.test', created_at: hoursAgo(400) }];
    fx.roles = [{ user_id: 'u-1', n: '2' }];
    const h = await getOrphanHealth(NOW);
    expect(h.staleDisposableAccounts).toBe(0);
    expect(h.heldDisposableAccounts).toBe(1);
  });

  it('filters reserved domains in SQL, never pulling a real account in', async () => {
    await getOrphanHealth(NOW);
    const call = mockQuery.mock.calls.find((c) => /FROM users WHERE email LIKE/.test(String(c[0])));
    expect(call?.[1]).toEqual(['%.test', '%.invalid', '%.localhost']);
  });
});

describe('dangling rows are measured against a baseline, not against zero', () => {
  it('is healthy at exactly the recorded baseline', async () => {
    const h = await getOrphanHealth(NOW);
    expect(h.danglingRows).toBe(DANGLING_BASELINE);
    expect(h.healthy).toBe(true);
  });

  it('goes RED when the count grows, because growth is a new leak', async () => {
    fx.dangling = [{ label: 'verifier_codes.owner_id', n: String(DANGLING_BASELINE + 1) }];
    const h = await getOrphanHealth(NOW);
    expect(h.healthy).toBe(false);
    expect(h.danglingRows).toBe(DANGLING_BASELINE + 1);
  });

  it('stays healthy if a ruling purges them', async () => {
    fx.dangling = [{ label: 'verifier_codes.owner_id', n: '0' }];
    expect((await getOrphanHealth(NOW)).healthy).toBe(true);
  });

  it('sums every table in the census rather than reporting one', async () => {
    fx.dangling = [
      { label: 'verifier_codes.owner_id', n: '17' },
      { label: 'break_glass_codes.owner_id', n: '10' },
      { label: 'recipient_codes.owner_id', n: '1' },
    ];
    expect((await getOrphanHealth(NOW)).danglingRows).toBe(28);
  });
});

describe('the census is built from the shared contract', () => {
  it('asks about every owner column, and only those', async () => {
    const sql = buildCensusSql(OWNER_COLUMNS);
    for (const [table, column] of OWNER_COLUMNS) {
      expect(sql).toContain(`FROM ${table} WHERE ${column} IS NOT NULL`);
    }
    // One statement, not eighteen round trips.
    expect(sql.split('UNION ALL')).toHaveLength(OWNER_COLUMNS.length);
  });

  it('never censuses what the cascade keeps on purpose', () => {
    expect(buildCensusSql(OWNER_COLUMNS)).not.toContain('FROM audit_log');
    expect(buildCensusSql(RETAINED_BY_DESIGN)).toContain('FROM audit_log');
  });

  it('refuses an identifier that is not a plain identifier', () => {
    /*
      Table and column names cannot be bound as parameters in any SQL dialect,
      so they are interpolated. They come from a const array and never from a
      request — this makes that a rule a change has to break deliberately.
    */
    expect(() => buildCensusSql([['users; DROP TABLE users --', 'id']])).toThrow(/identifiers/);
    expect(() => buildCensusSql([['users', 'id) OR (1=1']])).toThrow(/identifiers/);
  });
});

describe('what a public probe may say', () => {
  it('carries no address, no id, and no table name', async () => {
    fx.users = [
      { id: 'aaaaaaaa-1111-4222-8333-444455556666', email: 'relay-e2e-1787@example.test', created_at: hoursAgo(30) },
    ];
    const body = JSON.stringify(await getOrphanHealth(NOW));
    // The address names the walk and the minute that created it.
    expect(body).not.toContain('@');
    expect(body).not.toContain('relay-e2e');
    expect(body).not.toContain('aaaaaaaa');
    expect(body).not.toContain('verifier_codes');
  });

  it('reports the threshold it judged against, so a reader need not guess', async () => {
    const h = await getOrphanHealth(NOW);
    expect(h.maxAgeHours).toBe(MAX_AGE_HOURS);
    expect(h.danglingBaseline).toBe(DANGLING_BASELINE);
  });
});
