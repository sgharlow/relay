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
import { cardPadded, errorText, muted } from '../_lib/ui';

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

  if (error) return <p style={errorText}>{error}</p>;
  if (!reveal) return <p style={muted}>Working out what depends on what…</p>;

  return (
    <div className="space-y-4">
      <div style={{ ...cardPadded, borderColor: 'var(--ochre)', background: 'var(--ochre-soft)' }}>
        <p style={{ fontSize: 'var(--t1)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ochre-text)' }}>
          What we found
        </p>
        <p style={{ fontSize: 'var(--t5)', fontWeight: 600, lineHeight: 1.35, marginTop: 'var(--s2)' }}>
          {reveal.headline}
        </p>
      </div>

      {reveal.gatedTitles.length > 0 && (
        <div>
          <p style={{ fontSize: 'var(--t3)', color: 'var(--ink-muted)' }}>
            Locked behind{' '}
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{reveal.rootTitle}</span>:
          </p>
          <ul className="mt-2 space-y-1">
            {reveal.gatedTitles.map((t: string) => (
              <li key={t} className="flex items-center" style={{ gap: 'var(--s2)', fontSize: 'var(--t3)' }}>
                <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
                  └
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p style={muted}>
        This is the part families get wrong. Not the passwords — the order they unlock in.
      </p>
    </div>
  );
}
