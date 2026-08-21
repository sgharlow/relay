/**
 * Audit hash-chain primitives (Requirement 8) — pure, no DB imports so this can
 * be reused by the writer, the chain-verifier, and a viewer.
 *
 *   entry_hash = SHA-256(prev_hash || canonicalJson(entry))
 *   prev_hash  = prior entry's entry_hash, or 64 zeros for the first entry
 *
 * `canonicalJson` deterministically serialises with recursively sorted keys and
 * EXCLUDES the chain columns (`prev_hash`, `entry_hash`, `id`) so recomputing a
 * persisted row's hash reproduces the stored value.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.3, 8.4
 */

import { createHash } from 'crypto';
import { GENESIS_PREV_HASH, canonicalJson } from './canonical';

// Re-exported for back-compat with existing importers.
export { GENESIS_PREV_HASH, canonicalJson } from './canonical';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Computes an entry hash from the prior hash + the (canonicalised) entry. */
export function computeEntryHash(prevHash: string, entry: unknown): string {
  return sha256(prevHash + canonicalJson(entry));
}

/**
 * The primary key an entry at `(ownerId, seq)` MUST carry.
 *
 * 🔴 THIS IS A GUARD, NOT AN IDENTIFIER SCHEME. `audit_log.id` was
 * `gen_random_uuid()` and `idx_audit_log_owner_seq` is non-unique, so nothing at
 * the database level stopped two rows sharing `(owner_id, seq)`. The writer
 * reads MAX(seq) and INSERTs as two autocommit statements — there is no BEGIN
 * anywhere in this repo — and two INSERTs of DIFFERENT primary keys do not
 * conflict under snapshot isolation, so an overlapping pair of writers for one
 * owner forked the chain and nothing raised SQLSTATE 40001 to retry.
 *
 * Deriving the key from the position in the chain makes that collision a
 * WRITE-WRITE CONFLICT ON ONE ROW, which is precisely the thing DSQL does
 * detect: the loser is refused (duplicate key, or 40001) and takes the next seq
 * instead. Safety by structure rather than by a comment asking a future writer
 * to remember — and it needs no migration, which matters because a migration
 * here is a sysadmin act that lands separately from the code.
 *
 * A UNIQUE index on `(owner_id, seq)` would express the same rule more directly.
 * It is not used because Aurora DSQL may not enforce UNIQUE secondary indexes —
 * migration 002 is the unapplied draft that records exactly that, and
 * `lib/auth/upsert-user.ts` documents the production 500 that discovering it
 * cost. A primary key is enforced.
 *
 * Rows written before 2026-08-21 carry random ids; they are untouched and still
 * verify, because the hash chain never covered `id` (it is in
 * `HASH_EXCLUDED_KEYS`). The guard binds from the next append onward.
 *
 * Shaped as an RFC 9562 version-8 (custom) UUID so the `UUID` column accepts it
 * and nobody mistakes it for a random one.
 */
export function auditEntryId(ownerId: string, seq: number): string {
  const h = sha256(`audit_log:${ownerId}:${seq}`);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-` +
    `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
  );
}

/** Minimal shape a chain entry must expose for verification. */
export interface ChainEntry {
  seq: number;
  prev_hash: string;
  entry_hash: string;
}

export interface ChainVerification {
  valid: boolean;
  /** `seq` of the first entry whose linkage or hash is broken, else null. */
  brokenSeq: number | null;
  reason?: 'prev_hash_mismatch' | 'entry_hash_mismatch';
}

/**
 * Re-derives the chain over `entries` (assumed ascending by seq) and reports the
 * first broken link. For each entry: prev_hash must equal the prior entry's
 * entry_hash (genesis for the first), and entry_hash must equal the recomputed
 * SHA-256 of (prev_hash || canonicalJson(entry)).
 */
export function verifyAuditChain<T extends ChainEntry>(entries: T[]): ChainVerification {
  let prev = GENESIS_PREV_HASH;
  for (const entry of entries) {
    if (entry.prev_hash !== prev) {
      return { valid: false, brokenSeq: entry.seq, reason: 'prev_hash_mismatch' };
    }
    if (computeEntryHash(entry.prev_hash, entry) !== entry.entry_hash) {
      return { valid: false, brokenSeq: entry.seq, reason: 'entry_hash_mismatch' };
    }
    prev = entry.entry_hash;
  }
  return { valid: true, brokenSeq: null };
}
