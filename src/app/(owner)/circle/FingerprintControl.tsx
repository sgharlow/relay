'use client';

/**
 * Confirming that a claimed slot is really held by the person the owner named
 * (§3.3) — the entire assurance model, and it had no surface until 2026-08-12.
 *
 * WHY THE PHRASE IS SHOWN AND THE BUTTON IS NOT ENOUGH. The claim ticket is a
 * bearer secret for the hours between sending and spending. An interceptor who
 * claims the slot looks, from every angle the database has, exactly like the
 * intended person. The only thing that separates them is a comparison over a
 * channel the attacker does not control — the owner's own voice. So this shows
 * the phrase and asks the owner to read it aloud; a bare "Confirm" button would
 * be asking them to assert a comparison they were never given the means to make.
 *
 * ⚠️ THE CONTACT MUST NEVER CONFIRM ALONE. §3.3 calls this out as the obvious
 * simplification that breaks the property: an interceptor sees a phrase too and
 * would happily confirm it, and the owner would go green without ever speaking
 * to the real person. That is why this control lives in owner mode only and says
 * "call them" rather than "send them a link".
 *
 * BOTH ANSWERS ARE OFFERED WITH EQUAL WEIGHT. A mismatch is the event the whole
 * control exists to catch, and an interface that makes "yes" easy and "no"
 * invisible produces yeses. Rejecting is a security event — it severs the
 * binding and kills the live ticket — so it also asks once before doing it.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { useState } from 'react';

type State = 'claimed' | 'confirmed';

export default function FingerprintControl({
  personId,
  personType,
  name,
  fingerprint,
  state,
  onChanged,
}: {
  personId: string;
  personType: 'recipient' | 'verifier';
  name: string;
  fingerprint: string;
  state: State;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);

  async function send(url: string, method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personType }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? 'That did not go through.');
        return;
      }
      setOpen(false);
      setConfirmingReject(false);
      onChanged();
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const secondary: React.CSSProperties = {
    minHeight: 36,
    padding: '0 var(--s3)',
    borderRadius: 'var(--radius-owner)',
    border: '1px solid var(--rule-strong)',
    background: 'transparent',
    fontSize: 'var(--t1)',
    cursor: 'pointer',
  };

  if (state === 'confirmed') {
    return (
      <div style={{ marginTop: '6px' }}>
        {open ? (
          <div
            style={{
              padding: 'var(--s3)',
              borderRadius: 'var(--radius-owner)',
              background: 'var(--paper-sunken)',
              border: '1px solid var(--rule)',
            }}
          >
            <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', lineHeight: 1.5 }}>
              You confirmed you spoke to {name} and the phrase matched. Withdrawing that keeps their
              place — it only retracts your assurance that it is really them.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => send(`/api/people/${encodeURIComponent(personId)}/confirm`, 'DELETE')}
              style={{ ...secondary, marginTop: 'var(--s2)', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Working…' : 'Withdraw my confirmation'}
            </button>
            {error ? (
              <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '6px' }}>
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              // WCAG 2.5.8: 24x24 minimum. Measured 19px on 2026-08-12.
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
            Verified — undo
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '6px' }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ ...secondary, minHeight: 32 }}
        >
          Check it is really them
        </button>
      ) : (
        <div
          style={{
            padding: 'var(--s3)',
            borderRadius: 'var(--radius-owner)',
            background: 'var(--paper-sunken)',
            border: '1px solid var(--rule)',
          }}
        >
          <div style={{ fontSize: 'var(--t2)', fontWeight: 600 }}>Call {name} and read this out</div>
          <div
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 'var(--t4)',
              fontWeight: 600,
              margin: 'var(--s2) 0',
            }}
          >
            {fingerprint}
          </div>
          <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', lineHeight: 1.5 }}>
            They see the same four words on their own screen. Speaking to them is the point — it is
            the one channel nobody else can reach, and it is what tells you the person who accepted
            is the person you meant.
          </p>

          {confirmingReject ? (
            <div style={{ marginTop: 'var(--s2)' }}>
              <p style={{ fontSize: 'var(--t1)', lineHeight: 1.5 }}>
                If the words do not match, someone other than {name} accepted this place. We will
                remove them, cancel the code you sent, and put {name} back to not-yet-invited so you
                can start again on a channel you trust.
              </p>
              <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send(`/api/people/${encodeURIComponent(personId)}/reject`, 'POST')}
                  style={{ ...secondary, borderColor: 'var(--clay)', color: 'var(--clay)', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'Working…' : 'Yes, remove them'}
                </button>
                <button type="button" onClick={() => setConfirmingReject(false)} style={secondary}>
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => send(`/api/people/${encodeURIComponent(personId)}/confirm`, 'POST')}
                style={{ ...secondary, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Working…' : 'The words matched'}
              </button>
              {/* Equal weight, on purpose: a mismatch is the event this exists to catch. */}
              <button
                type="button"
                onClick={() => setConfirmingReject(true)}
                style={{ ...secondary, borderColor: 'var(--clay)', color: 'var(--clay)' }}
              >
                They did not match
              </button>
              <button type="button" onClick={() => setOpen(false)} style={secondary}>
                Not now
              </button>
            </div>
          )}

          {error ? (
            <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '6px' }}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
