'use client';

/**
 * Correcting somebody's name.
 *
 * 🔴 THE ENDPOINT EXISTED AND NOTHING CALLED IT. `PUT /api/recipients/[id]` and
 * `PUT /api/verifiers/[id]` were implemented and tested; the circle screen
 * offered no way to reach either, so a name typed wrong at 11pm was permanent.
 * Found by lib/ops/api-reachability.ts, which now fails CI on exactly this.
 *
 * WHY THIS MATTERS MORE THAN A TYPO USUALLY DOES. The name is what every person
 * you trust reads in the message that matters: "Margaret Chen has asked you to
 * confirm an emergency." A misspelling there is not cosmetic — it is the moment
 * a recipient asks whether the message is genuine, on the day it is least
 * possible to check.
 *
 * NAME ONLY, DELIBERATELY. The route is a full replace, so this sends the row's
 * other values back unchanged. It does NOT offer to edit the email: changing the
 * address of somebody who has already claimed their place does not unbind them,
 * so the effect is subtle enough to deserve its own decision rather than a text
 * box next to a name. Getting the address wrong is fixed by removing and
 * re-inviting, which is honest about what actually has to happen.
 *
 * Feature: relay-standby
 * Requirements: J4-R1
 */

import { useState } from 'react';
import { apiSend } from '../_lib/api';

export function RenameControl({
  personType,
  person,
  onRenamed,
}: {
  personType: 'recipient' | 'verifier';
  person: { id: string; name: string; email: string; relationship?: string | null; role?: string };
  onRenamed: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
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
    const next = name.trim();
    if (!next || next === person.name) {
      setEditing(false);
      setName(person.name);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend(
        personType === 'recipient'
          ? `/api/recipients/${person.id}`
          : `/api/verifiers/${person.id}`,
        'PUT',
        personType === 'recipient'
          ? {
              name: next,
              email: person.email,
              relationship: person.relationship ?? null,
              role: person.role,
            }
          : { name: next, email: person.email },
      );
      setEditing(false);
      await onRenamed();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} style={quiet} aria-label={`Rename ${person.name}`}>
        Rename
      </button>
    );
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        aria-label="Their name"
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
          setName(person.name);
          setError(null);
        }}
        style={quiet}
      >
        Cancel
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
