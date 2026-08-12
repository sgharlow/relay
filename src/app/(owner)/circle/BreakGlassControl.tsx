'use client';

/**
 * Issuing an emergency code (§3.6).
 *
 * THE GAP THIS CLOSES: `POST /api/people/[id]/break-glass` had existed with no
 * caller, so an owner could not hand anybody a code and the redeem path shipped
 * on 2026-08-12 was reachable only by script.
 *
 * DELIBERATELY NOT A ONE-TAP BUTTON. §8.1 is blunt about what this is: until it
 * is redeemed, a break-glass code is "functionally indistinguishable from the
 * standing printed credential this architecture exists to eliminate", it lives
 * for a year, and it lands with the population least equipped to store it well.
 * The architecture accepts that trade because using one is loud — but the owner
 * making the trade should be told what they are trading. So this is folded away
 * behind a plain-text control, and opening it explains before it offers.
 *
 * It is also not the FIRST thing offered. The invitation sits above it as the
 * primary action, because a contact who claims needs no code at all — which is
 * the whole direction of hybrid+6.
 *
 * Shown for everyone except a revoked person: `redeemBreakGlass` refuses those
 * outright (revocation outranks a code in a drawer), so offering to mint one
 * would be offering something that cannot work.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { useState } from 'react';

interface Issued {
  code: string;
  expiresAt: string;
}

export default function BreakGlassControl({
  personId,
  personType,
  name,
  hasClaimed,
}: {
  personId: string;
  personType: 'recipient' | 'verifier';
  name: string;
  /** Changes only the explanation — a claimed person needs this for a lost device. */
  hasClaimed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${encodeURIComponent(personId)}/break-glass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personType }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Issued> & { message?: string };
      if (!res.ok || !body.code) {
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
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
    } catch {
      // The code is on screen regardless; a refused clipboard is not an error.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: '6px',
          // WCAG 2.5.8 wants a 24x24 CSS px target. Measured at 19px on
          // 2026-08-12 — a text-styled control is still a control, and this one
          // sits in the owner path, used by people who may be older.
          minHeight: 24,
          display: 'inline-flex',
          alignItems: 'center',
          padding: 0,
          border: 'none',
          background: 'none',
          color: 'var(--ink-muted)',
          fontSize: 'var(--t1)',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        Emergency code
      </button>
    );
  }

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
      {issued ? (
        <>
          <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
            Write this down and give it to {name}. We cannot show it again.
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
            {issued.code}
          </div>
          <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', lineHeight: 1.5 }}>
            Good until {new Date(issued.expiresAt).toLocaleDateString()}. It works once, and whoever
            holds it can take {name}&rsquo;s place that once — so somewhere physical and private is
            better than a text message. You will be emailed the moment it is used.
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
        </>
      ) : (
        <>
          <div style={{ fontSize: 'var(--t2)', fontWeight: 600 }}>A way back in for {name}</div>
          <p
            style={{
              fontSize: 'var(--t1)',
              color: 'var(--ink-muted)',
              lineHeight: 1.5,
              marginTop: '4px',
            }}
          >
            {hasClaimed
              ? `${name} has an account, so they only need this if they lose the device they sign in with.`
              : `${name} has not set up an account. This is how they would act if they never do.`}{' '}
            A code lasts a year and works once. Anyone holding it can take their place that once, so
            treat it like a spare key — and it replaces any code they already have.
          </p>
          <button
            type="button"
            onClick={create}
            disabled={busy}
            style={{
              marginTop: 'var(--s2)',
              minHeight: 36,
              padding: '0 var(--s3)',
              borderRadius: 'var(--radius-owner)',
              border: '1px solid var(--rule-strong)',
              background: 'transparent',
              fontSize: 'var(--t1)',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Creating…' : 'Create a code'}
          </button>
        </>
      )}

      {error ? (
        <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '6px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
