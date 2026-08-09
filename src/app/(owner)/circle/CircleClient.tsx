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

import { RecipientSection, VerifierSection } from './PeopleSections';

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

  if (error && !data) return <p className="text-t2 text-clay">{error}</p>;
  if (!data) return <p className="text-t2 text-muted">Loading your circle…</p>;

  const { coverage, proposals, recipients, verifiers } = data;
  const nameById = new Map(recipients.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-8">
      <header>
        <h1 style={{ fontSize: 'var(--t7)', fontWeight: 600, letterSpacing: '-0.02em' }}>People</h1>
        <p style={{ fontSize: 'var(--t3)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
          Who would step in, who confirms it is real, and what each of them could reach.
        </p>
      </header>

      {error && <p className="text-t2 text-clay">{error}</p>}

      {/* Circle-complete state, with its unmet condition named (J4-R13) */}
      <div
        className={`rounded-lg border p-4 ${
          coverage.circleComplete
            ? 'border-sage bg-sage-soft'
            : 'border-ochre bg-ochre-soft'
        }`}
      >
        {coverage.circleComplete ? (
          <p className="text-t2 font-medium text-sage-text">
            Every critical item has someone who can reach it.
          </p>
        ) : (
          <>
            <p className="text-t2 font-medium text-ochre-text">
              {coverage.uncoveredCritical.length} critical item
              {coverage.uncoveredCritical.length === 1 ? '' : 's'} nobody can reach
            </p>
            <ul className="mt-2 space-y-1">
              {coverage.uncoveredCritical.map((i) => (
                <li key={i.id} className="text-t2 text-ochre-text">
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
          <h2 className="text-t2 font-semibold text-ink">Suggested starting point</h2>
          <p className="mt-1 text-t2 text-muted">
            Built from what the importance engine already knows. Accept what fits.
          </p>

          <ul className="mt-3 space-y-3">
            {proposals.map((p, idx) => {
              const key = `${p.recipientId}-${idx}`;
              return (
                <li key={key} className="rounded border border-rule bg-paper-raised p-3">
                  <p className="text-t2 text-ink">
                    <span className="font-medium">{nameById.get(p.recipientId) ?? 'Recipient'}</span>{' '}
                    gets <span className="font-medium">{p.scope}</span> access to{' '}
                    <span className="font-medium">{p.itemCount}</span> item
                    {p.itemCount === 1 ? '' : 's'} on an emergency trigger
                  </p>
                  <p className="mt-1 text-t1 text-muted">{p.rationale}</p>
                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() => accept(p, key)}
                    className="mt-2 rounded bg-ink px-3 py-1.5 text-t1 font-medium text-paper hover:bg-ink disabled:opacity-50"
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
        <h2 className="text-t2 font-semibold text-ink">Who holds what</h2>
        {recipients.length === 0 ? (
          <p style={{ marginTop: 'var(--s2)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody named yet — add the first person below.
          </p>
        ) : (
          <table className="mt-3 w-full text-t2">
            <thead>
              <tr className="border-b border-rule text-left text-t1 uppercase tracking-wide text-muted">
                <th className="pb-2">Person</th>
                <th className="pb-2">Role</th>
                <th className="pb-2 text-right">Items reachable</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-rule">
                  <td className="py-2 text-ink">{r.name}</td>
                  <td className="py-2 text-muted">{r.role}</td>
                  <td className="py-2 text-right text-ink">
                    {coverage.byRecipient[r.id] ?? 0}
                    <span className="text-muted"> / {data.itemCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/*
        Management sits beneath the assessment on purpose. The coverage matrix
        above names the gap; these are where you close it, on the same screen,
        without having to know that "recipients" and "circle" were once
        different pages.
      */}
      <RecipientSection items={recipients} onChange={load} />
      <VerifierSection items={verifiers} onChange={load} />
    </div>
  );
}
