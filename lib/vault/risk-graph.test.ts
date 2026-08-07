/**
 * Tests for the risk-graph reveal — the J1 "aha" moment.
 *
 * Reuses gatesCount from dashboard-view rather than re-implementing the
 * dependency count: two implementations of one rule is the contract-duplication
 * this codebase already guards against.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R6
 */

import { describe, it, expect } from 'vitest';
import { computeReveal } from './risk-graph';
import type { DashboardItem } from './dashboard-view';

function item(p: Partial<DashboardItem> & { id: string }): DashboardItem {
  return {
    type: 'login',
    title: p.id,
    service_name: null,
    url: null,
    category: 'communication',
    criticality: 'high',
    is_root_credential: false,
    importance_score: 0.5,
    depends_on_item_id: null,
    ...p,
  };
}

describe('computeReveal', () => {
  it('names the item the most others depend on', () => {
    const items = [
      item({ id: 'gmail', title: 'Gmail', is_root_credential: true }),
      item({ id: 'chase', depends_on_item_id: 'gmail' }),
      item({ id: 'bcbs', depends_on_item_id: 'gmail' }),
      item({ id: 'pge', depends_on_item_id: 'gmail' }),
      item({ id: 'standalone' }),
    ];

    const r = computeReveal(items);

    expect(r.rootId).toBe('gmail');
    expect(r.rootTitle).toBe('Gmail');
    expect(r.gatedCount).toBe(3);
    expect(r.totalCount).toBe(5);
    expect(r.headline).toContain('Gmail');
    expect(r.headline).toContain('3');
    expect(r.headline).toContain('5');
  });

  it('picks the highest-degree item when several compete', () => {
    const items = [
      item({ id: 'gmail', title: 'Gmail', is_root_credential: true }),
      item({ id: 'phone', title: 'Phone', is_root_credential: true }),
      item({ id: 'a', depends_on_item_id: 'phone' }),
      item({ id: 'b', depends_on_item_id: 'phone' }),
      item({ id: 'c', depends_on_item_id: 'gmail' }),
    ];

    expect(computeReveal(items).rootId).toBe('phone');
  });

  it('breaks ties deterministically by title', () => {
    const items = [
      item({ id: 'b1', title: 'Bravo' }),
      item({ id: 'a1', title: 'Alpha' }),
      item({ id: 'x', depends_on_item_id: 'b1' }),
      item({ id: 'y', depends_on_item_id: 'a1' }),
    ];

    expect(computeReveal(items).rootTitle).toBe('Alpha');
  });

  it('lists the dependent items so the claim is checkable', () => {
    const items = [
      item({ id: 'gmail', title: 'Gmail' }),
      item({ id: 'chase', title: 'Chase', depends_on_item_id: 'gmail' }),
      item({ id: 'bcbs', title: 'Blue Cross', depends_on_item_id: 'gmail' }),
    ];

    expect(computeReveal(items).gatedTitles).toEqual(['Blue Cross', 'Chase']);
  });

  it('degrades honestly when nothing depends on anything', () => {
    const r = computeReveal([item({ id: 'a' }), item({ id: 'b' })]);

    expect(r.rootId).toBeNull();
    expect(r.gatedCount).toBe(0);
    expect(r.gatedTitles).toEqual([]);
    expect(r.headline).not.toMatch(/undefined|null|NaN/);
    expect(r.headline.length).toBeGreaterThan(0);
  });

  it('handles an empty vault without throwing', () => {
    const r = computeReveal([]);

    expect(r.totalCount).toBe(0);
    expect(r.rootId).toBeNull();
    expect(r.headline).not.toMatch(/undefined|null|NaN/);
  });

  it('ignores a dependency edge pointing at an item that is not present', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', depends_on_item_id: 'ghost' })];

    expect(computeReveal(items).gatedCount).toBe(0);
    expect(computeReveal(items).rootId).toBeNull();
  });

  it('never counts an item as depending on itself', () => {
    const items = [item({ id: 'a', title: 'Self' }), item({ id: 'b', depends_on_item_id: 'a' })];
    const selfRef = [item({ id: 'a', title: 'Self', depends_on_item_id: 'a' })];

    expect(computeReveal(items).gatedCount).toBe(1);
    expect(computeReveal(selfRef).gatedCount).toBe(0);
  });

  it('agrees with gatesCount, the existing implementation', async () => {
    const { gatesCount } = await import('./dashboard-view');
    const items = [
      item({ id: 'gmail', title: 'Gmail' }),
      item({ id: 'a', depends_on_item_id: 'gmail' }),
      item({ id: 'b', depends_on_item_id: 'gmail' }),
    ];

    const r = computeReveal(items);
    expect(r.gatedCount).toBe(gatesCount('gmail', items));
  });
});
