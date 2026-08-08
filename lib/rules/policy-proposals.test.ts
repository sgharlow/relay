/**
 * Tests for proposed starting policies.
 *
 * The owner edits a draft rather than authoring from an empty state (J4-R2).
 * Deterministic and metadata-only — no LLM call — so proposals are reproducible
 * and testable.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2
 */

import { describe, it, expect } from 'vitest';
import { proposePolicies } from './policy-proposals';
import { matchesPolicy, type PolicyItem } from './policy-predicate';

function item(p: Partial<PolicyItem> & { id: string }): PolicyItem {
  return {
    category: 'finance',
    criticality: 'high',
    is_root_credential: false,
    irreplaceable: false,
    importance_score: 0.5,
    ...p,
  };
}

const RECIPIENTS = [
  { id: 'r-son', name: 'Sam', role: 'recipient' },
  { id: 'r-daughter', name: 'Sarah', role: 'caregiver' },
];

describe('proposePolicies', () => {
  it('returns nothing when there are no recipients', () => {
    expect(proposePolicies([item({ id: 'a' })], [])).toEqual([]);
  });

  it('returns nothing when no item matches any template', () => {
    const nothing = [item({ id: 'a', category: 'personal', criticality: 'low' })];
    expect(proposePolicies(nothing, RECIPIENTS)).toEqual([]);
  });

  it('addresses proposals to the caregiver when one exists', () => {
    const items = [item({ id: 'a', is_root_credential: true })];
    const out = proposePolicies(items, RECIPIENTS);

    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(p.recipientId).toBe('r-daughter');
  });

  it('falls back to the first recipient when no caregiver is designated', () => {
    const items = [item({ id: 'a', is_root_credential: true })];
    const out = proposePolicies(items, [{ id: 'r-son', name: 'Sam', role: 'recipient' }]);

    expect(out[0].recipientId).toBe('r-son');
  });

  it('proposes root credentials with act scope — they are the reset path', () => {
    const items = [item({ id: 'a', is_root_credential: true })];
    const root = proposePolicies(items, RECIPIENTS).find((p) => p.predicate.isRootCredential);

    expect(root).toBeDefined();
    expect(root!.scope).toBe('act');
    expect(root!.rationale.length).toBeGreaterThan(0);
  });

  it('only proposes templates that actually match something, with real counts', () => {
    const items = [
      item({ id: 'a', is_root_credential: true }),
      item({ id: 'b', category: 'finance', criticality: 'critical' }),
      item({ id: 'c', category: 'finance', criticality: 'critical' }),
    ];

    for (const p of proposePolicies(items, RECIPIENTS)) {
      expect(p.itemCount).toBeGreaterThan(0);
      const actual = items.filter((i) => matchesPolicy(i, p.predicate)).length;
      expect(p.itemCount).toBe(actual);
    }
  });

  it('proposes reversible emergency policies, never estate', () => {
    const items = [item({ id: 'a', is_root_credential: true })];

    for (const p of proposePolicies(items, RECIPIENTS)) {
      expect(p.triggerType).toBe('emergency');
      expect(p.reversible).toBe(true);
    }
  });

  it('is deterministic — same input, same proposals', () => {
    const items = [
      item({ id: 'a', is_root_credential: true }),
      item({ id: 'b', criticality: 'critical' }),
    ];

    expect(JSON.stringify(proposePolicies(items, RECIPIENTS))).toBe(
      JSON.stringify(proposePolicies(items, RECIPIENTS)),
    );
  });

  it('every proposal carries a plain-language rationale', () => {
    const items = [
      item({ id: 'a', is_root_credential: true }),
      item({ id: 'b', criticality: 'critical' }),
      item({ id: 'c', category: 'utilities' }),
    ];

    for (const p of proposePolicies(items, RECIPIENTS)) {
      expect(p.rationale).toMatch(/[a-z]/);
      expect(p.rationale).not.toMatch(/TODO|TBD/i);
    }
  });
});
