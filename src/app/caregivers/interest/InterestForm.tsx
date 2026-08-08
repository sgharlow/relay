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

import { CAREGIVER_LEAD, recallChannel } from '../analytics';
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
      <div className="mt-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-left">
        <p className="font-semibold text-amber-200">Got it — thank you.</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          We read every one of these ourselves, and you&apos;ll hear back within a day. If anything
          is urgent in the meantime, email{' '}
          <a className="text-amber-300 underline underline-offset-4" href={MAILTO}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 text-left">
      <label htmlFor="email" className="block text-sm font-medium text-slate-200">
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
        className="mt-2 min-h-[48px] w-full rounded-md border border-slate-700 bg-slate-900 px-4 text-base text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />

      <label htmlFor="note" className="mt-5 block text-sm font-medium text-slate-200">
        One line about your situation <span className="text-slate-500">(optional)</span>
      </label>
      <textarea
        id="note"
        name="note"
        rows={3}
        maxLength={1000}
        placeholder="Dad's in hospital and I can't get into anything."
        className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
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
        className="mt-6 min-h-[48px] w-full rounded-md bg-amber-500 px-6 text-base font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending…' : 'Request an invite'}
      </button>

      {status === 'error' && (
        <p className="mt-3 text-sm leading-relaxed text-amber-300">
          {message} Please email{' '}
          <a className="underline underline-offset-4" href={MAILTO}>
            {CONTACT_EMAIL}
          </a>{' '}
          instead — we&apos;ll still see it.
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        We&apos;ll only use this to reply to you. No card required, and nothing is charged today.
      </p>
    </form>
  );
}
