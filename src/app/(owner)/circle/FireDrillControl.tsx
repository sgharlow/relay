'use client';

/**
 * Rehearsing, on a day when nothing is wrong.
 *
 * WHY AN OWNER WOULD EVER PRESS THIS. Every other reachability signal Relay has
 * is a machine's claim about a machine, and this project has measured all of
 * them failing quietly: Outlook files us as junk at SCL 5 with flawless
 * authentication, Resend answers 200 for an address it has permanently muted,
 * and `email.delivered` arrives for a message nobody will ever see. The first
 * time a family finds out is otherwise the worst day.
 *
 * A rehearsal converts that from unknowable into a date on a screen.
 *
 * ⚠️ THE ANSWER THAT MATTERS IS THE ONE THAT DOES NOT COME. The button is
 * deliberately undramatic and the result copy leads with who could NOT be
 * mailed, because that is the finding — a verifier who cannot answer a drill
 * cannot answer a release either.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { useState } from 'react';

interface DrillResult {
  sent: { id: string; name: string }[];
  cannotAnswer: { id: string; name: string }[];
}

export default function FireDrillControl({ onRun }: { onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/fire-drill', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as Partial<DrillResult> & {
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? 'Could not run a practice run just now.');
        return;
      }
      setResult({ sent: body.sent ?? [], cannotAnswer: body.cannotAnswer ?? [] });
      await onRun();
    } catch {
      setError('Could not run a practice run just now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          minHeight: 36,
          padding: '0 var(--s3)',
          borderRadius: 'var(--radius-owner)',
          border: '1px solid var(--rule-strong)',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 'var(--t1)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Sending…' : 'Run a practice run'}
      </button>
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '6px' }}>
        Sends everyone who would be asked a message saying it is practice, and asks them to press
        one button. Whoever does not answer is the thing worth knowing now rather than later.
      </div>

      {result ? (
        <div style={{ marginTop: 'var(--s2)', fontSize: 'var(--t1)' }}>
          <div style={{ color: 'var(--ink-muted)' }}>
            {result.sent.length === 0
              ? 'Nobody was sent a practice run.'
              : `Sent to ${result.sent.map((p) => p.name).join(', ')}. Their answers will show on each row.`}
          </div>
          {result.cannotAnswer.length > 0 ? (
            <div style={{ color: 'var(--ochre-text)', marginTop: '4px' }}>
              {result.cannotAnswer.map((p) => p.name).join(', ')} could not be sent one, because
              they cannot sign in to answer it. That is not a fault in the practice run — it means
              they could not answer a real one either. Finish setting them up, or ask them to add a
              passkey.
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '4px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
