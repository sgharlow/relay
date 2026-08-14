/**
 * "You need the email password before you can reset the bank."
 *
 * 🔴 REQUIREMENT 13.2 WAS IMPLEMENTED AND NEVER CALLED. The dependency-ordered
 * plan lived in buildTriagePlan, which had zero production callers, while the
 * access dashboard — the screen a recipient actually reads at release —
 * SELECTed `depends_on_item_id` and then sorted by importance alone. So the
 * product permanently shipped what the spec defines as the fallback (13.8), and
 * the first thing a grieving person was told to do was the highest-stakes
 * account, which typically needs a reset code from an email account further
 * down the list.
 *
 * The ordering is now defined once and used by both, so it is tested once, on
 * the primitive, as a property rather than on examples.
 *
 * Feature: relay-h0-mvp
 * Requirements: 13.2, 7.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { orderByDependency } from './dependency-order';

interface Item {
  id: string;
  rank: number;
  dep: string | null;
}

const order = (items: Item[]) =>
  orderByDependency(items, {
    id: (i) => i.id,
    dependsOn: (i) => i.dep,
    compare: (a, b) => a.rank - b.rank,
  });

/** Items with unique ids and dependencies that only ever point BACKWARDS (acyclic). */
const acyclicItems = fc
  .array(fc.record({ rank: fc.integer({ min: 0, max: 50 }), depIdx: fc.integer({ min: -1, max: 20 }) }), {
    minLength: 1,
    maxLength: 20,
  })
  .map((raw) =>
    raw.map((r, idx) => ({
      id: `i${idx}`,
      rank: r.rank,
      // Only ever points at an earlier index, so no cycle can form.
      dep: r.depIdx >= 0 && r.depIdx < idx ? `i${r.depIdx}` : null,
    })),
  );

describe('orderByDependency', () => {
  it('never places an item before something it depends on', () => {
    // Feature: relay-h0-mvp, Property 13.2
    fc.assert(
      fc.property(acyclicItems, (items) => {
        const out = order(items);
        const at = new Map(out.map((i, idx) => [i.id, idx]));

        for (const item of items) {
          if (!item.dep) continue;
          expect(at.get(item.id)!).toBeGreaterThan(at.get(item.dep)!);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('keeps every item exactly once — a plan that loses an item is worse than an unordered one', () => {
    fc.assert(
      fc.property(acyclicItems, (items) => {
        const out = order(items);
        expect(out).toHaveLength(items.length);
        expect(new Set(out.map((i) => i.id)).size).toBe(items.length);
      }),
      { numRuns: 500 },
    );
  });

  /*
    Req 7.4 / Property 15 still decide every free choice: the dependency rule
    only removes options, it does not reorder what was already permitted.
  */
  it('falls back to pure priority order when nothing depends on anything', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 25 }),
        (ranks) => {
          const items = ranks.map((rank, idx) => ({ id: `i${idx}`, rank, dep: null }));
          const out = order(items).map((i) => i.rank);
          expect(out).toEqual([...ranks].sort((a, b) => a - b));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('treats a dependency outside the set as already satisfied', () => {
    // A recipient scoped to three items must not have their plan held hostage
    // by an item they were never granted.
    const out = order([
      { id: 'a', rank: 2, dep: 'not-in-scope' },
      { id: 'b', rank: 1, dep: null },
    ]);
    expect(out.map((i) => i.id)).toEqual(['b', 'a']);
  });

  /*
    DSQL has no FK constraints — `depends_on_item_id` is app-enforced, so a cycle
    is reachable through data rather than impossible by construction. During an
    emergency a questionable order beats an empty plan.
  */
  it('emits every item even when the dependencies form a cycle', () => {
    const out = order([
      { id: 'a', rank: 1, dep: 'b' },
      { id: 'b', rank: 2, dep: 'a' },
      { id: 'c', rank: 0, dep: null },
    ]);
    expect(out.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(out[0].id).toBe('c'); // the resolvable one still leads
  });

  it('survives an item that depends on itself', () => {
    const out = order([{ id: 'a', rank: 1, dep: 'a' }]);
    expect(out.map((i) => i.id)).toEqual(['a']);
  });

  it('orders a realistic chain: email unlocks the bank that unlocks the mortgage', () => {
    // Importance alone would put the mortgage first and strand the recipient.
    const out = order([
      { id: 'mortgage', rank: 0, dep: 'bank' },
      { id: 'bank', rank: 1, dep: 'email' },
      { id: 'email', rank: 2, dep: null },
    ]);
    expect(out.map((i) => i.id)).toEqual(['email', 'bank', 'mortgage']);
  });
});
