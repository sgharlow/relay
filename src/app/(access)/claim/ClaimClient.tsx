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
import { useSearchParams } from 'next/navigation';

interface Standby {
  itemCount: number;
  categories: Record<string, number>;
  triggerTypes: string[];
}

export default function ClaimClient() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'verifier' } | { kind: 'recipient'; standby: Standby }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its invitation code.' });
      return;
    }

    fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: 'POST' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({ kind: 'error', message: body.message ?? 'That invitation is not valid.' });
          return;
        }
        setState(
          body.personType === 'verifier'
            ? { kind: 'verifier' }
            : { kind: 'recipient', standby: body.standby as Standby },
        );
      })
      .catch(() => setState({ kind: 'error', message: 'Something went wrong. Try the link again.' }));
  }, [token]);

  if (state.kind === 'loading') return <p className="text-stone-500">Checking your invitation…</p>;

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-stone-300 bg-white p-5">
        <h1 className="text-xl font-semibold text-stone-900">We couldn&rsquo;t open that link</h1>
        <p className="mt-2 text-stone-700">{state.message}</p>
        <p className="mt-3 text-stone-600">Ask whoever invited you to send a fresh one.</p>
      </div>
    );
  }

  if (state.kind === 'verifier') {
    return (
      <div className="rounded-lg border border-stone-300 bg-white p-5">
        <h1 className="text-xl font-semibold text-stone-900">You&rsquo;re on the list</h1>
        <p className="mt-3 text-stone-800">
          If something happens, we may ask you one question: is this real?
        </p>
        <p className="mt-3 text-stone-800">
          <strong>You will never see their information.</strong> Not now, and not when access opens.
          Your only role is to confirm — or deny — that the situation is genuine.
        </p>
        <p className="mt-3 text-stone-600">
          Nothing more to do today. We&rsquo;ll be in touch only if we need you.
        </p>
      </div>
    );
  }

  const { standby } = state;
  const cats = Object.entries(standby.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border border-stone-300 bg-white p-5">
      <h1 className="text-xl font-semibold text-stone-900">You&rsquo;re set up</h1>
      <p className="mt-3 text-stone-800">
        Nothing is open right now, and nothing will be until a trigger is verified.
      </p>

      <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
        <p className="text-stone-900">
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

      <p className="mt-4 text-stone-700">
        We&rsquo;re not showing you what those items are — that stays private until it needs not to
        be.
      </p>
      <p className="mt-3 text-stone-600">
        You don&rsquo;t need to do anything else. If access ever opens, we&rsquo;ll email you and
        you&rsquo;ll already be signed in.
      </p>
    </div>
  );
}
