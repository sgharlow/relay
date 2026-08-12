'use client';

/**
 * Add a passkey — stage two of the two-stage claim ([A1]).
 *
 * Stage one bound a device and is enough to be reachable today. This is what
 * lets someone come back on a NEW device without the owner reissuing anything,
 * and it is the only thing standing between a lost phone and a break-glass code.
 *
 * Deferrable by design: nothing in the claim flow blocks on it, because the
 * architecture's whole bet is claim conversion and the first thing a contact
 * meets must not be a security ceremony.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

export default function PasskeySection() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const optRes = await fetch('/api/webauthn/register/options', { method: 'POST' });
      if (!optRes.ok) throw new Error('unavailable');
      const { options, challengeToken } = await optRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attestation, challengeToken }),
      });

      if (!verifyRes.ok) {
        const j = await verifyRes.json().catch(() => ({}));
        setError(j.message ?? 'That passkey could not be saved.');
        return;
      }
      setDone(true);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      // Cancelling is a decision, not a failure.
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Your device could not complete that.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-rule bg-paper-raised p-5">
      <h2 className="text-t5 font-semibold text-ink">Passkey</h2>
      <p className="mt-1 text-t2 text-muted">
        Sign in with your face, fingerprint or device PIN — no code to find, and nothing we could
        email you that a stranger could imitate. Adding one also means a new phone does not lock you
        out.
      </p>

      {done ? (
        <p className="mt-3 text-t2 text-ink">Passkey added. You can use it to sign in.</p>
      ) : (
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="mt-3 min-h-[44px] rounded border border-ink bg-ink px-4 text-t2 font-semibold text-paper disabled:opacity-60"
        >
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-t2 text-clay">
          {error}
        </p>
      ) : null}
    </section>
  );
}
