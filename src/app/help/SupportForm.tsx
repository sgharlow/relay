'use client';

/**
 * The human channel, when the FAQ has not answered it.
 *
 * A FORM rather than a bare mailto, for the reason the interest form already
 * documents: on a phone a mailto opens an app the visitor may not have
 * configured, and the ones most likely to need help here are on a phone in the
 * middle of something. The mailto stays visible as the fallback, and becomes the
 * explicit instruction if the send fails.
 *
 * ⚠️ IT ASKS FOR NOTHING SENSITIVE, and says so. "Paste your code here" is the
 * obvious next thing a support form grows, and it would turn this mailbox into
 * a place where credentials accumulate — a target, and a contradiction of the
 * promise that Relay never asks you for one.
 */

import { useState, type FormEvent } from 'react';
import { CONTACT_EMAIL, CONTACT_MAILTO } from '../../../lib/contact';

type Status = 'idle' | 'sending' | 'sent' | 'failed';

export function SupportForm({ from }: { from?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, message, from: from ?? '', company: '' }),
      });
      setStatus(res.ok ? 'sent' : 'failed');
    } catch {
      setStatus('failed');
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded border border-rule bg-paper-raised p-5">
        <p className="text-t3 font-medium text-ink">That has reached us.</p>
        <p className="mt-2 text-t2 text-muted">
          A person reads these — there is no queue and no ticket number. If it is urgent, say so and
          it will be treated that way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded border border-rule bg-paper-raised p-5">
      <label htmlFor="support-email" className="block text-t2 font-medium text-ink">
        Where should we reply?
      </label>
      <input
        id="support-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-1 min-h-[44px] w-full rounded border border-rule-strong px-3 text-t2 text-ink"
      />

      <label htmlFor="support-message" className="mt-4 block text-t2 font-medium text-ink">
        What is happening?
      </label>
      <textarea
        id="support-message"
        required
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Tell us what you were trying to do and what happened instead."
        className="mt-1 w-full rounded border border-rule-strong px-3 py-2 text-t2 text-ink"
      />

      {/* Honeypot: hidden from people, checked on the server. */}
      <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="mt-3 text-t1 text-muted">
        Please do not include codes, passwords or anything from inside a vault. We will never ask
        for them, and we could not use them if you sent them.
      </p>

      {status === 'failed' ? (
        <p role="alert" className="mt-3 text-t2 text-clay">
          That did not send. Please email{' '}
          <a className="underline" href={CONTACT_MAILTO}>
            {CONTACT_EMAIL}
          </a>{' '}
          directly — it reaches the same person.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="mt-4 min-h-[44px] rounded bg-ink px-4 text-t2 font-medium text-paper disabled:opacity-50"
      >
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>

      <p className="mt-3 text-t1 text-muted">
        Or write to{' '}
        <a className="underline" href={CONTACT_MAILTO}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </form>
  );
}
