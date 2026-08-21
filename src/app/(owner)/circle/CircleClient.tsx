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
import AddPersonForm from './AddPersonForm';

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
  recipients: {
    id: string;
    name: string;
    role: string;
    email: string;
    standby_state?: string;
    break_glass_only?: boolean | null;
  }[];
  verifiers: {
    id: string;
    name: string;
    email: string;
    standby_state?: string;
    break_glass_only?: boolean | null;
  }[];
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

  /**
   * Anyone still named but not verified — i.e. somebody the owner is genuinely
   * waiting on.
   *
   * `revoked` is excluded because the owner removed them on purpose.
   *
   * 🔴 `break_glass_only` IS EXCLUDED TOO, added 2026-08-12 after looking at a
   * circle containing one. §8.1's ruling is explicit that the product must not
   * "let a red light imply 'not yet' when the truth is 'not ever, on this
   * device'" — and this counted such a person as unverified and told the owner
   * to go and check it was really them. The per-person line directly beneath
   * said the opposite ("will not count towards your plan, by your choice"), so
   * the screen argued with itself about somebody the owner had already ruled on.
   */
  const unverified = [...recipients, ...verifiers].filter(
    (p) =>
      p.standby_state !== 'confirmed' &&
      p.standby_state !== 'revoked' &&
      !p.break_glass_only,
  ).length;

  return (
    <div className="space-y-8">
      <header>
        <h1 style={{ fontSize: 'var(--t7)', fontWeight: 600, letterSpacing: '-0.02em' }}>People</h1>
        {/*
          Naming and verifying were previously blurred by this very sentence:
          "who confirms it is real" meant a verifier attesting to an emergency,
          and an owner could easily read it as the checking THEY have to do.
          Since quorum tightened, that difference decides whether a plan works,
          so the two steps are now stated as two steps.
        */}
        <p style={{ fontSize: 'var(--t3)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
          Who would step in, who would be asked whether an emergency is real, and what each of them
          could reach.
        </p>
        <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s2)' }}>
          <strong style={{ color: 'var(--ink)' }}>Naming someone is the first half.</strong> Once
          they accept, call them and check the phrase matches — until you do, their answer would not
          count towards opening anything.
        </p>
      </header>

      {error && <p className="text-t2 text-clay">{error}</p>}

      {/*
        Circle-complete state, with its unmet condition named (J4-R13).

        🔴 THE COLOUR KEYS ON THE MESSAGE, NOT ON COVERAGE ALONE. Found by
        looking at the rendered page on 2026-08-12: when the unverified warning
        was added inside this container, the container still styled itself on
        `circleComplete` — so "2 of them have not been verified yet" was painted
        in the SUCCESS colour. That is the false-green defect again, this time in
        the palette rather than the words, and no amount of DOM measurement would
        have found it.
      */}
      <div
        className={`rounded-lg border p-4 ${
          coverage.circleComplete && unverified === 0
            ? 'border-sage bg-sage-soft'
            : 'border-ochre bg-ochre-soft'
        }`}
      >
        {coverage.circleComplete && unverified === 0 ? (
          <p className="text-t2 font-medium text-sage-text">
            Every critical item has someone who can reach it.
          </p>
        ) : coverage.circleComplete ? (
          /*
            A FALSE GREEN, CLOSED 2026-08-12. "Every critical item has someone
            who can reach it" was a statement about COVERAGE — items joined to
            recipients — and it stayed green while nobody named could actually
            act. Since quorum tightened to `confirmed`, an unverified person's
            answer does not count, so this sentence could be true and the plan
            still open nothing.

            This is the screen where an owner decides they are finished, so it
            is the worst possible place to say "done" when the answer is "named,
            not yet checked".
          */
          <>
            <p className="text-t2 font-medium text-ochre-text">
              Everyone is named — but {unverified} of them{' '}
              {unverified === 1 ? 'has' : 'have'} not been verified yet.
            </p>
            {/*
              🔴 THIS SAID "and nothing would open", which was FALSE whenever a
              plan already had enough verified people — and it appeared directly
              under a sage banner saying the plan works. Two boxes on one screen,
              flatly contradicting each other, on the screen where an owner
              decides whether they are finished.

              Whether the plan can run is the readiness banner's verdict and it
              owns it; this box says only what is true of the unverified people
              themselves. A screen with two sources of truth about the same
              question will eventually disagree, and this one did.
            */}
            <p className="mt-1 text-t2 text-ochre-text">
              Until you check it is really them, their answer would not count towards opening
              anything. It is a two-minute call each.
            </p>
          </>
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
          <h2 className="text-t5 font-semibold text-ink">Suggested starting point</h2>
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
        <h2 className="text-t5 font-semibold text-ink">Who holds what</h2>
        {recipients.length === 0 ? (
          <p style={{ marginTop: 'var(--s2)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody named yet — add the first person below.
          </p>
        ) : (
          // Wrapped so it can scroll: the root hides horizontal overflow, so a
          // table wider than the viewport loses its right-hand columns with no
          // way to reach them. Here that column is "items reachable" — the
          // number that says whether naming this person actually did anything.
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Who is in the circle, and what each person can reach"
          >
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
          </div>
        )}
      </section>

      {/*
        Management sits beneath the assessment on purpose. The coverage matrix
        above names the gap; these are where you close it, on the same screen,
        without having to know that "recipients" and "circle" were once
        different pages.

        🔴 AND ADDING SOMEBODY IS ONE FORM, ABOVE BOTH — 2026-08-21, J4-R1. The
        two sections below each carried their own add form, so a spouse who
        would both step in and confirm an emergency was entered twice and became
        two rows, two invitations and two claim codes for one human — the exact
        failure J4-R1 names, on a screen whose own data layer opens with "One
        people list; roles are attributes".

        It sits HERE rather than inside either section because it belongs to
        neither: a person wearing both hats has no natural section to be added
        from, and filing the single entry under one of the two headings would
        restate the same wrong idea about the model.
      */}
      <AddPersonForm onAdded={load} />

      <RecipientSection items={recipients} onChange={load} reachByRecipient={coverage.byRecipient} />
      <VerifierSection items={verifiers} onChange={load} />
    </div>
  );
}
