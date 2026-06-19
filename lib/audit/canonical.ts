/**
 * Canonical JSON for the audit hash chain — pure, NO crypto/DB imports, so it is
 * safe to bundle into a Client Component (the audit viewer recomputes hashes
 * client-side via Web Crypto using this same canonicalisation).
 *
 *   entry_hash = SHA-256(prev_hash || canonicalJson(entry))
 *
 * Keys recursively sorted; the chain columns (`prev_hash`, `entry_hash`, `id`)
 * are excluded so recomputing a persisted row reproduces the stored hash.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.3, 8.4
 */

export const GENESIS_PREV_HASH = '0'.repeat(64);

const HASH_EXCLUDED_KEYS = new Set(['prev_hash', 'entry_hash', 'id']);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => !HASH_EXCLUDED_KEYS.has(k))
    .sort();

  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) out[key] = canonicalize(obj[key]);
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
