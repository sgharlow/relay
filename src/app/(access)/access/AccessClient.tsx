'use client';

/**
 * Recipient access dashboard (Requirement 7 / task 22.2).
 *
 * Reads the scoped recipient token from `?token=`, loads GET /api/access, and:
 *  - invalid/expired token → a calm error message,
 *  - not RELEASED → pending view (limited fields, "Access not yet active"),
 *  - RELEASED → a numbered step plan grouped by time-horizon bucket. Clicking an
 *    item POSTs to /api/access/[id]/decrypt and decrypts in-browser via
 *    CryptoService; the revealed value lives only in component state (cleared on
 *    navigate).
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { bucketFor, BUCKET_ORDER, BUCKET_LABELS, type Bucket } from '../../../../lib/ai/buckets';
import { CryptoService, base64ToBytes, unpackIvCiphertext } from '../../../../lib/crypto/crypto-service';

interface AccessItem {
  id: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  type: string;
  scope?: string;
  is_root_credential?: boolean;
  importance_score?: number;
}
interface Dashboard {
  state: string;
  released: boolean;
  items: AccessItem[];
}

export default function AccessClient() {
  const token = useSearchParams().get('token') ?? '';
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) {
      setError('This access link is missing its token.');
      return;
    }
    fetch(`/api/access?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 403) throw new Error('This access link is invalid or has expired.');
        if (!res.ok) throw new Error('Unable to load your access right now.');
        setData((await res.json()) as Dashboard);
      })
      .catch((e) => setError(String(e.message)));
  }, [token]);

  const decrypt = useCallback(
    async (item: AccessItem) => {
      try {
        const res = await fetch(`/api/access/${item.id}/decrypt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error('denied');
        const { plaintext_data_key, ciphertext } = (await res.json()) as { plaintext_data_key: string; ciphertext: string };
        const { iv, ciphertext: ct } = unpackIvCiphertext(base64ToBytes(ciphertext));
        const value = await new CryptoService().decryptItem(ct, iv, plaintext_data_key);
        setRevealed((r) => ({ ...r, [item.id]: value }));
      } catch {
        setRevealed((r) => ({ ...r, [item.id]: '⚠️ Could not decrypt (the item may be demo/seed data).' }));
      }
    },
    [token],
  );

  if (error) {
    return <p className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-stone-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-stone-500">Loading your access…</p>;
  }

  if (!data.released) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Access not yet active</h1>
        <p className="mt-2 text-stone-600">
          You have access to the items below, but the release is still pending. You can see what is
          covered, but not the contents yet.
        </p>
        <ul className="mt-6 space-y-3">
          {data.items.map((item) => (
            <li key={item.id} className="rounded-lg border border-stone-200 px-5 py-3">
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-stone-500">
                {item.service_name ?? item.type}
                {item.url ? ` · ${item.url}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // RELEASED — group into time-horizon buckets, number steps across the plan.
  const grouped: Record<Bucket, AccessItem[]> = { do_today: [], this_week: [], within_30_days: [] };
  for (const item of data.items) {
    grouped[bucketFor({ importance_score: item.importance_score ?? 0, is_root_credential: !!item.is_root_credential })].push(item);
  }
  let step = 0;

  return (
    <div>
      <h1 className="text-2xl font-bold">Your access plan</h1>
      <p className="mt-2 text-stone-600">Work top to bottom — the most consequential items come first.</p>

      <div className="mt-8 space-y-8">
        {BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((bucket) => (
          <section key={bucket}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-amber-700">{BUCKET_LABELS[bucket]}</h2>
            <ol className="space-y-3">
              {grouped[bucket].map((item) => {
                step += 1;
                const value = revealed[item.id];
                return (
                  <li key={item.id} className="rounded-lg border border-stone-200 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">
                            {step}
                          </span>
                          <span className="font-semibold">{item.title}</span>
                          {item.scope ? (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{item.scope}</span>
                          ) : null}
                        </div>
                        <div className="ml-8 text-sm text-stone-500">{item.service_name ?? item.type}</div>
                      </div>
                      <button
                        onClick={() => decrypt(item)}
                        className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                      >
                        Reveal
                      </button>
                    </div>
                    {value !== undefined ? (
                      <pre className="ml-8 mt-3 whitespace-pre-wrap break-all rounded bg-stone-900 px-3 py-2 text-sm text-amber-100">{value}</pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
