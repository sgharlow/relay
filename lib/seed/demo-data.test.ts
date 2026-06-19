/**
 * Tests for lib/seed/demo-data.ts
 *
 * Validates: Requirements 11.1, 7.4 (demo dataset invariants)
 */

import { describe, it, expect } from 'vitest';
import { buildDemoData } from './demo-data';

const data = buildDemoData();
const byKey = new Map(data.vaultItems.map((i) => [i.key, i]));

describe('demo dataset', () => {
  it('has a demo user and exactly 25 vault items across ≥4 categories', () => {
    expect(data.user.is_demo_account).toBe(true);
    expect(data.vaultItems).toHaveLength(25);
    const categories = new Set(data.vaultItems.map((i) => i.category));
    for (const c of ['finance', 'communication', 'government', 'health']) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it('marks exactly Gmail and 1Password as root credentials', () => {
    const roots = data.vaultItems.filter((i) => i.is_root_credential).map((i) => i.key).sort();
    expect(roots).toEqual(['gmail', 'onepassword']);
  });

  it('wires bank → gmail dependency edges for the risk-graph reveal', () => {
    for (const k of ['chase', 'bofa', 'fidelity']) {
      expect(byKey.get(k)?.dependsOnKey).toBe('gmail');
    }
  });

  it('keeps every importance_score within [0, 1]', () => {
    for (const i of data.vaultItems) {
      expect(i.importance_score).toBeGreaterThanOrEqual(0);
      expect(i.importance_score).toBeLessThanOrEqual(1);
    }
  });

  it('has unique item keys and every dependsOnKey points at a real item', () => {
    expect(new Set(data.vaultItems.map((i) => i.key)).size).toBe(25);
    for (const i of data.vaultItems) {
      if (i.dependsOnKey) expect(byKey.has(i.dependsOnKey)).toBe(true);
    }
  });

  it('has 2 recipients, 2 verifiers, and rules referencing valid keys', () => {
    expect(data.recipients).toHaveLength(2);
    expect(data.verifiers).toHaveLength(2);
    const recipientKeys = new Set(data.recipients.map((r) => r.key));
    for (const rule of data.rules) {
      expect(byKey.has(rule.vaultItemKey)).toBe(true);
      expect(recipientKeys.has(rule.recipientKey)).toBe(true);
      // estate rules must be irreversible (matches the DB CHECK + Property 7)
      if (rule.trigger_type === 'estate') expect(rule.reversible).toBe(false);
    }
  });

  it('provisions an ARMED emergency release_state', () => {
    const triggers = data.releaseStates.map((r) => r.trigger_type);
    expect(triggers).toContain('emergency');
    for (const rs of data.releaseStates) expect(rs.required_confirmations).toBeGreaterThanOrEqual(1);
  });
});
