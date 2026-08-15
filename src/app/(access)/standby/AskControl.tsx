'use client';

/**
 * "Ask them to open it" — J6's missing front door.
 *
 * THE GAP THIS CLOSES. `POST /api/access-requests` accepted only a recipient
 * token, and recipient tokens exist only after a release is already open. So the
 * only person who could ask for access was one who already had it, while the
 * owner's `/challenge` screen, the challenge-window escalation and J6-R9's
 * circle broadcast all sat waiting for a request nobody could make.
 *
 * This is the *pull* half of core principle 5 — every participant can do their
 * job by visiting the site. Without it the only routes to access were the owner
 * anticipating the emergency, or waiting out a check-in interval measured in
 * weeks; and the case this product exists for is the one where neither happened.
 *
 * WHY IT SITS BEHIND A SESSION. An unauthenticated "enter your email" form would
 * let a stranger challenge any owner by guessing addresses and, per J6-R9, mail
 * that to their whole circle. There are already two ways to be signed in here:
 * accepting in calm, or redeeming an emergency code in a crisis.
 *
 * IT IS DELIBERATELY NOT A BUTTON THAT JUST FIRES. Asking costs the owner an
 * interruption and everyone they named an email — that visibility is the
 * anti-abuse control (J6-R9), not a side effect — so the copy says who will hear
 * about it before the reason box is even shown.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R1, J6-R2, J6-R8, J6-R9
 */

import { useState } from 'react';

const TRIGGERS = [
  { value: 'emergency', label: 'An emergency' },
  { value: 'caregiver', label: 'They need care and cannot manage this themselves' },
  { value: 'travel', label: 'They are away and unreachable' },
  { value: 'business', label: 'Something at work cannot wait' },
] as const;

export default function AskControl({
  ownerId,
  ownerLabel,
  onAsked,
}: {
  ownerId: string;
  ownerLabel: string;
  onAsked: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [triggerType, setTriggerType] = useState<string>('emergency');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p
        style={{ fontSize: 'var(--t3)', lineHeight: 1.6, marginTop: 12, color: '#6b6257' }}
        role="status"
      >
        Asked. {ownerLabel} has been told first, and has a window to answer. If they cannot, the
        people they chose to confirm an emergency are asked instead — so this does not depend on
        them being able to reply.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 12,
          minHeight: 44,
          padding: '10px 18px',
          fontSize: 'var(--t4)',
          fontWeight: 600,
          color: '#211d18',
          background: 'transparent',
          border: '1px solid #cfc7ba',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Ask {ownerLabel} to open it
      </button>
    );
  }

  return (
    <form
      style={{ marginTop: 14, padding: 16, borderRadius: 8, background: '#f6f3ee' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
          const res = await fetch('/api/access-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: ownerId, trigger_type: triggerType, reason }),
          });
          if (!res.ok) {
            const b = (await res.json().catch(() => ({}))) as { message?: string };
            setErr(b.message ?? 'We could not send that. Please try again.');
            return;
          }
          setSent(true);
          await onAsked();
        } catch {
          setErr('We could not reach the server. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {/*
        J6-R9's deterrent, said out loud BEFORE they ask rather than discovered
        afterwards. A covert access attempt is impossible because everybody
        hears; someone with an honest reason should know that and be unbothered
        by it, and someone without one should be told before they start.
      */}
      <p style={{ fontSize: 'var(--t3)', lineHeight: 1.6, color: '#211d18' }}>
        <strong>{ownerLabel} will be asked first.</strong> Everyone else they named is told that you
        asked, whatever the outcome — that is deliberate, so nobody can quietly reach into someone
        else&rsquo;s accounts.
      </p>

      <label
        htmlFor="ask-trigger"
        style={{ display: 'block', marginTop: 14, fontSize: 'var(--t3)', fontWeight: 600 }}
      >
        What has happened?
      </label>
      <select
        id="ask-trigger"
        value={triggerType}
        onChange={(e) => setTriggerType(e.target.value)}
        style={{
          marginTop: 6,
          minHeight: 48,
          width: '100%',
          fontSize: 'var(--t4)',
          padding: '0 10px',
          border: '1px solid #cfc7ba',
          borderRadius: 8,
          background: '#fffdf9',
        }}
      >
        {TRIGGERS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <label
        htmlFor="ask-reason"
        style={{ display: 'block', marginTop: 14, fontSize: 'var(--t3)', fontWeight: 600 }}
      >
        In your own words
      </label>
      <p style={{ fontSize: 'var(--t3)', lineHeight: 1.5, color: '#6b6257', marginTop: 2 }}>
        Whoever reads this may have to decide without being able to ask you anything, so say where
        they are and what you need.
      </p>
      <textarea
        id="ask-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        style={{
          marginTop: 6,
          width: '100%',
          fontSize: 'var(--t4)',
          lineHeight: 1.5,
          padding: 10,
          border: '1px solid #cfc7ba',
          borderRadius: 8,
          background: '#fffdf9',
        }}
      />

      {err ? (
        <p role="alert" style={{ marginTop: 10, fontSize: 'var(--t3)', color: '#9a3412' }}>
          {err}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button
          type="submit"
          disabled={busy || !reason.trim()}
          style={{
            minHeight: 48,
            padding: '0 20px',
            fontSize: 'var(--t4)',
            fontWeight: 600,
            color: '#fffdf9',
            background: '#211d18',
            border: 'none',
            borderRadius: 8,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy || !reason.trim() ? 0.5 : 1,
          }}
        >
          {busy ? 'Asking…' : 'Ask them'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            minHeight: 48,
            padding: '0 20px',
            fontSize: 'var(--t4)',
            color: '#6b6257',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </form>
  );
}
