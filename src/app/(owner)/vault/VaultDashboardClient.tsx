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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { gatesCount, type DashboardItem } from '../../../../lib/vault/dashboard-view';
import { rankItems, reasonFor } from '../../../../lib/vault/reason';
import { buttonPrimary, buttonQuiet, card, errorText, h1, meta, muted } from '../_lib/ui';
import { ItemControls } from './ItemControls';

export default function VaultDashboardPage() {
  const [items, setItems] = useState<DashboardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extracted so ItemControls can re-read after an update or a removal — the
  // ranking is derived from the items, so a changed vault has to re-rank rather
  // than patch a row in place.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/items');
      if (!res.ok) throw new Error(`Failed to load vault (${res.status})`);
      const data = (await res.json()) as { items: DashboardItem[] };
      setItems(data.items);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ranked = items ? rankItems(items) : [];

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between" style={{ gap: 'var(--s4)' }}>
        <div>
          <h1 style={h1}>Vault</h1>
          {/*
            Was "3 items", which tells you a count and nothing else. The order is
            the insight now, so the subtitle says what the order means.
          */}
          <p style={{ ...muted, marginTop: 'var(--s1)' }}>
            {items
              ? `${items.length} item${items.length === 1 ? '' : 's'} · most consequential first`
              : 'Loading…'}
          </p>
        </div>
        <div className="flex" style={{ gap: 'var(--s2)' }}>
          <Link href="/import" style={{ ...buttonQuiet, display: 'inline-flex', alignItems: 'center' }}>
            Import CSV
          </Link>
          <Link href="/vault/new" style={{ ...buttonPrimary, display: 'inline-flex', alignItems: 'center' }}>
            Add item
          </Link>
        </div>
      </header>

      {error ? <p style={errorText}>{error}</p> : null}

      {!items && !error ? <p style={muted}>Loading your vault…</p> : null}

      {items && items.length === 0 ? (
        <div style={{ ...card, borderStyle: 'dashed', padding: 'var(--s12) var(--s6)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--t3)' }}>Nothing here yet.</p>
          <p style={{ ...muted, marginTop: 'var(--s2)' }}>
            The fastest start is a password-manager export —{' '}
            <Link href="/import" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
              import one
            </Link>
            , or add the first account by hand.
          </p>
        </div>
      ) : null}

      {ranked.length > 0 ? (
        <ul style={{ ...card, listStyle: 'none', padding: 0, margin: 0 }}>
          {ranked.map((item, i) => {
            const gates = gatesCount(item.id, items!);
            const reason = reasonFor(item, gates);
            return (
              <li
                key={item.id}
                className="flex items-baseline"
                style={{
                  gap: 'var(--s4)',
                  padding: 'var(--s3) var(--s4)',
                  borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                }}
              >
                {/* The score, as the only thing a score is good for: an order. */}
                <span style={{ ...meta, width: '1.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--t3)', fontWeight: 500 }}>{item.title}</div>
                  {/*
                    The dependency edge, in words. This is the same field that
                    used to render as an unexplained number in a column with no
                    header.
                  */}
                  {reason ? (
                    <div style={{ ...muted, marginTop: '2px' }}>{reason}</div>
                  ) : (
                    <div style={{ ...meta, marginTop: '2px' }}>
                      {item.service_name ?? item.type}
                      {item.url ? ` · ${item.url}` : ''}
                    </div>
                  )}
                  {/*
                    🔴 THE ROW HAD NO CONTROLS AT ALL until 2026-08-13, so a
                    saved item could never be corrected or removed — see
                    ItemControls. Kept quiet and inline rather than given a
                    detail page: the common act is replacing one value on a
                    rotated password, and a whole screen for that invites the
                    owner to hunt for it.
                  */}
                  <div style={{ marginTop: 'var(--s1)' }}>
                    <ItemControls item={item} onChanged={load} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/*
        A preparedness product that never tells you what to do next is asking
        you to work it out. The readiness banner names what is missing; this
        names the single next move.
      */}
      {ranked.length > 0 ? (
        <p style={{ ...muted, marginTop: 'var(--s6)' }}>
          Next:{' '}
          <Link href="/circle" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
            name who could reach these
          </Link>{' '}
          — a vault nobody can open is a vault that does nothing.
        </p>
      ) : null}
    </div>
  );
}
