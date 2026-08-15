'use client';

/**
 * A second mailbox for the person whose silence would stall a release.
 *
 * WHY THE PRODUCT OFFERS THIS AT ALL. Relay's mail is filed as junk by Outlook
 * with flawless authentication, and two content hypotheses were tested and
 * refuted (2026-08-09 Reply-To, 2026-08-14 message shape). What remains is
 * sending-domain reputation, which no code in this repo reaches. When one
 * channel cannot be made reliable, the honest move is to stop depending on
 * exactly one of it — and `email_secondary` had been sitting unused in the
 * schema since migration 020.
 *
 * ⚠️ IT IS NOT A SECOND COPY OF EVERYTHING. Only messages carrying no credential
 * are sent twice; a code, a token or a sign-in link goes to one address and one
 * only. `lib/notify/fanout.ts` holds that rule and the reasoning. The copy below
 * says so, because an owner who believed the backup covered everything would
 * make exactly the wrong plan for the bad day.
 *
 * Offered for everyone rather than only for the addresses we have measured
 * failing: the Outlook finding is the one we can prove, not the whole of the
 * risk, and a mailbox that is simply not checked fails just as silently.
 *
 * Feature: relay-standby
 */

import { useState } from 'react';
import { apiSend } from '../_lib/api';

export default function SecondAddressControl({
  personType,
  person,
  onChanged,
}: {
  personType: 'recipient' | 'verifier';
  person: {
    id: string;
    name: string;
    email: string;
    email_secondary?: string | null;
    relationship?: string | null;
    role?: string;
  };
  onChanged: () => Promise<void>;
}) {
  const current = person.email_secondary ?? '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quiet: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t1)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    color: 'var(--ink-muted)',
    textDecoration: 'underline',
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      /*
        A full replace, like RenameControl — the route is a PUT. The difference
        is that this one is the caller that DOES have an opinion about the
        second address, so it always sends the key: an empty string is how the
        owner removes one, and the validator turns that into an explicit null.
      */
      await apiSend(
        personType === 'recipient' ? `/api/recipients/${person.id}` : `/api/verifiers/${person.id}`,
        'PUT',
        personType === 'recipient'
          ? {
              name: person.name,
              email: person.email,
              relationship: person.relationship ?? null,
              role: person.role,
              email_secondary: value.trim(),
            }
          : { name: person.name, email: person.email, email_secondary: value.trim() },
      );
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
        {current ? (
          <>
            Backup address: {current}.{' '}
            <button onClick={() => setEditing(true)} style={quiet}>
              Change
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={quiet}
            aria-label={`Add a second address for ${person.name}`}
          >
            Add a second address
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '4px' }}>
      <form onSubmit={save} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
        <input
          type="email"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder="Another address they read"
          aria-label={`Second address for ${person.name}`}
          style={{
            fontSize: 'var(--t2)',
            padding: 'var(--s1) var(--s2)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
          }}
        />
        <button type="submit" disabled={busy} style={{ ...quiet, color: 'var(--ink)' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(current);
            setError(null);
          }}
          style={quiet}
        >
          Cancel
        </button>
      </form>
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
        Used for the messages that carry nothing secret — &ldquo;something has happened, go and sign
        in&rdquo;. Codes and links still go to one address only, so this is a second chance at
        being told, not a second copy of everything. Leave it empty to remove it.
      </div>
      {error ? (
        <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '4px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
