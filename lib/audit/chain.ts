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
