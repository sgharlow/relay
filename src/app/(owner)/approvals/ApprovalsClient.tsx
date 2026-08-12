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

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([fetch('/api/approvals'), fetch('/api/delegations')]);
    if (a.ok) setApprovals((await a.json()).approvals as Approval[]);
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    await fetch(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(null);
    await load();
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
      {warning && (
        <div className="rounded-lg border-2 border-clay bg-clay-soft p-4">
          <p className="font-semibold text-clay">Worth a second look</p>
          <p className="mt-2 text-clay">{warning.message}</p>
          <p className="mt-2 text-clay">{warning.remedy}</p>
        </div>
      )}

      {approvals === null && <p className="text-muted">Loading…</p>}

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
