'use client';

/**
 * Recording that somebody is covered by paper only (§8.1, ruled 2026-08-12).
 *
 * §8.1 asked whether a break-glass-only contact is COVERED or a DOCUMENTED
 * EXCLUSION. The answer is exclusion, and it was already true in the code — what
 * was missing was the product saying it. Until now such a person showed a
 * permanent red light reading "has not accepted yet", which tells an owner to
 * chase somebody who is never coming.
 *
 * ⚠️ IT MUST NOT BECOME A MUTE BUTTON. The obvious failure is an owner marking
 * people until the nagging stops, ending up with a plan that cannot run and
 * nothing saying so. The route re-runs readiness and returns the consequence,
 * and this shows it immediately — so the arithmetic gets louder, not quieter,
 * at exactly the moment somebody is excluded.
 *
 * Offered only for a contact who has not claimed. Somebody with an account
 * demonstrably can hold one, so the marker would be recording a falsehood.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { useState } from 'react';

export default function PaperOnlyControl({
  personId,
  personType,
  name,
  marked,
  onChanged,
}: {
  personId: string;
  personType: 'recipient' | 'verifier';
  name: string;
  marked: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consequence, setConsequence] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function set(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(personId)}/break-glass-only`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personType, value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        blocker?: { message: string } | null;
      };
      if (!res.ok) {
        setError(body.message ?? 'That did not go through.');
        return;
      }
      // The whole point: say what the exclusion did to the plan, now.
      setConsequence(body.blocker?.message ?? null);
      setAsking(false);
      await onChanged();
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const link: React.CSSProperties = {
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'var(--ink-muted)',
    fontSize: 'var(--t1)',
    textDecoration: 'underline',
    cursor: 'pointer',
  };

  if (marked) {
    return (
      <div style={{ marginTop: '4px' }}>
        <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
          Covered by an emergency code only — {name} will not count towards your plan, by your
          choice.{' '}
          <button type="button" onClick={() => set(false)} disabled={busy} style={link}>
            {busy ? 'Working…' : 'Undo'}
          </button>
        </div>
        {consequence ? (
          <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '4px' }}>
            {consequence}
          </p>
        ) : null}
      </div>
    );
  }

  if (!asking) {
    return (
      <div style={{ marginTop: '4px' }}>
        <button type="button" onClick={() => setAsking(true)} style={link}>
          {name} cannot use an account
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 'var(--s2)',
        padding: 'var(--s3)',
        borderRadius: 'var(--radius-owner)',
        background: 'var(--paper-sunken)',
        border: '1px solid var(--rule)',
      }}
    >
      <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', lineHeight: 1.5 }}>
        Some people will not set up an account, and that is fine — they can still be reached with an
        emergency code you give them on paper. Recording it here stops us asking you to chase them.
      </p>
      <p style={{ fontSize: 'var(--t1)', lineHeight: 1.5, marginTop: '6px' }}>
        <strong>They will not count towards the confirmations a release needs.</strong> If that
        leaves your plan short, we will tell you straight away.
      </p>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => set(true)}
          style={{
            minHeight: 32,
            padding: '0 var(--s3)',
            borderRadius: 'var(--radius-owner)',
            border: '1px solid var(--rule-strong)',
            background: 'transparent',
            fontSize: 'var(--t1)',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Working…' : 'Yes, paper only'}
        </button>
        <button type="button" onClick={() => setAsking(false)} style={link}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '6px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
