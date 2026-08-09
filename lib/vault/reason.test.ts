/**
 * Tests for the vault ranking and its reasons.
 *
 * The claim being protected: the importance engine's output is legible without
 * a legend. A number the reader has to interpret is not an insight, and the
 * audit found exactly that shipped — a bare `50` and an `n/a` with no header.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.4, J2-R7
 */

import { describe, it, expect } from 'vitest';

import { reasonFor, rankItems } from './reason';
import type { DashboardItem } from './dashboard-view';

const item = (over: Partial<DashboardItem> = {}): DashboardItem =>
  ({
    id: 'i1',
    title: 'Gmail',
    type: 'login',
    service_name: 'google.com',
    url: null,
    category: 'email',
    criticality: null,
    is_root_credential: false,
    importance_score: 0.5,
    depends_on_item_id: null,
    ...over,
  }) as DashboardItem;

describe('reasonFor', () => {
  it('leads with the dependency count, because it is the strongest true claim', () => {
    expect(reasonFor(item(), 4)).toBe('Unlocks password resets for 4 of your other accounts');
  });

  it('says "1 of your other accounts" without pluralising wrongly', () => {
    expect(reasonFor(item(), 1)).toContain('1 of your other accounts');
  });

  it('falls back to the root flag when nothing points at it yet', () => {
    expect(reasonFor(item({ is_root_credential: true }), 0)).toBe(
      'Other accounts recover through this one',
    );
  });

  it('prefers the dependency count over the root flag when both apply', () => {
    // The count is specific; "is a root" is a category. Specific wins.
    expect(reasonFor(item({ is_root_credential: true }), 3)).toContain('3 of your other accounts');
  });

  it('uses the owner\'s own marking when there is no structural reason', () => {
    expect(reasonFor(item({ criticality: 'critical' }), 0)).toBe(
      'You marked this as one that matters most',
    );
  });

  it('says nothing rather than padding', () => {
    // An invented sentence under every row would train the reader to skip them,
    // which costs the rows that DO carry a reason.
    expect(reasonFor(item(), 0)).toBeNull();
  });
});

describe('rankItems', () => {
  it('puts the most consequential first', () => {
    const ranked = rankItems([
      item({ id: 'low', importance_score: 0.2 }),
      item({ id: 'high', importance_score: 0.9 }),
      item({ id: 'mid', importance_score: 0.5 }),
    ]);
    expect(ranked.map((i) => i.id)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks ties deterministically, so the list never reshuffles between renders', () => {
    const a = rankItems([
      item({ id: 'b', title: 'Bank', importance_score: 0.5 }),
      item({ id: 'a', title: 'Airline', importance_score: 0.5 }),
    ]);
    const b = rankItems([
      item({ id: 'a', title: 'Airline', importance_score: 0.5 }),
      item({ id: 'b', title: 'Bank', importance_score: 0.5 }),
    ]);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
  });

  it('prefers a root credential on an equal score', () => {
    const ranked = rankItems([
      item({ id: 'plain', title: 'A', importance_score: 0.5 }),
      item({ id: 'root', title: 'Z', importance_score: 0.5, is_root_credential: true }),
    ]);
    expect(ranked[0].id).toBe('root');
  });

  it('does not mutate the caller\'s array', () => {
    const input = [item({ id: 'a', importance_score: 0.1 }), item({ id: 'b', importance_score: 0.9 })];
    rankItems(input);
    expect(input.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
