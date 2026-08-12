'use client';

/**
 * Leaving a circle (sprint plan N15/N16) — the most basic right a standby
 * account has, and it had no surface until 2026-08-12.
 *
 * `/api/standby/leave` has existed since sprint C4 with no caller, so a free
 * user with an account could be named in someone else's plan indefinitely with
 * no way out. "A standby account is a free user with rights" does not survive
 * the most basic one being unreachable.
 *
 * TWO REASONS, RECORDED DISTINCTLY, because they mean different things to the
 * owner. "I am stepping down" is a person withdrawing. "I do not know this
 * person" is a signal that an invitation reached the wrong inbox — which is a
 * security event for the owner to act on, and the contact-side half of the
 * fingerprint mismatch response (N16).
 *
 * DEGRADE, NEVER DELETE (§3.7 rule 3). The roster row survives, unbound and back
 * to `invited`; the owner's light goes red and their audit chain records it.
 * Deleting the row would silently shrink someone else's circle, which is exactly
 * the failure this architecture exists to prevent — they would have a smaller
 * plan and no idea why. So the copy says plainly that they will be told.
 *
 * NOT THE LOUDEST THING ON THE PAGE. Rung 0's job is reassurance — "nothing is
 * open, there is nothing you need to do" — and a prominent Leave button would
 * argue with that. Folded away, findable, honest when opened.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { useState } from 'react';

export default function LeaveControl({
  personId,
  personType,
  ownerLabel,
  somethingOpen,
  onLeft,
}: {
  personId: string;
  personType: 'recipient' | 'verifier';
  ownerLabel: string;
  /** True while a release is open for this owner — leaving now has weight. */
  somethingOpen: boolean;
  onLeft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave(reason: 'resigned' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/standby/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, personType, reason }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? 'We could not do that just now.');
        return;
      }
      onLeft();
    } catch {
      setError('We could not do that just now.');
    } finally {
      setBusy(false);
    }
  }

  const button: React.CSSProperties = {
    minHeight: 48,
    padding: '0 18px',
    borderRadius: 6,
    border: '1px solid #cfc7ba',
    background: '#fffdf9',
    fontSize: 17,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 14,
          padding: 0,
          border: 'none',
          background: 'none',
          color: '#6b6257',
          fontSize: 16,
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        Step down from this
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 14,
        padding: 16,
        borderRadius: 8,
        border: '1px solid #e4ded4',
        background: '#fffdf9',
      }}
    >
      <p style={{ fontSize: 17, lineHeight: 1.6 }}>
        {ownerLabel} will be told, and their plan will be weaker until they find someone else. They
        can ask you again — stepping down now does not close the door.
      </p>

      {somethingOpen ? (
        <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 10, color: '#9a3412' }}>
          Something is open for them right now, and they may be counting on you today. If you can,
          answer first and step down afterwards.
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <button type="button" disabled={busy} onClick={() => leave('resigned')} style={button}>
          {busy ? 'Working…' : 'I can no longer do this'}
        </button>
        {/* Recorded separately: this one usually means the invitation reached the
            wrong inbox, which the owner needs to know as a security matter
            rather than as somebody withdrawing. */}
        <button type="button" disabled={busy} onClick={() => leave('rejected')} style={button}>
          {busy ? 'Working…' : `I do not know ${ownerLabel}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ ...button, borderColor: 'transparent', fontWeight: 400 }}
        >
          Stay
        </button>
      </div>

      {error ? (
        <p role="alert" style={{ fontSize: 16, marginTop: 12, color: '#9a3412' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
