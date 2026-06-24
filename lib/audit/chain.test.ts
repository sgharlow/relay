/**
 * Tests for lib/audit/chain.ts
 *
 * Validates: Requirements 8.3, 8.4 (chain verification)
 */

import { describe, it, expect } from 'vitest';
import { canonicalJson, computeEntryHash, verifyAuditChain, GENESIS_PREV_HASH, type ChainEntry } from './chain';

type TestEntry = ChainEntry & Record<string, unknown>;

/** Builds a valid chain of N entries from arbitrary payload fields. */
function buildChain(payloads: Array<Record<string, unknown>>): TestEntry[] {
  const entries: TestEntry[] = [];
  let prev = GENESIS_PREV_HASH;
  payloads.forEach((p, i) => {
    const base = { seq: i, ...p };
    const entry_hash = computeEntryHash(prev, base);
    entries.push({ ...base, prev_hash: prev, entry_hash } as TestEntry);
    prev = entry_hash;
  });
  return entries;
}

describe('canonicalJson', () => {
  it('is order-independent and excludes chain columns', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 1, prev_hash: 'x', entry_hash: 'y', id: 'z' })).toBe(canonicalJson({ a: 1 }));
  });

  it('serialises a Date identically to its ISO string (DSQL TIMESTAMPTZ round-trip)', () => {
    // The writer hashes `ts` as `new Date().toISOString()`; pg returns TIMESTAMPTZ
    // as a Date object server-side. Both must canonicalise to the same string.
    const iso = '2026-06-24T18:07:14.430Z';
    expect(canonicalJson({ ts: new Date(iso) })).toBe(canonicalJson({ ts: iso }));
  });
});

describe('verifyAuditChain', () => {
  it('accepts a well-formed chain', () => {
    const chain = buildChain([{ actor: 'a', action: 'x' }, { actor: 'b', action: 'y' }, { actor: 'c', action: 'z' }]);
    expect(verifyAuditChain(chain)).toEqual({ valid: true, brokenSeq: null });
  });

  it('accepts the empty chain and a single-entry chain', () => {
    expect(verifyAuditChain([]).valid).toBe(true);
    expect(verifyAuditChain(buildChain([{ actor: 'solo' }])).valid).toBe(true);
  });

  it('accepts an entry written with an ISO-string ts but read back as a Date (DSQL, Property 16)', () => {
    const iso = '2026-06-24T18:07:14.430Z';
    const base = { seq: 0, actor: 'a', ts: iso }; // what the writer hashed
    const entry_hash = computeEntryHash(GENESIS_PREV_HASH, base);
    // what the verifier sees server-side: ts is a Date object from pg
    const readBack = { seq: 0, actor: 'a', ts: new Date(iso), prev_hash: GENESIS_PREV_HASH, entry_hash } as unknown as TestEntry;
    expect(verifyAuditChain([readBack]).valid).toBe(true);
  });

  it('detects a tampered entry payload (entry_hash mismatch)', () => {
    const chain = buildChain([{ actor: 'a' }, { actor: 'b' }, { actor: 'c' }]);
    chain[1].actor = 'TAMPERED'; // change content without recomputing the hash
    const result = verifyAuditChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenSeq).toBe(1);
    expect(result.reason).toBe('entry_hash_mismatch');
  });

  it('detects a broken link (prev_hash mismatch)', () => {
    const chain = buildChain([{ actor: 'a' }, { actor: 'b' }]);
    chain[1].prev_hash = 'f'.repeat(64); // wrong link
    chain[1].entry_hash = computeEntryHash(chain[1].prev_hash, { seq: 1, actor: 'b' }); // self-consistent but unlinked
    const result = verifyAuditChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenSeq).toBe(1);
    expect(result.reason).toBe('prev_hash_mismatch');
  });

  it('requires the genesis prev_hash on the first entry', () => {
    const chain = buildChain([{ actor: 'a' }]);
    chain[0].prev_hash = '1'.repeat(64);
    expect(verifyAuditChain(chain).valid).toBe(false);
  });
});
