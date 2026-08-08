'use client';

/**
 * The verifier's decision surface.
 *
 * Order matters: who is asking, why now, what confirming does, and — the part
 * that determines whether anyone agrees to be a verifier at all — what it does
 * NOT do (J7-R3, J7-R4).
 *
 * Confirm, Deny and "I don't know" carry equal weight and equal effort. A deny
 * that is harder to reach than a confirm produces rubber stamps (J7-R6).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1, J7-R3, J7-R4, J7-R6, J7-R12
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Context {
  caseId: string;
  triggerType: string;
  itemCount: number;
  categories: string[];
  requiredConfirmations: number;
  receivedConfirmations: number;
  graceEndsAt: string | null;
  reversible: boolean;
  escalationHistory: { action: string; ts: string }[];
}

type Decision = 'confirm' | 'deny' | 'abstain';

const ACTION_LABEL: Record<string, string> = {
  checkin_reminder_sent: 'We tried to reach them',
  release_transition_pending: 'No response, so we started asking',
  access_requested: 'Someone asked for access',
};

export default function VerifyClient() {
  const urlToken = useSearchParams().get('token');
  // A code typed here becomes a token in memory. The credential never enters
  // the URL, so nothing lands in browser history, referrer headers or proxy
  // logs, and a forwarded email carries no ability to confirm anything.
  const [token, setToken] = useState<string | null>(urlToken);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return; // No token yet — the code form is shown instead.
    const res = await fetch(`/api/verify/${encodeURIComponent(token)}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).message ?? 'This link is no longer valid.');
      return;
    }
    setCtx((await res.json()) as Context);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: Decision) {
    setBusy(true);
    const res = await fetch(`/api/verify/${encodeURIComponent(token ?? '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    if (res.ok) setDone(decision);
    else setError('We could not record that. Try again in a moment.');
  }

  if (error) {
    return (
      <div className="rounded-lg border border-stone-300 bg-white p-6">
        <h1 className="text-2xl font-semibold">We couldn&rsquo;t open that link</h1>
        <p className="mt-3 text-stone-700">{error}</p>
      </div>
    );
  }

  // No token yet: ask for the code from the email. This is the default entry
  // point now — the emailed link is bare, so arriving here with nothing is the
  // normal path rather than an error.
  if (!token) return <CodeEntry onToken={setToken} />;

  if (!ctx) return <p className="text-stone-600">Loading…</p>;

  // Closure (J7-R12) — verifiers who hear nothing back stop answering.
  if (done) {
    return (
      <div className="rounded-lg border border-stone-300 bg-white p-6">
        <h1 className="text-2xl font-semibold">Thank you</h1>
        {done === 'confirm' && (
          <p className="mt-3 text-stone-800">
            Recorded. {ctx.reversible ? 'They can reverse this at any time.' : 'This one is permanent, as they arranged.'}
          </p>
        )}
        {done === 'deny' && (
          <p className="mt-3 text-stone-800">
            Recorded. Saying no is exactly what we needed to know — nothing opens on your account of it.
          </p>
        )}
        {done === 'abstain' && (
          <p className="mt-3 text-stone-800">
            Recorded as &ldquo;not sure&rdquo;. We&rsquo;ll ask someone else. That is a completely
            reasonable answer.
          </p>
        )}
        <p className="mt-4 text-[16px] text-stone-600">Reference {ctx.caseId}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-300 bg-white p-6">
        <p className="text-[16px] uppercase tracking-wide text-stone-500">Reference {ctx.caseId}</p>
        <h1 className="mt-2 text-2xl font-semibold">Is this real?</h1>
        <p className="mt-3 text-stone-800">
          Someone has asked for {ctx.triggerType} access to a vault you agreed to help protect.
        </p>
      </div>

      {/* Why now */}
      {ctx.escalationHistory.length > 0 && (
        <div className="rounded-lg border border-stone-300 bg-white p-6">
          <h2 className="font-semibold">What has happened so far</h2>
          <ul className="mt-3 space-y-2">
            {ctx.escalationHistory.map((h, i) => (
              <li key={`${h.action}-${i}`} className="text-stone-800">
                {ACTION_LABEL[h.action] ?? h.action}
                <span className="text-stone-500"> — {new Date(h.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What confirming does — and what it does not */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h2 className="font-semibold text-stone-900">If you confirm</h2>
        <p className="mt-2 text-stone-900">
          They get access to <strong>{ctx.itemCount}</strong> item
          {ctx.itemCount === 1 ? '' : 's'}
          {ctx.categories.length > 0 && <> across {ctx.categories.join(', ')}</>}.
        </p>
        <p className="mt-2 text-stone-900">
          {ctx.reversible
            ? 'This can be undone. If it turns out to be a false alarm, access closes again.'
            : 'This one is permanent and cannot be undone. It is the arrangement they chose for after their death.'}
        </p>
        <p className="mt-3 text-stone-900">
          {ctx.receivedConfirmations} of {ctx.requiredConfirmations} needed so far.
        </p>
      </div>

      <div className="rounded-lg border-2 border-stone-400 bg-white p-6">
        <h2 className="font-semibold">What this does not do</h2>
        <p className="mt-2 text-stone-800">
          <strong>You will never see any of their information.</strong> Not now, and not after you
          confirm. You are being asked one question only: whether the situation is genuine.
        </p>
      </div>

      {/* Three actions of equal weight (J7-R6) */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('confirm')}
          className="w-full rounded border-2 border-stone-800 bg-stone-800 px-5 py-4 font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
        >
          Yes — this is real
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('deny')}
          className="w-full rounded border-2 border-stone-800 bg-white px-5 py-4 font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50"
        >
          No — this is not right
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('abstain')}
          className="w-full rounded border-2 border-stone-400 bg-white px-5 py-4 font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          I don&rsquo;t know
        </button>
      </div>

      <p className="text-[16px] text-stone-600">
        &ldquo;I don&rsquo;t know&rdquo; is a real answer. We will ask someone else rather than
        counting it either way.
      </p>
    </div>
  );
}

/**
 * Code entry — the verifier's front door.
 *
 * Replaces a signed token in the URL. Typing eight characters is more work than
 * one click, and that cost is real on the step the whole release path depends
 * on; the compensation is that the emailed link is now safe to click, safe to
 * forward, and safe to appear in a log. Relay can also say, and mean, that it
 * never sends a link that signs you in — which makes any email that does one
 * self-evidently fake.
 *
 * Access-mode voice: large type, one field, no chrome.
 */
function CodeEntry({ onToken }: { onToken: (t: string) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/verify/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
      if (res.ok && body.token) onToken(body.token);
      else setErr(body.message ?? 'That code was not recognised.');
    } catch {
      setErr('We could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-300 bg-white p-6">
      <h1 className="text-2xl font-semibold text-stone-900">Enter your code</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-stone-700">
        Someone has asked you to confirm that a situation is genuine. Type the code from the email
        we sent you.
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="code" className="block text-sm font-medium text-stone-700">
          Code from your email
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="7K4M-P2XW"
          className="mt-2 min-h-[52px] w-full rounded-md border border-stone-400 px-4 text-center font-mono text-2xl tracking-[0.2em] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
        />

        {err ? <p className="mt-3 text-[16px] text-red-700">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-stone-900 px-6 text-[17px] font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <p className="mt-6 text-[15px] leading-relaxed text-stone-500">
        You will never be shown anyone&rsquo;s private information — not now, and not after you
        answer. Relay will never send you a link that signs you in.
      </p>
    </div>
  );
}
