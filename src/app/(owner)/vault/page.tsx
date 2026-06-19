'use client';

/**
 * Vault dashboard (Requirement 12.2, 7.4).
 *
 * Fetches GET /api/vault/items and renders items grouped by category, sorted by
 * criticality then importance_score. Shows the root-credential badge and the
 * risk-graph reveal ("gates N") for items others depend on. Import + add-item CTAs.
 *
 * Feature: relay-h0-mvp
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { groupAndSortItems, gatesCount, type DashboardItem } from '../../../../lib/vault/dashboard-view';

const CRITICALITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

export default function VaultDashboardPage() {
  const [items, setItems] = useState<DashboardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/vault/items')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load vault (${res.status})`);
        const data = (await res.json()) as { items: DashboardItem[] };
        if (active) setItems(data.items);
      })
      .catch((e) => active && setError(String(e.message ?? e)));
    return () => {
      active = false;
    };
  }, []);

  const groups = items ? groupAndSortItems(items) : [];

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="text-sm text-slate-500">
            {items ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/import" className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100">
            Import CSV
          </Link>
          <Link href="/vault/new" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Add item
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!items && !error ? <p className="text-sm text-slate-500">Loading your vault…</p> : null}

      {items && items.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          Your vault is empty. <Link href="/import" className="text-blue-600 underline">Import a password export</Link> or add an item to get started.
        </div>
      ) : null}

      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</h2>
            <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
              {group.items.map((item) => {
                const gates = gatesCount(item.id, items!);
                return (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        {item.is_root_credential ? (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700" title="Root credential — many other accounts recover through this">
                            ROOT
                          </span>
                        ) : null}
                        {gates > 0 ? (
                          <span
                            className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700"
                            title={`Gates ${gates} reset${gates === 1 ? '' : 's'} — ${gates} account${gates === 1 ? '' : 's'} depend on this for recovery`}
                          >
                            gates {gates}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {item.service_name ?? item.type}
                        {item.url ? ` · ${item.url}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="w-10 text-right text-xs tabular-nums text-slate-500" title="Importance score">
                        {Math.round(item.importance_score * 100)}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CRITICALITY_STYLE[item.criticality ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                        {item.criticality ?? 'n/a'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
