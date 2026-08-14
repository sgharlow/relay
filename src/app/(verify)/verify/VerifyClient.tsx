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

import { Article } from '../../../../lib/text/article';

interface Context {
  caseId: string;
  /** Whose vault. J7-R3's "who is asking" — see the note on `VerifierContext`. */
  ownerLabel: string;
  /** Why now, derived from `initiated_by`. The other half of J7-R3. */
  whyNow: string;
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

/**
 * The timeline, in words that are true whatever started the release.
 *
 * 🔴 `release_transition_pending` READ "No response, so we started asking",
 * which asserts a CAUSE — and on 2026-08-12 it appeared directly beneath the new
 * "why now" line saying "They started this themselves, before becoming
 * unreachable." Two sentences on the highest-stakes screen in the product,
 * contradicting each other about why the verifier was called.
 *
 * `whyNow` is derived from `initiated_by` and knows the cause; this list is a
 * sequence of events and should not guess at one.
 */
const ACTION_LABEL: Record<string, string> = {
  checkin_reminder_sent: 'We tried to reach them',
  release_transition_pending: 'Relay began asking the people they chose',
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
  const [notCounted, setNotCounted] = useState(false);
  const [busy, setBusy] = useState(false);
  // A CLAIMED verifier arrives with no token at all — they followed the CTA on
  // their standby dashboard. Until this existed they were shown the code-entry
  // form, asked for a credential that is deliberately no longer sent to them.
  // `null` means "not asked yet", so the code form never flashes at them.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // Which open release, when one person stands by for two owners at once. Not a
  // credential: the server re-checks the roster row whatever this says.
  const release = useSearchParams().get('release');

  useEffect(() => {
    if (token) return; // A token wins — the unclaimed path is untouched.
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setSignedIn(Boolean(s?.user)))
      .catch(() => setSignedIn(false));
  }, [token]);

