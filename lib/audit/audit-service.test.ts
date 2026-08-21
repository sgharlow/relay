/**
 * Tests for lib/audit/audit-service.ts
 *
 * Validates: Requirements 8.1–8.7
 *  - Property 16: Audit log hash chain integrity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock the DB connection with an in-memory audit_log table so the real chaining
// + hashing logic runs without a live DSQL cluster.
vi.mock('../db/connection', () => ({
  query: vi.fn(),
}));

// withOccRetry as a transparent pass-through (retry behaviour covered elsewhere).
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

import { query } from '../db/connection';
import { verifyAuditChain } from './chain';
import {
  writeAuditEntry,
  getAuditLog,
  canonicalJson,
  sha256,
  AuditWriteError,
  type AuditEntry,
} from './audit-service';

const mockQuery = vi.mocked(query);

// ---------------------------------------------------------------------------
// In-memory audit_log simulation routed by SQL shape
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  owner_id: string;
  seq: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  ts: string;
}

let store: Row[] = [];
let idCounter = 0;

/**
 * The next N chain-head reads answer from the store as it was when the freeze
 * was taken, not as it is now.
 *
 * This is what a second writer for one owner actually sees: DSQL is snapshot
 * isolated, so a head read taken before another writer committed returns the
 * OLD head, and both writers compute the same next seq. Two serverless
 * instances, the hourly cron and an owner action, or `assertNoCrossOwner`
 * running its checks in parallel all produce it.
 */
let staleHeadReads = 0;
let headSnapshot: Row[] = [];

function freezeHeadFor(reads: number): void {
  headSnapshot = store.slice();
  staleHeadReads = reads;
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

/** Duplicate primary key, as `pg` surfaces it. */
function duplicateKey(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "audit_log_pkey"'),
    { code: '23505' },
  );
}

/**
 * Maps the INSERT's declared column list onto its parameters, rather than
 * indexing `$1..$n` positionally. Positional decoding would silently mis-read
 * every column the day a column is added to the front of the statement — which
 * is exactly the edit that added the deterministic `id`.
 */
function insertedColumns(sql: string, params: unknown[]): Record<string, unknown> {
  const cols = /INSERT INTO audit_log\s*\(([^)]*)\)/i.exec(sql);
  if (!cols) throw new Error(`Cannot read the column list from: ${sql}`);
  const names = cols[1].split(',').map((c) => c.trim());
  const out: Record<string, unknown> = {};
  names.forEach((name, i) => {
    out[name] = params[i];
  });
  return out;
}

function installInMemoryDb() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const p = params ?? [];

    // SELECT chain head
    if (sql.includes('ORDER BY seq DESC')) {
      const view = staleHeadReads > 0 ? (staleHeadReads--, headSnapshot) : store;
      const ownerRows = view
        .filter((r) => r.owner_id === p[0])
        .sort((a, b) => b.seq - a.seq);
      return result(ownerRows.length ? [{ seq: ownerRows[0].seq, entry_hash: ownerRows[0].entry_hash }] : []);
    }

    // Read-back of one row by primary key (the duplicate-key branch).
    if (/FROM audit_log\s+WHERE id = \$1/i.test(sql)) {
      return result(store.filter((r) => r.id === p[0]));
    }

    // INSERT new entry
    if (sql.startsWith('INSERT INTO audit_log')) {
      const c = insertedColumns(sql, p);
      const row: Row = {
        id: (c.id as string | undefined) ?? `audit-${idCounter++}`,
        owner_id: c.owner_id as string,
        seq: c.seq as number,
        actor: c.actor as string,
        action: c.action as string,
        entity: c.entity as string,
        entity_id: (c.entity_id as string | null) ?? null,
        detail: JSON.parse(c.detail as string),
        prev_hash: c.prev_hash as string,
        entry_hash: c.entry_hash as string,
        ts: c.ts as string,
      };
      // `id UUID PRIMARY KEY` (001_initial.sql). The real table enforces this;
      // a mock that did not was why a forked chain could pass every test.
      if (store.some((r) => r.id === row.id)) throw duplicateKey();
      store.push(row);
      return result([row]);
    }

    // SELECT full log ascending
    if (sql.includes('ORDER BY seq ASC')) {
      const ownerRows = store
        .filter((r) => r.owner_id === p[0])
        .sort((a, b) => a.seq - b.seq);
      return result(ownerRows);
    }

    throw new Error(`Unexpected SQL in mock: ${sql}`);
  });
}

