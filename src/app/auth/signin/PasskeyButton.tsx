'use client';

/**
 * Sign in with a passkey.
 *
 * This is the path a standby contact takes to come back — on a new phone, years
 * after they claimed, with nothing to remember and nothing to find. They type no
 * identifier at all: the credentials are discoverable, so the browser offers the
 * right passkey and the person just approves it.
 *
 * It sits ABOVE the email + code form deliberately. The form is owner-grade
 * friction, correct for someone protecting a vault and wrong for a contact who
 * may act once in five years.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { startAuthentication } from '@simplewebauthn/browser';

// `/continue` rather than a hardcoded page: a passkey signs in owners, standby
// contacts, and people who are both, and sending them all to the same place was
// wrong for at least two of the three. It resolves who they are and forwards.
export default function PasskeyButton({ callbackUrl = '/continue' }: { callbackUrl?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const optRes = await fetch('/api/webauthn/authenticate/options', { method: 'POST' });
      if (!optRes.ok) throw new Error('unavailable');
      const { options, challengeToken } = await optRes.json();

      // Throws if the person cancels the OS prompt — which is not an error worth
      // shouting about, so it is handled quietly below.
      const assertion = await startAuthentication({ optionsJSON: options });

      const res = await signIn('passkey', {
        response: JSON.stringify(assertion),
        challengeToken,
        redirect: false,
        callbackUrl,
      });

      if (res?.error) {
        setError('That passkey was not recognised.');
        return;
      }
      window.location.href = callbackUrl;
    } catch (err) {
      // A cancelled prompt reads as an abort. Saying nothing is the right
      // response to someone who changed their mind.
      const name = (err as { name?: string })?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Your device could not complete that. Try your email and code below.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 'var(--s4, 20px)' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          width: '100%',
          minHeight: 52,
          fontSize: 'var(--t3)',
          fontWeight: 600,
          borderRadius: 6,
          border: '1px solid var(--ink, #111)',
          background: 'var(--ink, #111)',
          color: 'var(--paper, #fff)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </button>

      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 'var(--t2)', color: 'var(--clay, #a33)' }}>
          {error}
        </p>
      ) : null}

      <p style={{ marginTop: 10, fontSize: 'var(--t2)', color: 'var(--ink-muted, #666)' }}>
        Nothing to type. If you were given standby access, your device already knows who you are.
      </p>
    </div>
  );
}
