/**
 * Tests for lib/vault/dashboard-view.ts
 *
 * Validates: Requirements 7.4, 11.8 (dashboard grouping/sorting + risk graph)
 */

import { describe, it, expect } from 'vitest';
import { groupAndSortItems, gatesCount, compareItems, type DashboardItem } from './dashboard-view';

function item(over: Partial<DashboardItem> = {}): DashboardItem {
  return {
    id: 'i', type: 'login', title: 'T', service_name: null, url: null, category: 'other',
    criticality: 'medium', is_root_credential: false, importance_score: 0.5, depends_on_item_id: null, ...over,
  };
}

describe('groupAndSortItems', () => {
  it('orders category groups by the display order, unknowns last', () => {
    const groups = groupAndSortItems([
      item({ id: 'a', category: 'health' }),
      item({ id: 'b', category: 'finance' }),
      item({ id: 'c', category: 'mystery' }),
      item({ id: 'd', category: 'communication' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['finance', 'communication', 'health', 'mystery']);
  });

  it('sorts within a group by criticality then importance desc', () => {
    const groups = groupAndSortItems([
      item({ id: 'low', category: 'finance', criticality: 'low', importance_score: 0.9 }),
      item({ id: 'crit', category: 'finance', criticality: 'critical', importance_score: 0.1 }),
      item({ id: 'hi-a', category: 'finance', criticality: 'high', importance_score: 0.6 }),
      item({ id: 'hi-b', category: 'finance', criticality: 'high', importance_score: 0.8 }),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['crit', 'hi-b', 'hi-a', 'low']);
  });

  it('treats a null category as "other"', () => {
    const groups = groupAndSortItems([item({ category: null })]);
    expect(groups[0].category).toBe('other');
    expect(groups[0].label).toBe('Other');
  });
});

describe('compareItems', () => {
  it('breaks importance ties alphabetically by title', () => {
    const a = item({ title: 'Apple', criticality: 'high', importance_score: 0.5 });
    const b = item({ title: 'Banana', criticality: 'high', importance_score: 0.5 });
    expect(compareItems(a, b)).toBeLessThan(0);
  });
});

describe('gatesCount', () => {
  it('counts items that depend on the given id', () => {
    const items = [
      item({ id: 'gmail' }),
      item({ id: 'chase', depends_on_item_id: 'gmail' }),
      item({ id: 'bofa', depends_on_item_id: 'gmail' }),
      item({ id: 'solo' }),
    ];
    expect(gatesCount('gmail', items)).toBe(2);
    expect(gatesCount('solo', items)).toBe(0);
  });
});
