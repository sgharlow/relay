'use client';

/**
 * Getting somebody their claim code — the entry point the standby architecture
 * had no way in through.
 *
 * THE GAP THIS CLOSES, found by the 2026-08-12 beta reassessment. Adding a
 * person already mints an invitation and emails it (`inviteOnCreateBestEffort`),
 * and `POST /api/invitations` reissues it — but NOTHING in the product called
 * that route. The owner could not see the code, could not resend, and could not
 * tell whether the email arrived. `inviteOnCreateBestEffort` even says "the
 * owner can always resend from the invitations surface"; there was no such
 * surface. So the whole of sprints B-E was reachable only by running a script,
 * and every circle light would have read "Not claimed yet" forever.
 *
 * THE CODE IS THE POINT, NOT THE EMAIL. Delivery was measured broken on
 * 2026-08-11 — Outlook filing at SCL 5, Resend suppression returning 200 for a
 * muted recipient — so a button that only sends an email would rebuild the
 * product on the one channel it cannot trust. The code is shown to the owner to
 * read down the phone, which is both more reliable and better assurance: a voice
 * the person recognises is a stronger binding than an inbox.
 *
 * Shown for anyone not yet claimed, including people invited long ago, because
 * "I sent it and heard nothing" is the common case rather than the exception.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useState } from 'react';

interface Issued {
  claimCode: string;
  claimUrl: string;
  expiresAt: string;
  emailDelivered: boolean;
}

export default function InviteControl({
  personId,
  personType,
  name,
}: {
  personId: string;
  personType: 'recipient' | 'verifier';
  name: string;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, personType }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Issued> & { message?: string };
      if (!res.ok || !body.claimCode) {
        setError(body.message ?? 'Could not create a code just now.');
        return;
      }
      setIssued(body as Issued);
    } catch {
      setError('Could not create a code just now.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.claimCode);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the code is on screen regardless, so
      // this is not worth an error state.
    }
  }

  if (issued) {
    const expires = new Date(issued.expiresAt);
    return (
      <div
        style={{
          marginTop: 'var(--s2)',
          padding: 'var(--s3)',
          borderRadius: 'var(--radius-owner)',
          background: 'var(--paper-sunken)',
          border: '1px solid var(--rule)',
        }}
      >
        <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
          Read this to {name}. It works once.
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 'var(--t5)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            margin: 'var(--s2) 0',
          }}
        >
          {issued.claimCode}
        </div>
        <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
          They enter it at {issued.claimUrl} · expires{' '}
          {Number.isNaN(expires.getTime()) ? 'soon' : expires.toLocaleDateString()}
        </div>
        <div style={{ fontSize: 'var(--t1)', marginTop: 'var(--s2)', color: 'var(--ink-muted)' }}>
          {issued.emailDelivered
            ? 'Also emailed to them — but say it out loud if you can. Email is the part that fails.'
            : '⚠️ The email did not go through. Reading it to them is now the only way they will get it.'}
        </div>
        <button
          type="button"
          onClick={copy}
          style={{
            marginTop: 'var(--s2)',
            minHeight: 36,
            padding: '0 var(--s3)',
            borderRadius: 'var(--radius-owner)',
            border: '1px solid var(--rule-strong)',
            background: 'transparent',
            fontSize: 'var(--t1)',
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--s1, 4px)' }}>
      <button
        type="button"
        onClick={issue}
        disabled={busy}
        style={{
          minHeight: 32,
          padding: '0 var(--s3)',
          borderRadius: 'var(--radius-owner)',
          border: '1px solid var(--rule-strong)',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 'var(--t1)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {/* One label, because "already invited" is not knowable: adding a person
            auto-sends an invitation and `standby_state` has no value meaning
            "never invited". This describes what the button DOES, which is true
            in either case. */}
        {busy ? 'Making a code…' : 'Get a code to read them'}
      </button>
      {error ? (
        <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '4px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
