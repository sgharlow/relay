/**
 * "You need the email password before you can reset the bank."
 *
 * Requirement 13.2 in one sentence: an item whose dependency is also in the plan
 * must come AFTER it, and among items with nothing blocking them the ordinary
 * priority order wins. A recipient handed a flat importance-sorted list starts
 * with the highest-stakes account and immediately hits a password reset that
 * emails a mailbox they cannot open yet.
 *
 * 🔴 WHY THIS IS A SHARED PRIMITIVE AND NOT A SECOND IMPLEMENTATION. The rule
 * lived inside buildTriagePlan, which nothing called; the access dashboard —
 * the thing recipients actually read — did its own importance-only sort and
 * ignored `depends_on_item_id` entirely, despite selecting the column. Writing
 * the topological pass a second time in dashboard.ts would put one contract in
 * two places and let them drift, which the portfolio rules name as the failure
 * mode. So it is defined once here and both callers use it.
 *
 * IT DOES NOT REPLACE THE PRIORITY ORDER, IT CONSTRAINS IT. Requirement 7.4 and
 * Property 15 define how items rank (roots first, importance descending, title
 * as tiebreak); that comparator is passed IN and still decides every free
 * choice. This only refuses to place a dependent before its dependency.
 *
 * Feature: relay-h0-mvp
 * Requirements: 13.2, 7.4
 */

export interface DependencyOrderOptions<T> {
  /** Stable identity of an item. */
  id: (item: T) => string;
  /** The item this one needs first, if any. */
  dependsOn: (item: T) => string | null | undefined;
  /** Priority among items that are equally unblocked (Req 7.4 / Property 15). */
  compare: (a: T, b: T) => number;
}

/**
 * Kahn's algorithm with a priority queue: repeatedly take the highest-priority
 * item whose dependency is already placed.
 *
 * A dependency pointing outside the given set counts as already resolved — a
 * recipient scoped to three items should not have their plan held hostage by an
 * item they were never granted.
 *
 * CYCLES CANNOT DEADLOCK IT. `depends_on_item_id` is app-enforced (DSQL has no
 * FK constraints), so a cycle is reachable through data rather than impossible
 * by construction. Anything still unplaced is appended in priority order: a
 * questionable order beats an empty plan during an emergency.
 */
export function orderByDependency<T>(items: T[], opts: DependencyOrderOptions<T>): T[] {
  const { id, dependsOn, compare } = opts;

  const present = new Set(items.map(id));
  const byId = new Map(items.map((i) => [id(i), i]));
  const blockedBy = new Map<string, string | null>();
  const dependents = new Map<string, string[]>();

  for (const item of items) {
    const dep = dependsOn(item);
    const blocking = dep && present.has(dep) && dep !== id(item) ? dep : null;
    blockedBy.set(id(item), blocking);
    if (blocking) dependents.set(blocking, [...(dependents.get(blocking) ?? []), id(item)]);
  }

  const ready = items.filter((i) => blockedBy.get(id(i)) === null);
  const ordered: T[] = [];
  const placed = new Set<string>();

  while (ready.length > 0) {
    ready.sort(compare);
    const next = ready.shift()!;
    ordered.push(next);
    placed.add(id(next));

    for (const depId of dependents.get(id(next)) ?? []) {
      if (placed.has(depId)) continue;
      blockedBy.set(depId, null);
      const item = byId.get(depId);
      if (item !== undefined) ready.push(item);
    }
  }

  if (ordered.length < items.length) {
    ordered.push(...items.filter((i) => !placed.has(id(i))).sort(compare));
  }

  return ordered;
}
