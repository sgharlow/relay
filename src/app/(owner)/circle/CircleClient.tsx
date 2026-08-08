'use client';

/**
 * Building the circle of trust — coverage matrix + proposed policies.
 *
 * Names the critical items nobody can reach, and offers a draft policy set the
 * owner approves in bulk rather than authoring 900 rows by hand
 * (J4-R2, J4-R5, J4-R13).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, J4-R5, J4-R13
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Proposal {
  recipientId: string;
  triggerType: string;
  scope: 'view' | 'act';
  reversible: boolean;
  predicate: Record<string, unknown>;
  rationale: string;
  itemCount: number;
}

interface CircleData {
  coverage: {
    uncoveredCritical: { id: string; title: string }[];
    byRecipient: Record<string, number>;
    circleComplete: boolean;
  };
  proposals: Proposal[];
  recipients: { id: string; name: string; role: string; email: string }[];
  verifiers: { id: string; name: string; email: string }[];
  policyCount: number;
  itemCount: number;
}

export default function CircleClient() {
  const [data, setData] = useState<CircleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/circle');
    if (!res.ok) {
      setError(`Could not load your circle (${res.status})`);
      return;
    }
    setData((await res.json()) as CircleData);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(p: Proposal, key: string) {
    setBusy(key);
    setError(null);

    const res = await fetch('/api/policies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient_id: p.recipientId,
        trigger_type: p.triggerType,
        scope: p.scope,
        predicate: p.predicate,
      }),
    });

    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? `Could not create that policy (${res.status})`);
      return;
    }

    await load();
  }

  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading your circle…</p>;

  const { coverage, proposals, recipients, verifiers } = data;
  const nameById = new Map(recipients.map((r) => [r.id, r.name]));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Your circle</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who can reach what, and under which conditions.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Circle-complete state, with its unmet condition named (J4-R13) */}
      <div
        className={`rounded-lg border p-4 ${
          coverage.circleComplete
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-300 bg-amber-50'
        }`}
      >
        {coverage.circleComplete ? (
          <p className="text-sm font-medium text-emerald-900">
            Every critical item has someone who can reach it.
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-amber-900">
              {coverage.uncoveredCritical.length} critical item
              {coverage.uncoveredCritical.length === 1 ? '' : 's'} nobody can reach
            </p>
            <ul className="mt-2 space-y-1">
              {coverage.uncoveredCritical.map((i) => (
                <li key={i.id} className="text-sm text-amber-900">
                  {i.title}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Proposals — the owner edits a draft (J4-R2) */}
      {proposals.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900">Suggested starting point</h2>
          <p className="mt-1 text-sm text-slate-500">
            Built from what the importance engine already knows. Accept what fits.
          </p>

          <ul className="mt-3 space-y-3">
            {proposals.map((p, idx) => {
              const key = `${p.recipientId}-${idx}`;
              return (
                <li key={key} className="rounded border border-slate-200 bg-white p-3">
                  <p className="text-sm text-slate-900">
                    <span className="font-medium">{nameById.get(p.recipientId) ?? 'Recipient'}</span>{' '}
                    gets <span className="font-medium">{p.scope}</span> access to{' '}
                    <span className="font-medium">{p.itemCount}</span> item
                    {p.itemCount === 1 ? '' : 's'} on an emergency trigger
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{p.rationale}</p>
                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() => accept(p, key)}
                    className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy === key ? 'Applying…' : 'Accept'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Coverage matrix */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900">Who holds what</h2>
        {recipients.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No recipients yet.{' '}
            <Link href="/recipients" className="text-blue-600 hover:underline">
              Designate someone
            </Link>
            .
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2">Person</th>
                <th className="pb-2">Role</th>
                <th className="pb-2 text-right">Items reachable</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-900">{r.name}</td>
                  <td className="py-2 text-slate-500">{r.role}</td>
                  <td className="py-2 text-right text-slate-900">
                    {coverage.byRecipient[r.id] ?? 0}
                    <span className="text-slate-400"> / {data.itemCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Verifiers</h2>
        <p className="mt-1 text-sm text-slate-500">
          {verifiers.length === 0
            ? 'None yet. Verifiers confirm a trigger is real — they never see your vault.'
            : `${verifiers.length} designated. They confirm a trigger is real and never see your vault.`}
        </p>
      </section>
    </div>
  );
}
