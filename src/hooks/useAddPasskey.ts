'use client';

/**
 * The add-a-passkey ceremony, in one place.
 *
 * Two surfaces need it and they look nothing alike: the owner account page
 * (dense, blue, 16px) and the standby dashboard (warm, 18px, minimal chrome).
 * What they must NOT differ on is the error taxonomy, which is the part that is
 * easy to get wrong and was wrong: a device that already holds a passkey throws
 * `InvalidStateError`, and the account page reported that as "Your device could
 * not complete that." — alarming, and the opposite of the truth. The user is
 * already protected; that is a reassurance, not a failure.
 *
 * Proven against a CDP virtual authenticator on production 2026-08-12: a second
 * enrolment of the same device raises `InvalidStateError` because the server
 * sends `excludeCredentials`, so this branch is a real path and not defensive
 * decoration.
 *
 * The three outcomes are deliberately distinct:
 *   added     — a new passkey exists
 *   already   — this device was already enrolled; nothing to do, and fine
 *   cancelled — a decision, not an error, so it says nothing at all
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

import { classifyPasskeyError } from '../../lib/auth/passkey-errors';

export type PasskeyOutcome =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'added' }
  | { kind: 'already' }
  | { kind: 'error'; message: string };

export function useAddPasskey(): {
  outcome: PasskeyOutcome;
  add: () => Promise<void>;
} {
  const [outcome, setOutcome] = useState<PasskeyOutcome>({ kind: 'idle' });

  async function add(): Promise<void> {
    setOutcome({ kind: 'busy' });
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
        setOutcome({ kind: 'error', message: j.message ?? 'That passkey could not be saved.' });
        return;
      }
      setOutcome({ kind: 'added' });
    } catch (err) {
      switch (classifyPasskeyError(err)) {
        // Already enrolled. `excludeCredentials` did its job; say so plainly.
        case 'already':
          setOutcome({ kind: 'already' });
          return;
        // Dismissed or timed out. Back to where they were, silently.
        case 'cancelled':
          setOutcome({ kind: 'idle' });
          return;
        default:
          setOutcome({ kind: 'error', message: 'Your device could not complete that.' });
      }
    }
  }

  return { outcome, add };
}
