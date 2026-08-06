/**
 * Demo-tour fixture integrity — the /demo page must only ever show honest data.
 *
 * The audit chain rendered on /demo is computed with the production primitives,
 * so these tests hold it to the production bar: it must verify with
 * `verifyAuditChain`, and any tampering must break it (tamper-evidence is the
 * claim the page makes). Sample metadata must respect the same invariants the
 * real app enforces (importance clamped to [0,1]; no plaintext column in the
 * stored envelope).
 *
 * Feature: relay-h0-mvp (demo tour)
 */

import { describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit/chain';
import {
  DEMO_AUDIT_CHAIN,
  DEMO_CHAIN_VERIFICATION,
  DEMO_ITEM_ENVELOPE,
  DEMO_RELEASE_TIMELINE,
  DEMO_VAULT_ITEMS,
  buildDemoAuditChain,
} from './fixtures';

describe('demo-tour fixtures', () => {
  it('audit chain verifies with the production verifier', () => {
    const result = verifyAuditChain(DEMO_AUDIT_CHAIN);
    expect(result).toEqual({ valid: true, brokenSeq: null });
    // The precomputed verification shown on the page is the same result.
    expect(DEMO_CHAIN_VERIFICATION).toEqual(result);
  });

  it('chain is deterministic and genesis-anchored', () => {
    const rebuilt = buildDemoAuditChain();
    expect(rebuilt).toEqual(DEMO_AUDIT_CHAIN);
    expect(DEMO_AUDIT_CHAIN[0].prev_hash).toBe('0'.repeat(64));
    expect(DEMO_AUDIT_CHAIN.map((e) => e.seq)).toEqual(
      DEMO_AUDIT_CHAIN.map((_, i) => i + 1),
    );
  });

  it('tampering with any entry breaks verification (tamper-evidence)', () => {
    for (const seq of [1, 5, DEMO_AUDIT_CHAIN.length]) {
      const tampered = DEMO_AUDIT_CHAIN.map((e) =>
        e.seq === seq ? { ...e, detail: e.detail + ' (edited)' } : { ...e },
      );
      const result = verifyAuditChain(tampered);
      expect(result.valid).toBe(false);
      expect(result.brokenSeq).toBe(seq);
      expect(result.reason).toBe('entry_hash_mismatch');
    }
  });

  it('importance scores respect the production clamp [0, 1]', () => {
    for (const item of DEMO_VAULT_ITEMS) {
      expect(item.importance).toBeGreaterThanOrEqual(0);
      expect(item.importance).toBeLessThanOrEqual(1);
    }
  });

  it('release timeline walks the state machine in order', () => {
    expect(DEMO_RELEASE_TIMELINE.map((s) => s.state)).toEqual([
      'ARMED',
      'PENDING',
      'GRACE',
      'RELEASED',
    ]);
  });

  it('stored envelope exposes ciphertext structure but never a plaintext column', () => {
    expect(DEMO_ITEM_ENVELOPE.storedColumns).toContain('ciphertext');
    expect(DEMO_ITEM_ENVELOPE.storedColumns).toContain('wrapped_data_key');
    expect(DEMO_ITEM_ENVELOPE.storedColumns).not.toContain('plaintext');
    expect(JSON.stringify(DEMO_ITEM_ENVELOPE).toLowerCase()).not.toContain('"plaintext"');
  });
});