  const load = useCallback(async () => {
    if (!token && !signedIn) return; // Neither route yet — the code form shows.
    const url = token
      ? `/api/verify/${encodeURIComponent(token)}`
      : `/api/verify${release ? `?release=${encodeURIComponent(release)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      setError(
        (await res.json().catch(() => ({}))).message ??
          (token ? 'This link is no longer valid.' : 'There is no decision waiting for you.'),
      );
      return;
    }
    setCtx((await res.json()) as Context);
  }, [token, signedIn, release]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: Decision) {
    setBusy(true);
    // Signed in: no token in the URL and none in the body. The server resolves
    // the roster row from the session on this request (§3.7 rule 1).
    const res = token
      ? await fetch(`/api/verify/${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision }),
        })
      : await fetch('/api/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, releaseStateId: release ?? undefined }),
        });
    setBusy(false);
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      // §4.3: recorded, but it does not advance the quorum because the person
      // who named them has not yet checked their identity. Saying "thank you,
      // that's recorded" here would be technically true and practically a lie —
      // they would walk away believing they had helped.
      setNotCounted(body.status === 'not_counted');
      setDone(decision);
    } else setError('We could not record that. Try again in a moment.');
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-6">
        <h1 className="text-t7 font-semibold">We couldn&rsquo;t open that link</h1>
        <p className="mt-3 text-ink">{error}</p>
      </div>
    );
  }

  // Still establishing whether they are signed in. Showing the code form here
  // would flash "type your code" at a claimed verifier who was never sent one.
  if (!token && signedIn === null) return <p className="text-muted">Loading…</p>;

  // No token and no session: ask for the code. This is the entry point for a
  // verified verifier who holds no passkey and no authenticator — the only class
  // still sent a code since adaptive minting. The emailed link is bare, so
  // arriving here with nothing is normal rather than an error.
  //
  // ⚠️ This comment said "guaranteed permanently by J7-R1" until 2026-08-12.
  // That guarantee was withdrawn the same day: quorum counts only confirmed
  // people, so a code mailed to an unverified verifier bought a vote with no
  // effect. The path is not permanent by requirement any more — it is here
  // because a confirmed verifier with no device genuinely needs it.
  if (!token && !signedIn) return <CodeEntry onToken={setToken} />;

  if (!ctx) return <p className="text-muted">Loading…</p>;

  // Closure (J7-R12) — verifiers who hear nothing back stop answering.
  if (done) {
    return (
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-6">
        <h1 className="text-t7 font-semibold">Thank you</h1>
        {/*
          §4.3. Their answer is on the record but does not move the count,
          because the person who named them never confirmed who they were
          speaking to. Shown FIRST and plainly: letting somebody leave believing
          they had helped, during an emergency, is the worst thing this screen
          could do. It also gives them the one action that fixes it, which is a
          phone call they can make themselves.
        */}
        {notCounted && (
          <p className="mt-3 rounded-lg border border-ochre bg-ochre-soft p-3 text-ink">
            Your answer is recorded, but it will not open anything on its own yet — they had not
            confirmed it was really you before this happened. If you can reach them, ask them to
            verify you in Relay; your answer counts from then on.
          </p>
        )}
        {done === 'confirm' && !notCounted && (
          <p className="mt-3 text-ink">
            Recorded. {ctx.reversible ? 'They can reverse this at any time.' : 'This one is permanent, as they arranged.'}
          </p>
        )}
        {done === 'deny' && (
          <p className="mt-3 text-ink">
            Recorded. Saying no is exactly what we needed to know — nothing opens on your account of it.
          </p>
        )}
        {done === 'abstain' && (
          <p className="mt-3 text-ink">
            Recorded as &ldquo;not sure&rdquo;. We&rsquo;ll ask someone else. That is a completely
            reasonable answer.
          </p>
        )}
        <p className="mt-4 text-[16px] text-muted">Reference {ctx.caseId}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-rule-strong bg-paper-raised p-6">
        <p className="text-[16px] uppercase tracking-wide text-muted">Reference {ctx.caseId}</p>
        {/*
          🔴 J7-R3 SAYS "WHO IS ASKING" FIRST, and until 2026-08-12 this said
          "Someone has asked for {trigger} access to a vault you agreed to help
          protect" — naming nobody. The context loaded `owner_id` and never
          resolved it, so the email that summoned this person named the owner
          and the page they landed on did not.

          A doctor cannot responsibly attest that an unnamed person's emergency
          is genuine, and somebody standing by for two people (§3.7) could not
          tell which one this was about. Found by writing the user manual: the
          sentence "the page tells you whose emergency it is" could not be
          written truthfully.
        */}
        <h1 className="mt-2 text-t7 font-semibold">Is this real, for {ctx.ownerLabel}?</h1>
        <p className="mt-3 text-ink">
          {Article(ctx.triggerType)} {ctx.triggerType} release has been
          started on <strong>{ctx.ownerLabel}</strong>&rsquo;s vault, and you are one of the people
          they chose to ask.
        </p>
        <p className="mt-2 text-ink">{ctx.whyNow}</p>
      </div>

      {/* Why now */}
      {ctx.escalationHistory.length > 0 && (
        <div className="rounded-lg border border-rule-strong bg-paper-raised p-6">
          <h2 className="text-t5 font-semibold">What has happened so far</h2>
          <ul className="mt-3 space-y-2">
            {ctx.escalationHistory.map((h, i) => (
              <li key={`${h.action}-${i}`} className="text-ink">
                {ACTION_LABEL[h.action] ?? h.action}
                <span className="text-muted"> — {new Date(h.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What confirming does — and what it does not */}
      <div className="rounded-lg border border-ochre bg-ochre-soft p-6">
        <h2 className="text-t5 font-semibold text-ink">If you confirm</h2>
        <p className="mt-2 text-ink">
          They get access to <strong>{ctx.itemCount}</strong> item
          {ctx.itemCount === 1 ? '' : 's'}
          {ctx.categories.length > 0 && <> across {ctx.categories.join(', ')}</>}.
        </p>
        <p className="mt-2 text-ink">
          {ctx.reversible
            ? 'This can be undone. If it turns out to be a false alarm, access closes again.'
            : 'This one is permanent and cannot be undone. It is the arrangement they chose for after their death.'}
        </p>
        <p className="mt-3 text-ink">
          {ctx.receivedConfirmations} of {ctx.requiredConfirmations} needed so far.
        </p>
      </div>

      <div className="rounded-lg border-2 border-rule-strong bg-paper-raised p-6">
        <h2 className="text-t5 font-semibold">What this does not do</h2>
        <p className="mt-2 text-ink">
          <strong>You will never see any of their information.</strong> Not now, and not after you
          confirm. You are being asked one question only: whether the situation is genuine.
        </p>
      </div>

      {/* Three actions of equal weight (J7-R6) */}
      {/*
        🔴 J7-R6: "Deny SHALL be presented with EQUAL PROMINENCE and equal
        effort to confirm." Until 2026-08-12 "Yes" was a filled black button and
        "No" was an outline — equal effort, unequal prominence, on the screen
        whose stated failure mode is rubber-stamping. The file header claimed
        all three carried equal weight; the render did not.

        All three now share one treatment. The words differ; nothing else does,
        so nothing on the page leans on the answer.
      */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('confirm')}
          className="w-full rounded border-2 border-rule-strong bg-paper-raised px-5 py-4 font-semibold text-ink hover:bg-paper-sunken disabled:opacity-50"
        >
          Yes — this is real
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('deny')}
          className="w-full rounded border-2 border-rule-strong bg-paper-raised px-5 py-4 font-semibold text-ink hover:bg-paper-sunken disabled:opacity-50"
        >
          No — this is not right
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('abstain')}
          className="w-full rounded border-2 border-rule-strong bg-paper-raised px-5 py-4 font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
        >
          I don&rsquo;t know
        </button>
      </div>

      <p className="text-[16px] text-muted">
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
    <div className="rounded-lg border border-rule-strong bg-paper-raised p-6">
      <h1 className="text-t7 font-semibold text-ink">Enter your code</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink">
        Someone has asked you to confirm that a situation is genuine. Type the code we sent you.
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="code" className="block text-t2 font-medium text-ink">
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
          className="mt-2 min-h-[52px] w-full rounded-md border border-rule-strong px-4 text-center font-mono text-t7 tracking-[0.2em] text-ink placeholder:text-muted focus:border-rule focus:outline-none"
        />

        {err ? <p className="mt-3 text-[16px] text-clay">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-ink px-6 text-[17px] font-semibold text-paper hover:bg-ink disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <ExpiredCodeHelp />

      <p className="mt-6 text-[15px] leading-relaxed text-muted">
        You will never be shown anyone&rsquo;s private information — not now, and not after you
        answer. A real message from Relay never asks you to click a link and then enter anything.
      </p>
    </div>
  );
}

/**
 * "My code has expired" — and, just as often, "I never got one".
 *
 * THE GAP THIS CLOSES. `/access` grew this affordance because the owner is, by
 * the nature of this product, the person in hospital, so a locked-out contact
 * had nobody able to help. The verifier had no equivalent, and their code lasts
 * 72 hours — which is worse in one specific way: a stalled recipient
 * inconveniences themselves, while a stalled verifier holds up the release for
 * everybody else.
 *
 * Both wordings lead here on purpose. Deliverability was measured broken on
 * 2026-08-11, so "it never arrived" is the commoner of the two.
 *
 * What arrives depends on how the person is set up — the endpoint reuses the
 * same classifier the release path uses — so this promises "what they need"
 * rather than "a code", which would be false for anyone who correctly receives
 * none.
 */
function ExpiredCodeHelp() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (sent) {
    return (
      <p className="mt-6 rounded-md bg-paper-sunken px-4 py-3 text-[16px] leading-relaxed text-ink">
        If that address is expected on an open request, we have sent it what it needs. It can take a
        minute to arrive.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 min-h-[24px] text-[16px] text-muted underline underline-offset-4 hover:text-ink"
      >
        My code has expired, or never arrived
      </button>
    );
  }

  return (
    <form
      className="mt-5 rounded-md bg-paper-sunken p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await fetch('/api/verify/resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
        } finally {
          setBusy(false);
          setSent(true);
        }
      }}
    >
      <label htmlFor="vresend" className="block text-[16px] font-medium text-ink">
        The email address they used for you
      </label>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">
        We send to the address already on file, never to one typed here — so this cannot be used to
        redirect anything.
      </p>
      <input
        id="vresend"
        type="email"
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        autoComplete="email"
        className="mt-2 min-h-[52px] w-full rounded-md border border-rule-strong px-4 text-[17px] text-ink focus:border-rule focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="mt-3 min-h-[52px] w-full rounded-md border border-rule-strong px-6 text-[17px] font-semibold text-ink disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send it again'}
      </button>
    </form>
  );
}
