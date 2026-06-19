/**
 * Guards the audit viewer's client-side chain recompute: the browser's Web
 * Crypto SHA-256 (hex) must match the server's node `createHash` SHA-256 over the
 * SAME canonicalJson — otherwise the viewer would report a false "broken" chain.
 *
 * Validates: Requirement 8.4 (verification parity)
 */

import { describe, it, expect } from 'vitest';
import { sha256, GENESIS_PREV_HASH } from './chain';
import { canonicalJson } from './canonical';

async function subtleHex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Web Crypto / node SHA-256 parity', () => {
  it('produces identical hex digests for arbitrary inputs', async () => {
    for (const s of ['', 'hello', 'the quick brown fox', GENESIS_PREV_HASH]) {
      expect(await subtleHex(s)).toBe(sha256(s));
    }
  });

  it('agrees over a realistic prev_hash + canonicalJson(entry) payload', async () => {
    const entry = { seq: 1, owner_id: 'o', actor: 'system', action: 'x', entity: 'e', entity_id: null, detail: { a: 1 }, ts: '2026-01-01T00:00:00Z' };
    const input = GENESIS_PREV_HASH + canonicalJson(entry);
    expect(await subtleHex(input)).toBe(sha256(input));
  });
});
