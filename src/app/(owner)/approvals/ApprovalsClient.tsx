'use client';

/**
 * The parent's approval queue.
 *
 * This screen is read by the OWNER — frequently elderly, frequently on a phone,
 * frequently being handed the device by the person whose request they are
 * approving. CC8 applies here without exception: 18px minimum, high contrast,
 * no time pressure, plain language (J3-R9).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J3-R9, J3-R10
 */

import { useCallback, useEffect, useState } from 'react';

import HelperSection, { type Delegation, type Candidate } from './HelperSection';

interface Approval {
  id: string;
  kind: 'recipient' | 'policy' | 'self_designation';
  payload: Record<string, unknown>;
  proposed_by_delegation_id: string | null;
}

interface Warning {
  email: string;
  message: string;
  remedy: string;
}

const PLAIN: Record<Approval['kind'], (p: Record<string, unknown>) => string> = {
  self_designation: (p) =>
    `${String(p.name ?? 'Your helper')} is asking to be added as someone who would receive access.`,
  recipient: (p) => `Your helper suggests adding ${String(p.name ?? 'someone')} as a recipient.`,
  policy: () => 'Your helper suggests a change to who can reach which items.',
};

export default function ApprovalsClient() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);
  const [decideFailed, setDecideFailed] = useState<string | null>(null);

  /*
    🔴 THIS SCREEN COULD WEDGE ON "Loading…" FOREVER. A failed /api/approvals
    left `approvals` null — the permanent spinner — and a throw inside
    Promise.all was an unhandled rejection. Same class as ChallengeClient, same
    day, same fix: failures are told apart from emptiness, and every path
    settles.
  */
  const load = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([fetch('/api/approvals'), fetch('/api/delegations')]);
      if (!a.ok) throw new Error(String(a.status));
      setApprovals((await a.json()).approvals as Approval[]);
      setLoadFailed(false);
      if (d.ok) {
        const body = (await d.json()) as {
          concentrationWarning?: Warning | null;
          delegations?: Delegation[];
          candidates?: Candidate[];
        };
        setWarning(body.concentrationWarning ?? null);
        setDelegations(body.delegations ?? []);
        setCandidates(body.candidates ?? []);
      }
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    decide() had no res.ok check and no catch: a failed decision looked like a
    decided one (the reload simply re-listed it, unexplained), and a network
    throw wedged `busy`. finally settles busy on every path; a failure says so.
  */
  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    setDecideFailed(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch {
      setDecideFailed(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 text-[18px] leading-relaxed text-ink">
      <header>
        <h1 className="text-t7 font-semibold tracking-tight">Things waiting for you</h1>
        <p className="mt-2 text-ink">
          Your helper can add and organise information. Anything that changes{' '}
          <strong>who can reach it</strong> waits for you.
        </p>
      </header>

      {/* The elder-abuse signature, surfaced to the OWNER (J3-R10) */}
      {/*
        Ochre, not clay. Clay is reserved for what cannot be undone (the
        palette's own rule: "PERMANENT ONLY... Never anything else"), and this
        warning asks for a second look at something entirely reversible.
        Painting an advisory in the irreversible colour teaches the reader that
        clay sometimes just means "important" — which is exactly what must not
        happen on the one screen where it will one day mean "permanent".
      */}
      {warning && (
        <div className="rounded-lg border-2 border-ochre bg-ochre-soft p-4">
          <p className="font-semibold text-ochre-text">Worth a second look</p>
          <p className="mt-2 text-ochre-text">{warning.message}</p>
          <p className="mt-2 text-ochre-text">{warning.remedy}</p>
        </div>
      )}

      {loadFailed && (
        <div className="rounded-lg border border-ochre bg-ochre-soft p-4 text-ochre-text">
          <p className="font-semibold">We could not load this just now.</p>
          <p className="mt-1 text-[16px]">
            That is a loading problem, not an empty queue.{' '}
            <button type="button" onClick={() => void load()} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        </div>
      )}

      {decideFailed && (
        <p className="rounded border border-ochre bg-ochre-soft px-4 py-3 text-[16px] text-ochre-text">
          Your decision did not go through — nothing was recorded either way. Please try again.
        </p>
      )}

      {!loadFailed && approvals === null && <p className="text-muted">Loading…</p>}

      {approvals?.length === 0 && (
        <p className="rounded-lg border border-rule-strong bg-paper-raised p-4 text-ink">
          Nothing is waiting. There is no rush and nothing expires.
        </p>
      )}

      {approvals?.map((a) => (
        <div key={a.id} className="rounded-lg border border-rule-strong bg-paper-raised p-5">
          <p>{PLAIN[a.kind](a.payload)}</p>

          {a.kind === 'self_designation' && (
            <p className="mt-3 text-ink">
              That would mean they could open your information if something happened to you.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={busy === a.id}
              onClick={() => decide(a.id, 'approve')}
              className="rounded bg-ink px-5 py-3 font-medium text-paper hover:bg-ink disabled:opacity-50"
            >
              Yes, that&rsquo;s fine
            </button>
            <button
              type="button"
              disabled={busy === a.id}
              onClick={() => decide(a.id, 'reject')}
              className="rounded border-2 border-rule-strong px-5 py-3 font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
            >
              No, not this
            </button>
          </div>

          <p className="mt-3 text-[16px] text-muted">
            Saying no changes nothing else. You can decide later.
          </p>
        </div>
      ))}

      {/*
        Below the queue on purpose. The approvals above are things asked of the
        owner RIGHT NOW; choosing a helper is setup, and setup must not compete
        with a decision somebody is waiting on.
      */}
      <HelperSection delegations={delegations} candidates={candidates} onChange={load} />
    </div>
  );
}
