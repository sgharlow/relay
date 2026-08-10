'use client';

/**
 * The G1 funnel's conversion point.
 *
 * Replaces a mailto: link, which on the mobile traffic this page is built to
 * receive meant handing the visitor to an app many of them have never set up —
 * paying for the click and capturing nobody.
 *
 * Three details that matter more than they look:
 *   - inputMode/autoComplete/type=email so phone keyboards offer an @ and the
 *     browser can autofill. Typing an address on a phone is the whole friction.
 *   - The mailto: fallback stays visible, and becomes the explicit instruction
 *     if the request fails. A visitor who wanted to reach us must always be
 *     able to, whatever the backend is doing.
 *   - Channel and CTA are read from the URL and sessionStorage so a lead can be
 *     attributed to the ad that paid for it, using the same vocabulary as the
 *     caregiver_qualified / caregiver_intent events.
 *
 * Feature: relay-g1-wtp
 */

import { useRef, useState, type FormEvent } from 'react';

import { CAREGIVER_CHECKOUT, CAREGIVER_LEAD, recallChannel } from '../analytics';
import { recallClickId } from '../click-id';
import { trackG1 } from '../track';

const CONTACT_EMAIL = 'sgharlow+relay@gmail.com';
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Founding family — Relay for caregivers')}`;

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function InterestForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  // When this component first rendered, used server-side to reject submissions
  // completed faster than a person could type. A ref, not state, so it is fixed
  // at first render and never triggers one. See lib/http/bot-signals.ts.
  const renderedAt = useRef(Date.now());

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;

    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus('sending');
    setMessage('');

    try {
      const params = new URLSearchParams(window.location.search);
      // Whichever ad paid for this visitor, parked on the landing page.
      const click = recallClickId();
      const res = await fetch('/api/caregivers/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email') ?? ''),
          note: String(data.get('note') ?? ''),
          company: String(data.get('company') ?? ''), // honeypot
          renderedAt: renderedAt.current,
          src: recallChannel() ?? undefined,
          cta: params.get('src') ?? undefined,
          // Whichever ad actually paid for this visitor, if any.
          clickPlatform: click?.platform,
          clickId: click?.id,
        }),
      });

      if (res.ok) {
        // Fire AFTER the server accepted it. A lead event for a submission that
        // failed would inflate the one number in this funnel that is supposed to
        // mean a real person we can reply to.
        trackG1(CAREGIVER_LEAD, {
          src: recallChannel() ?? 'direct',
          cta: params.get('src') ?? 'none',
          withNote: String(Boolean(String(data.get('note') ?? '').trim())),
        });
        setStatus('sent');
        return;
      }

      const payload = (await res.json().catch(() => ({}))) as { message?: string };
      setStatus('error');
      setMessage(payload.message ?? 'Something went wrong.');
    } catch {
      setStatus('error');
      setMessage('We could not reach the server.');
    }
  }

  if (status === 'sent') {
    return (
      <div className="mt-8 rounded-xl border border-ochre bg-ochre-soft p-6 text-left">
        <p className="font-semibold text-ochre-text">Got it — thank you.</p>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          We read every one of these ourselves, and you&apos;ll hear back within a day. If anything
          is urgent in the meantime, email{' '}
          <a className="text-ochre-text underline underline-offset-4" href={MAILTO}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 text-left">
      {/* BUY NOW, alongside the list rather than instead of it.
          Checkout is owner-authenticated because the account IS the product —
          taking a card for a vault that does not exist yet would create a paid
          customer with nothing to log into, and a reconciliation path that can
          fail silently. So this routes through signup, which the buyer would
          have to do anyway, and continues straight to Stripe afterwards.
          The gate is untouched: caregiver_intent already fired on page load. */}
      <a
        href={`/auth/signup?next=checkout&src=${encodeURIComponent(recallChannel() ?? 'direct')}`}
        onClick={() =>
          trackG1(CAREGIVER_CHECKOUT, {
            src: recallChannel() ?? 'direct',
            cta: 'interest-buy',
          })
        }
        className="flex min-h-[52px] w-full items-center justify-center rounded-md bg-ink px-6 text-t3 font-semibold text-paper transition-colors hover:bg-ink"
      >
        Set up my vault now — $119/yr
      </a>
      <p className="mt-2 text-center text-t1 leading-relaxed text-muted">
        Takes a few minutes. You will need an authenticator app — there is no password to lose.
      </p>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-paper-sunken" />
        <span className="text-t1 uppercase tracking-wider text-muted">or</span>
        <span className="h-px flex-1 bg-paper-sunken" />
      </div>

      <p className="text-t2 leading-relaxed text-muted">
        Not ready yet? Tell us about your situation and we&apos;ll be in touch — we onboard
        founding families personally.
      </p>

    <form onSubmit={onSubmit} className="mt-4 text-left">
      <label htmlFor="email" className="block text-t2 font-medium text-muted">
        Your email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        className="mt-2 min-h-[48px] w-full rounded-md border border-rule bg-paper px-4 text-t3 text-ink placeholder:text-muted focus:border-ochre focus:outline-none focus:ring-1 focus:ring-ochre"
      />

      <label htmlFor="note" className="mt-5 block text-t2 font-medium text-muted">
        One line about your situation <span className="text-muted">(optional)</span>
      </label>
      <textarea
        id="note"
        name="note"
        rows={3}
        maxLength={1000}
        placeholder="Dad's in hospital and I can't get into anything."
        className="mt-2 w-full rounded-md border border-rule bg-paper px-4 py-3 text-t3 text-ink placeholder:text-muted focus:border-ochre focus:outline-none focus:ring-1 focus:ring-ochre"
      />

      {/* Honeypot — hidden from people, tempting to naive bots. Not display:none,
          which some bots specifically skip. aria-hidden + tabIndex keeps it away
          from screen readers and keyboard users. */}
      <div className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={status === 'sending'}
        // Subordinate to "Set up my vault now" on purpose. Two identical amber
        // buttons made the waitlist compete with the sale, which is exactly
        // backwards now that checkout is live: someone ready to pay should not
        // have to pick their action out of a pair.
        className="mt-6 min-h-[48px] w-full rounded-md border border-rule-strong bg-transparent px-6 text-t3 font-medium text-muted transition-colors hover:border-rule-strong hover:text-paper disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending…' : 'Request an invite'}
      </button>

      {status === 'error' && (
        <p className="mt-3 text-t2 leading-relaxed text-ochre-text">
          {message} Please email{' '}
          <a className="underline underline-offset-4" href={MAILTO}>
            {CONTACT_EMAIL}
          </a>{' '}
          instead — we&apos;ll still see it.
        </p>
      )}

      <p className="mt-4 text-t1 leading-relaxed text-muted">
        We&apos;ll only use this to reply to you. No card required, and nothing is charged today.
      </p>
    </form>
    </div>
  );
}
