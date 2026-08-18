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

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

import { CONTACT_EMAIL, CONTACT_MAILTO } from '../../../../lib/contact';

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

  /*
    🔴 THE CLAIM MUST FIRE EXACTLY ONCE PER CODE, and an effect cannot promise
    that on its own: React StrictMode double-invokes effects in development, and
    the two racing signIn() calls desynchronised NextAuth's CSRF double-submit —
    the first POST was refused, the second was aborted by the first's navigation
    AFTER the server had already spent the single-use code. The claimant landed
    on /standby signed out, holding a code that now answers "already been used".
    Found 2026-08-17 by screenshotting this page; production single-fires, so
    the ref is cheap insurance there and correctness in every dev walk.
  */
  const claimStarted = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return; // Show the code form instead.
    if (claimStarted.current === token) return;
    claimStarted.current = token;

    // Phase 0 middle-of-funnel marker, before anything can fail. Fire-and-forget:
    // a measurement must never be able to stop somebody claiming.
    void fetch(`/api/invitations/${encodeURIComponent(token)}/opened`, { method: 'POST' }).catch(
      () => {},
    );

    // Claiming IS signing in ([A1] stage one, "acknowledge and bind this
    // device"). A freshly-claimed contact has no TOTP secret and no passkey, so
    // binding their identity and stopping there would leave them with an account
    // they could never sign into. Redeeming the single-use code is the one-time
    // authentication, and the session it mints is the device binding.
    signIn('standby-claim', { token, redirect: false })
      .then(async (res) => {
        // `ok` explicitly, not merely "no error". A falsy or partial result --
        // seen on 2026-08-12 when a TLS-interception proxy mangled the callback
        // -- must not read as success and send someone to a dashboard for a
        // claim that never happened.
        if (!res || res.error || res.ok !== true) {
          // Released so "Try the code again" can actually try again — the ref
          // exists to stop the AUTOMATIC double-fire, never a person's retry.
          claimStarted.current = null;
          setState({
            kind: 'error',
            message: 'That code is not valid, or it has already been used.',
          });
          return;
        }
        /*
          🔴 `ok: true` IS NOT A SESSION. NextAuth answers a CSRF-refused
          credentials callback with a redirect to `signin?csrf=true` — no error
          parameter, so signIn() reports ok on a claim that minted nothing, and
          the 2026-08-12 guard above passes it. The only thing that can tell a
          minted session from a refused one is the session endpoint, so ask it
          before navigating. On a genuine CSRF flake the code is unspent — the
          retry this error state offers actually works.
        */
        const session = await fetch('/api/auth/session', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!session?.user) {
          claimStarted.current = null; // A retry is legitimate: nothing was spent.
          setState({
            kind: 'error',
            message: 'That did not go through. Nothing is wrong with your code — try it again.',
          });
          return;
        }
        // Rung 0 — where they can see what they now stand for, and come back to
        // later without being told anything.
        // A FULL PAGE LOAD IS THE POINT. Claiming mints a new session; a
        // client-side router push would navigate with the pre-claim one still in
        // memory and /standby would resolve nothing.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/standby';
      })
      .catch(() => {
        claimStarted.current = null;
        setState({ kind: 'error', message: 'Something went wrong. Try again.' });
      });
  }, [token]);

  if (!token) return <ClaimCodeEntry onCode={setToken} />;

  if (state.kind === 'loading') return <p className="text-muted">Checking your invitation…</p>;

  if (state.kind === 'error') {
    return (
      /*
        🔴 THIS WAS A DEAD END UNTIL 2026-08-16, on the one path where a dead end
        costs the most.

        There was no way back. A person who mistyped one character of a code that
        looks like 4KMPQ-7XR2W landed here with no retry control, no link out, and
        only the browser back button — which they would have to think of. So they
        give up, and they do it SILENTLY: a person who abandons sends no signal,
        so the failure looks identical to nobody wanting it.

        That matters more here than almost anywhere else in the product. Claim
        conversion is the Phase 0 metric, and two shipped security decisions rest
        on it — principle 1 is conditional on it, and adaptive minting assumes
        verifiers reach `confirmed`. Beta invitations are queued to go out to real
        people, so this would have met the first cohort.

        Clearing the token is all the retry needs: `if (!token)` is evaluated
        above this branch, so the code form comes straight back with the message
        still visible in memory of what went wrong.

        The heading no longer says "link" either. Most people arriving here typed
        a code — the emailed link is deliberately bare, carrying no credential —
        so "link" described something they never used.
      */
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-5">
        <h1 className="text-t7 font-semibold text-ink">We couldn&rsquo;t open that invitation</h1>
        <p className="mt-2 text-ink">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setToken(null);
          }}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-ink px-4 font-medium text-paper"
        >
          Try the code again
        </button>
        <p className="mt-3 text-muted">
          If it still will not open, ask whoever invited you to send a fresh one — or email{' '}
          <a className="underline" href={CONTACT_MAILTO}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
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
      <p className="mt-3 text-t4 leading-relaxed text-ink">
        Someone has named you in their Relay plan. Type the code they gave you — they may have read it out, texted it, or written it down.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onCode(code.trim());
        }}
      >
        {/*
          "Code from your email" until 2026-08-16, which contradicted the
          paragraph three lines above it and was wrong for the arm the product
          DEFAULTS to. BETA_INVITE_CHANNEL='owner' sends no email at all —
          docs/first-invitations.md: "the owner-delivered arm sends no email".
          Somebody read their code over the phone would look for a message that
          was never sent, and give up silently.

          It stays neutral because the page cannot know which arm the owner
          chose, and the body copy above already covers all of them. /access and
          /verify keep their email wording, because those codes really are
          emailed under adaptive minting.
        */}
        <label htmlFor="invite" className="block text-t2 font-medium text-ink">
          Invitation code
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
          className="mt-5 min-h-[52px] w-full rounded-md bg-ink px-6 text-t4 font-semibold text-paper hover:bg-ink disabled:opacity-50"
        >
          Continue
        </button>
      </form>

      <p className="mt-6 text-t3 leading-relaxed text-muted">
        Nothing is being opened. Accepting only tells them you have seen it.
      </p>
    </div>
  );
}
