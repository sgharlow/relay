'use client';

/**
 * The risk-graph reveal — J1's "aha".
 *
 * Renders BEFORE any price is shown (J1-R6). Names a specific dependency count
 * derived from the owner's own entries, so the pitch stops being a claim.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R6
 */

import { useEffect, useState } from 'react';

import { computeReveal, type Reveal } from '../../../../lib/vault/risk-graph';
import type { DashboardItem } from '../../../../lib/vault/dashboard-view';
import { emitFunnel, resolveChannel } from '../../../../lib/analytics/funnel';

export default function RevealCard({ onReady }: { onReady: () => void }) {
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch('/api/vault/items')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load your vault (${res.status})`);
        const data = (await res.json()) as { items: DashboardItem[] };
        if (!active) return;

        const computed = computeReveal(data.items ?? []);
        setReveal(computed);

        void emitFunnel('reveal_viewed', {
          channel: resolveChannel(window.location.search),
          gated: String(computed.gatedCount),
        });
        onReady();
      })
      .catch((e) => active && setError(String(e.message ?? e)));

    return () => {
      active = false;
    };
  }, [onReady]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!reveal) return <p className="text-sm text-slate-500">Working out what depends on what…</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
          What we found
        </p>
        <p className="mt-2 text-lg font-semibold leading-snug text-stone-900">
          {reveal.headline}
        </p>
      </div>

      {reveal.gatedTitles.length > 0 && (
        <div>
          <p className="text-sm text-slate-600">
            Locked behind{' '}
            <span className="font-medium text-slate-900">{reveal.rootTitle}</span>:
          </p>
          <ul className="mt-2 space-y-1">
            {reveal.gatedTitles.map((t: string) => (
              <li key={t} className="flex items-center gap-2 text-sm text-slate-700">
                <span aria-hidden className="text-slate-400">
                  └
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-slate-500">
        This is the part families get wrong. Not the passwords — the order they unlock in.
      </p>
    </div>
  );
}
