/**
 * Pure view logic for the owner vault dashboard (Requirement 11.8, 7.4).
 *
 * Grouping/sorting and the risk-graph "gates N" count live here so they are
 * unit-testable without rendering — and DB-free so they are safe to import into
 * a Client Component (no `pg` in the browser bundle).
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.4, 11.1, 11.8
 */

/** The subset of vault item metadata the dashboard renders. */
export interface DashboardItem {
  id: string;
  type: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  is_root_credential: boolean;
  importance_score: number;
  depends_on_item_id: string | null;
}

export const CATEGORY_LABELS: Record<string, string> = {
  finance: 'Finance',
  communication: 'Communication',
  government: 'Government',
  health: 'Health',
  professional: 'Professional',
  personal: 'Personal',
  utilities: 'Utilities',
  other: 'Other',
};

// Display order for category groups; unknown categories sort last.
const CATEGORY_ORDER = [
  'finance',
  'communication',
  'government',
  'health',
  'professional',
  'personal',
  'utilities',
  'other',
];

const CRITICALITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface ItemGroup {
  category: string;
  label: string;
  items: DashboardItem[];
}

/** Sort: criticality (critical→low), then importance_score descending. */
export function compareItems(a: DashboardItem, b: DashboardItem): number {
  const ca = CRITICALITY_RANK[a.criticality ?? ''] ?? 4;
  const cb = CRITICALITY_RANK[b.criticality ?? ''] ?? 4;
  if (ca !== cb) return ca - cb;
  if (b.importance_score !== a.importance_score) return b.importance_score - a.importance_score;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

/** Groups items by category (ordered) with each group sorted by compareItems. */
export function groupAndSortItems(items: DashboardItem[]): ItemGroup[] {
  const byCat = new Map<string, DashboardItem[]>();
  for (const it of items) {
    const cat = it.category ?? 'other';
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(it);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return cats.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    items: byCat.get(cat)!.slice().sort(compareItems),
  }));
}

/** How many items list `itemId` as their dependency — the "gates N" reveal. */
export function gatesCount(itemId: string, items: DashboardItem[]): number {
  return items.filter((i) => i.depends_on_item_id === itemId).length;
}
