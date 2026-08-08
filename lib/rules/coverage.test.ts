/**
 * Tests for coverage analysis and the circle-complete state.
 *
 * The question this answers is "which critical items can nobody reach?" — the
 * failure that is invisible until the moment it matters (J4-R5, J4-R13).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R5, J4-R13
 */

import { describe, it, expect } from 'vitest';
import { computeCoverage } from './coverage';
import type { PolicyItem } from './policy-predicate';

function item(id: string, criticality: string | null): PolicyItem {
  return {
    id,
    category: 'finance',
    criticality,
    is_root_credential: false,
    irreplaceable: false,
    importance_score: 0.5,
  };
}

describe('computeCoverage', () => {
  it('flags critical items no rule reaches', () => {
    const c = computeCoverage(
      [item('a', 'critical'), item('b', 'critical')],
      [{ vault_item_id: 'a', recipient_id: 'r1' }],
    );

    expect(c.uncoveredCritical).toEqual(['b']);
    expect(c.circleComplete).toBe(false);
  });

  it('does not flag non-critical items', () => {
    const c = computeCoverage([item('a', 'low'), item('b', null)], []);

    expect(c.uncoveredCritical).toEqual([]);
    expect(c.circleComplete).toBe(true);
  });

  it('treats a root credential as critical even when scored lower', () => {
    const root: PolicyItem = { ...item('a', 'medium'), is_root_credential: true };
    const c = computeCoverage([root], []);

    expect(c.uncoveredCritical).toEqual(['a']);
  });

  it('counts distinct grants per recipient', () => {
    const c = computeCoverage(
      [item('a', 'critical'), item('b', 'critical')],
      [
        { vault_item_id: 'a', recipient_id: 'r1' },
        { vault_item_id: 'b', recipient_id: 'r1' },
      ],
    );

    expect(c.byRecipient).toEqual({ r1: 2 });
    expect(c.circleComplete).toBe(true);
  });

  it('deduplicates repeated rules for the same pair', () => {
    const c = computeCoverage(
      [item('a', 'critical')],
      [
        { vault_item_id: 'a', recipient_id: 'r1' },
        { vault_item_id: 'a', recipient_id: 'r1' },
        { vault_item_id: 'a', recipient_id: 'r2' },
      ],
    );

    expect(c.byRecipient).toEqual({ r1: 1, r2: 1 });
    expect(c.uncoveredCritical).toEqual([]);
  });

  it('an empty vault is trivially complete', () => {
    const c = computeCoverage([], []);

    expect(c.circleComplete).toBe(true);
    expect(c.uncoveredCritical).toEqual([]);
    expect(c.byRecipient).toEqual({});
  });

  it('ignores a rule pointing at an item that no longer exists', () => {
    const c = computeCoverage([item('a', 'critical')], [{ vault_item_id: 'ghost', recipient_id: 'r1' }]);

    expect(c.uncoveredCritical).toEqual(['a']);
    expect(c.byRecipient).toEqual({});
  });

  it('returns uncovered ids in stable order', () => {
    const c = computeCoverage(
      [item('c', 'critical'), item('a', 'critical'), item('b', 'critical')],
      [],
    );

    expect(c.uncoveredCritical).toEqual(['a', 'b', 'c']);
  });
});