beforeEach(() => {
  store = [];
  idCounter = 0;
  staleHeadReads = 0;
  headSnapshot = [];
  mockQuery.mockReset();
  installInMemoryDb();
});

// ---------------------------------------------------------------------------
// canonicalJson
// ---------------------------------------------------------------------------

describe('canonicalJson', () => {
  it('sorts keys deterministically regardless of insertion order', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJson({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it('excludes chain columns (prev_hash, entry_hash, id) from the digest', () => {
    const withChain = canonicalJson({ actor: 'x', prev_hash: 'p', entry_hash: 'e', id: 'i' });
    const without = canonicalJson({ actor: 'x' });
    expect(withChain).toBe(without);
  });
});

// ---------------------------------------------------------------------------
// writeAuditEntry / getAuditLog
// ---------------------------------------------------------------------------

describe('writeAuditEntry', () => {
  it('seeds the genesis prev_hash and seq=0 for the first entry', async () => {
    const owner = 'owner-1';
    const e = await writeAuditEntry(owner, { actor: 'owner:1', action: 'kms_wrap_requested', entity: 'kms' });
    expect(e.seq).toBe(0);
    expect(e.prev_hash).toBe('0'.repeat(64));
    expect(e.entry_hash).toHaveLength(64);
  });

  it('links each subsequent entry to the previous entry_hash', async () => {
    const owner = 'owner-2';
    const a = await writeAuditEntry(owner, { actor: 'a', action: 'x', entity: 'e' });
    const b = await writeAuditEntry(owner, { actor: 'b', action: 'y', entity: 'e' });
    expect(b.seq).toBe(1);
    expect(b.prev_hash).toBe(a.entry_hash);
  });

  it('keeps owner chains independent', async () => {
    await writeAuditEntry('owner-A', { actor: 'a', action: 'x', entity: 'e' });
    const first2 = await writeAuditEntry('owner-B', { actor: 'b', action: 'y', entity: 'e' });
    expect(first2.seq).toBe(0);
    expect(first2.prev_hash).toBe('0'.repeat(64));
  });

  it('a writer working from a stale chain head cannot fork the chain', async () => {
    /*
      🔴 THE DEFECT THIS WAS WRITTEN FOR. `appendOnce` read MAX(seq) and then
      INSERTed as two autocommit statements on a pool — there is no BEGIN
      anywhere in this repo — and the row carried `gen_random_uuid()`. Two
      writers for one owner that overlapped therefore both read head N and both
      INSERTed seq N+1 with the same prev_hash, because two inserts of DIFFERENT
      primary keys do not conflict under snapshot isolation. Nothing raised
      40001, so `withOccRetry` had nothing to retry.

      The header claimed the opposite ("two concurrent writers for one owner
      serialize via SQLSTATE 40001 retry") and `lib/auth/signin-attempts.ts`
      already asserted the truth about the same engine: "Two separate INSERTs
      never conflict under snapshot isolation."

      What the owner would have seen is the sharpest part: the chain does not
      lose data, it reports itself BROKEN. `verifyAuditChain` returns
      prev_hash_mismatch at that seq permanently, so the tamper-evident log
      accuses the product of tampering after an ordinary race, on an
      append-only table with no repair path.
    */
    const owner = 'race-owner';

    // Both writers read the head from the same snapshot: an empty chain.
    freezeHeadFor(2);
    await writeAuditEntry(owner, { actor: 'a', action: 'first', entity: 'e' });
    await writeAuditEntry(owner, { actor: 'b', action: 'second', entity: 'e' });

    const seqs = store.filter((r) => r.owner_id === owner).map((r) => r.seq).sort();
    expect(seqs, 'two entries landed at the same seq — the chain has forked').toEqual([0, 1]);

    expect(verifyAuditChain(await getAuditLog(owner))).toEqual({ valid: true, brokenSeq: null });
  });

  it('recognises its own INSERT replayed by the failover retry, and does not log twice', async () => {
    /*
      `query()` in lib/db/connection.ts retries a connection error on the
      SECONDARY pool with the identical SQL, and ECONNRESET/ETIMEDOUT can arrive
      AFTER the statement committed. The replay of a deterministic-id INSERT
      therefore hits its own row.

      The row that came back must be the one already stored — a second entry for
      one event is a fabricated fact in a log whose whole purpose is being
      trusted about what happened.
    */
    const owner = 'replay-owner';
    let replayed = false;
    const inMemory = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!replayed && sql.startsWith('INSERT INTO audit_log')) {
        replayed = true;
        await inMemory(sql, params);      // it landed…
        throw duplicateKey();             // …and the replay found it there
      }
      return inMemory(sql, params);
    });

    const entry = await writeAuditEntry(owner, { actor: 'a', action: 'once', entity: 'e' });

    expect(store.filter((r) => r.owner_id === owner)).toHaveLength(1);
    expect(entry.seq).toBe(0);
    expect(entry.entry_hash).toBe(store[0].entry_hash);
  });

  it('leaves a trace when it absorbs a content-identical collision, because it may be dropping a real event', async () => {
    /*
      🔴 THE BRANCH CANNOT TELL THE TWO CASES APART, and until 2026-08-21 it was
      written as though it could. It compares the stored `entry_hash` to the one
      just computed and, on a match, returns SUCCESS WITHOUT WRITING. Content
      equality is standing in for statement identity, and they are not the same
      claim: two genuinely distinct events for one owner with the same actor,
      action, entity, entity_id, detail and the same MILLISECOND `ts` — a
      double-submit is the realistic shape — hash identically, and the second is
      silently discarded while its caller is told it succeeded.

      That is a real event missing from a tamper-evident log, which is the one
      kind of gap this table exists to make impossible.

      The behaviour is KEPT — appending instead would fabricate a duplicate
      event, and this file's other test ("recognises its own INSERT replayed…")
      is the case that would break. What changes is that the drop is no longer
      silent: it writes a line naming owner and seq, so a disputed log has
      something to reconcile against.

      ⚠️ A TRACE, NOT AN ALARM. It is a stderr write into Vercel runtime logs —
      ~24h retention, read by nobody — exactly the channel this same file was
      corrected for calling an "operator alert" a few lines above. Closing this
      properly needs a distinguishing marker in the row, which is a migration
      and a sysadmin act. Recorded, not claimed.
    */
    const owner = 'identical-owner';
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      let replayed = false;
      const inMemory = mockQuery.getMockImplementation()!;
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (!replayed && sql.startsWith('INSERT INTO audit_log')) {
          replayed = true;
          await inMemory(sql, params);
          throw duplicateKey();
        }
        return inMemory(sql, params);
      });

      await writeAuditEntry(owner, { actor: 'a', action: 'once', entity: 'e' });
    } finally {
      spy.mockRestore();
    }

    expect(
      writes.some((w) => w.includes('[audit]') && w.includes(owner) && w.includes('seq 0')),
      'the branch returned success without writing and left no record that it had',
    ).toBe(true);
  });

  it('throws AuditWriteError after exhausting retries on persistent insert failure', async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY seq DESC')) return result([]);
      throw Object.assign(new Error('insert exploded'), { code: 'XXBAD' });
    });
    await expect(
      writeAuditEntry('owner-z', { actor: 'a', action: 'x', entity: 'e' }),
    ).rejects.toBeInstanceOf(AuditWriteError);
  });
});

// ---------------------------------------------------------------------------
// Property 16 — Audit log hash chain integrity
// ---------------------------------------------------------------------------

describe('Property 16: audit log hash chain integrity', () => {
  it('genesis + linkage + hash correctness hold for any 1..50 event sequence', async () => {
    // Feature: relay-h0-mvp, Property 16: Audit log hash chain integrity
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ actor: fc.string(), action: fc.string(), entity: fc.string() }),
          { minLength: 1, maxLength: 50 },
        ),
        async (events) => {
          store = [];
          idCounter = 0;
          const ownerId = 'prop16-owner';

          for (const event of events) {
            await writeAuditEntry(ownerId, event);
          }

          const entries: AuditEntry[] = await getAuditLog(ownerId);
          expect(entries.length).toBe(events.length);

          // Genesis
          expect(entries[0].prev_hash).toBe('0'.repeat(64));

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            // Linkage
            if (i > 0) {
              expect(entry.prev_hash).toBe(entries[i - 1].entry_hash);
            }
            // Hash correctness — recompute over the persisted row
            const expected = sha256(entry.prev_hash + canonicalJson(entry));
            expect(entry.entry_hash).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
