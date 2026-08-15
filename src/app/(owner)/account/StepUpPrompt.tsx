'use client';

/**
 * "Confirm it's you" — the re-authentication prompt.
 *
 * WHAT IT IS FOR. Issuing recovery codes, exporting the vault and closing the
 * account now require a factor presented in the last five minutes, because each
 * of them converts a session somebody walked away from into something that
 * OUTLIVES it. The API answers 403 `StepUpRequired`; this is what the person
 * sees when it does.
 *
 * IT APPEARS IN RESPONSE TO INTENT, never on arrival. Prompting on page load
 * would ask most visitors to authenticate for something they were not going to
 * do, and a prompt people learn to dismiss is a prompt that protects nothing.
 * So the action is attempted, refused, and the prompt explains itself in terms
 * of the thing they just pressed — then repeats that action on success, so the
 * interruption costs one step rather than two.
 *
 * IT OFFERS ONLY FACTORS THIS ACCOUNT HOLDS. Showing a passkey button to
 * somebody who has never registered one produces a dead end at the worst moment.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J13-R1, J13-R2
 */

import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

export interface StepUpFactors {
  totp: boolean;
  passkey: boolean;
}

export default function StepUpPrompt({
  action,
  factors,
  onConfirmed,
  onCancel,
}: {
  /** What the person just tried to do, in their words. Used in the heading. */
  action: string;
  factors: StepUpFactors;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands where the answer goes. Somebody who reached this prompt is
  // mid-task and should not have to hunt for the field.
  useEffect(() => {
    (factors.totp ? codeRef.current : cancelRef.current)?.focus();
  }, [factors.totp]);

  // Escape cancels. A prompt with no keyboard way out is a trap, and this one
  // can appear over an irreversible action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function present(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onConfirmed();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(
        res.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : (data.message ?? 'That did not match. Try again.'),
      );
      setCode('');
      codeRef.current?.focus();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function onPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch('/api/webauthn/authenticate/options', { method: 'POST' });
      if (!optRes.ok) throw new Error('unavailable');
      const { options, challengeToken } = (await optRes.json()) as {
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
        challengeToken: string;
      };
      const assertion = await startAuthentication({ optionsJSON: options });
      await present({ response: JSON.stringify(assertion), challengeToken });
    } catch (e) {
      // Cancelling the OS prompt is a decision, not a failure worth shouting
      // about — the same treatment useAddPasskey gives it.
      const name = (e as { name?: string })?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('That passkey could not be used. Try your authenticator code.');
      }
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
    >
      <div className="w-full max-w-md rounded border border-rule bg-paper-raised p-5 shadow-lg">
        <h2 id="step-up-heading" className="text-t5 font-semibold text-ink">
          Confirm it&rsquo;s you
        </h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          {action} is one of the few things that outlasts this session, so Relay asks for your
          second factor again before it happens. It is valid for the next five minutes.
        </p>

        {factors.totp ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && code.trim()) void present({ totpCode: code.trim() });
            }}
            className="mt-4"
          >
            <label htmlFor="step-up-code" className="block text-t2 font-medium text-ink">
              Authenticator code
            </label>
            <input
              id="step-up-code"
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-describedby={error ? 'step-up-error' : undefined}
              className="mt-1 w-full rounded border border-rule-strong px-3 py-2 font-mono text-t3 tracking-widest focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="mt-3 min-h-[44px] w-full rounded bg-ink px-3 text-t2 font-semibold text-paper disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </form>
        ) : null}

        {factors.passkey ? (
          <button
            type="button"
            onClick={onPasskey}
            disabled={busy}
            className="mt-3 min-h-[44px] w-full rounded border border-rule-strong px-3 text-t2 font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
          >
            {factors.totp ? 'Or use your passkey' : 'Use your passkey'}
          </button>
        ) : null}

        {!factors.totp && !factors.passkey ? (
          <p className="mt-4 text-t2 leading-relaxed text-clay">
            This account has no authenticator or passkey registered, so there is nothing to confirm
            with. Add a passkey above and try again.
          </p>
        ) : null}

        {error ? (
          <p id="step-up-error" role="alert" className="mt-3 text-t2 font-medium text-clay">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          ref={cancelRef}
          onClick={onCancel}
          className="mt-3 min-h-[44px] w-full rounded border border-rule px-3 text-t2 text-muted hover:bg-paper-sunken"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
