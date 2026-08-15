'use client';

/**
 * "I got this" — one button, and the only honest reachability evidence Relay has.
 *
 * WHY THIS BUTTON EXISTS AT ALL. Everything else the product knows about whether
 * a person can be reached is a machine's claim about a machine: `email.delivered`
 * describes a provider's queue, and both messages in the 2026-08-14 Outlook test
 * recorded it while sitting in a junk folder; Resend answers 200 with a message
 * id for an address it has permanently muted. None of it involves a human. This
 * does, and that is the whole design.
 *
 * WHICH IS WHY IT CANNOT BE A LINK. An acknowledgement recorded by following a
 * URL would be forgeable by anybody holding it, and a mail scanner that
 * prefetched the link would happily record a pass on the recipient's behalf —
 * a false green built to look like the cure for false greens. It is a POST from
 * a signed-in session, and `/api/fire-drill/ack` accepts nothing else.
 *
 * Shown only when somebody is actually waiting to hear it, so an ordinary visit
 * to this page never manufactures the evidence.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { useState } from 'react';

export default function DrillCard({ onAcknowledged }: { onAcknowledged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/fire-drill/ack', { method: 'POST' });
      if (!res.ok) {
        setError('That did not go through. Try once more.');
        return;
      }
      setDone(true);
      onAcknowledged();
    } catch {
      setError('That did not go through. Try once more.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section
        style={{
          marginTop: 32,
          padding: 20,
          borderRadius: 12,
          border: '1px solid var(--rule)',
          background: 'var(--paper-sunken)',
        }}
      >
        <p style={{ margin: 0, fontSize: 18 }}>
          Thank you — they know you can be reached. Nothing else is needed.
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        marginTop: 32,
        padding: 20,
        borderRadius: 12,
        border: '1px solid var(--rule-strong)',
        background: 'var(--paper-sunken)',
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>This is only practice</h2>
      <p style={{ margin: '0 0 16px', fontSize: 18, lineHeight: 1.5 }}>
        Nothing has happened and nothing is wrong. Someone who named you wants to check that a
        message would actually reach you if it ever mattered. Press the button and you are done.
      </p>
      <button
        type="button"
        onClick={acknowledge}
        disabled={busy}
        style={{
          minHeight: 48,
          padding: '0 24px',
          fontSize: 18,
          fontWeight: 600,
          borderRadius: 10,
          border: 'none',
          background: 'var(--ink)',
          color: 'var(--paper)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Sending…' : 'I got this'}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 12, fontSize: 16, color: 'var(--clay)' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
