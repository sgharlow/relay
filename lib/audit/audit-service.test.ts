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

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function installInMemoryDb() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const p = params ?? [];

    // SELECT chain head
    if (sql.includes('ORDER BY seq DESC')) {
      const ownerRows = store
        .filter((r) => r.owner_id === p[0])
        .sort((a, b) => b.seq - a.seq);
      return result(ownerRows.length ? [{ seq: ownerRows[0].seq, entry_hash: ownerRows[0].entry_hash }] : []);
    }

    // INSERT new entry
    if (sql.startsWith('INSERT INTO audit_log')) {
      const row: Row = {
        id: `audit-${idCounter++}`,
        owner_id: p[0] as string,
        seq: p[1] as number,
        actor: p[2] as string,
        action: p[3] as string,
        entity: p[4] as string,
        entity_id: (p[5] as string | null) ?? null,
        detail: JSON.parse(p[6] as string),
        prev_hash: p[7] as string,
        entry_hash: p[8] as string,
        ts: p[9] as string,
      };
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
