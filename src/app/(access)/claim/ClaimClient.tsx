'use client';

/**
 * Claim in calm — a recipient or verifier accepts their role BEFORE any trigger
 * fires (J4-R9).
 *
 * A recipient sees the SHAPE of their future grant: how many items, in which
 * categories. Never a title, never content (J4-R10). A verifier is told plainly
 * that they will never see the vault at all (J4-R12).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10, J4-R11, J4-R12
 */

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

interface Standby {
  itemCount: number;
  categories: Record<string, number>;
  triggerTypes: string[];
}

export default function ClaimClient() {
  const urlToken = useSearchParams().get('token');
  // A typed code, kept in memory. Arriving with nothing is now the NORMAL path:
  // the emailed link is bare, so a forwarded invitation carries no credential.
  const [token, setToken] = useState<string | null>(urlToken);
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'verifier' } | { kind: 'recipient'; standby: Standby }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!token) return; // Show the code form instead.

    // Claiming IS signing in ([A1] stage one, "acknowledge and bind this
    // device"). A freshly-claimed contact has no TOTP secret and no passkey, so
    // binding their identity and stopping there would leave them with an account
    // they could never sign into. Redeeming the single-use code is the one-time
    // authentication, and the session it mints is the device binding.
    signIn('standby-claim', { token, redirect: false })
      .then((res) => {
        if (!res || res.error) {
          setState({
            kind: 'error',
            message: 'That code is not valid, or it has already been used.',
          });
          return;
        }
        // Rung 0 — where they can see what they now stand for, and come back to
        // later without being told anything.
        window.location.href = '/standby';
      })
      .catch(() => setState({ kind: 'error', message: 'Something went wrong. Try again.' }));
  }, [token]);

  if (!token) return <ClaimCodeEntry onCode={setToken} />;

  if (state.kind === 'loading') return <p className="text-muted">Checking your invitation…</p>;

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-5">
        <h1 className="text-t7 font-semibold text-ink">We couldn&rsquo;t open that link</h1>
        <p className="mt-2 text-ink">{state.message}</p>
        <p className="mt-3 text-muted">Ask whoever invited you to send a fresh one.</p>
      </div>
    );
  }

  if (state.kind === 'verifier') {
    return (
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-5">
        <h1 className="text-t7 font-semibold text-ink">You&rsquo;re on the list</h1>
        <p className="mt-3 text-ink">
          If something happens, we may ask you one question: is this real?
        </p>
        <p className="mt-3 text-ink">
          <strong>You will never see their information.</strong> Not now, and not when access opens.
          Your only role is to confirm — or deny — that the situation is genuine.
        </p>
        <p className="mt-3 text-muted">
          Nothing more to do today. We&rsquo;ll be in touch only if we need you.
        </p>
      </div>
    );
  }

  const { standby } = state;
  const cats = Object.entries(standby.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border border-rule-strong bg-paper-raised p-5">
      <h1 className="text-t7 font-semibold text-ink">You&rsquo;re set up</h1>
      <p className="mt-3 text-ink">
        Nothing is open right now, and nothing will be until a trigger is verified.
      </p>

      <div className="mt-4 rounded border border-ochre bg-ochre-soft p-4">
        <p className="text-ink">
          If that day comes, you would get access to{' '}
          <strong>
            {standby.itemCount} item{standby.itemCount === 1 ? '' : 's'}
          </strong>
          {cats.length > 0 && (
            <>
              {' '}
              across{' '}
              {cats.map(([c, n], i) => (
                <span key={c}>
                  {i > 0 && (i === cats.length - 1 ? ' and ' : ', ')}
                  {c} ({n})
                </span>
              ))}
            </>
          )}
          .
        </p>
      </div>

      <p className="mt-4 text-ink">
        We&rsquo;re not showing you what those items are — that stays private until it needs not to
        be.
      </p>
      <p className="mt-3 text-muted">
        You don&rsquo;t need to do anything else. If access ever opens, we&rsquo;ll email you and
        you&rsquo;ll already be signed in.
      </p>
    </div>
  );
}

/**
 * Invitation code entry.
 *
 * The last credential Relay had travelling in a URL. Converting it is what lets
 * the promise in every one of our emails — that we never send a link which
 * signs you in — actually hold. A rule with one exception is a rule a recipient
 * cannot use to spot a fake.
 */
function ClaimCodeEntry({ onCode }: { onCode: (c: string) => void }) {
  const [code, setCode] = useState('');

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-rule bg-paper-raised px-6 py-7">
      <h1 className="text-t7 font-semibold leading-snug text-ink">Enter your invitation code</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink">
        Someone has named you in their Relay plan. Type the code from the email they sent you.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onCode(code.trim());
        }}
      >
        <label htmlFor="invite" className="block text-t2 font-medium text-ink">
          Code from your email
        </label>
        <input
          id="invite"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="4KMPQ-7XR2W"
          className="mt-2 min-h-[52px] w-full rounded-md border border-rule-strong px-4 text-center font-mono text-t7 tracking-[0.15em] text-ink placeholder:text-muted focus:border-rule focus:outline-none"
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-ink px-6 text-[17px] font-semibold text-paper hover:bg-ink disabled:opacity-50"
        >
          Continue
        </button>
      </form>

      <p className="mt-6 text-[15px] leading-relaxed text-muted">
        Nothing is being opened. Accepting only tells them you have seen it.
      </p>
    </div>
  );
}
