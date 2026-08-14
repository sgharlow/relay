'use client';

/**
 * Correcting and removing a vault item.
 *
 * 🔴 NEITHER WAS REACHABLE UNTIL 2026-08-13. `PUT /api/vault/items/[id]` and
 * `DELETE /api/vault/items/[id]` were implemented, validated, audited and
 * unit-tested — and nothing in the product called either. The vault list
 * rendered every item as a plain row with no controls at all, so once something
 * was saved it could not be corrected, updated or taken out. The vault was
 * append-only by accident.
 *
 * That is the defining failure for this product rather than a missing
 * convenience. Its value is a vault that is TRUE on a day nobody can predict,
 * over a horizon measured in years; a password rotated in 2027 and never updated
 * here becomes an entry the family opens, reads, and finds does not work — at
 * the worst possible moment, and indistinguishable from a plan that was never
 * any good. §2.1 of the manual names exactly this: the worst outcome is not
 * failing, it is "appearing to work for four years".
 *
 * WHY REMOVAL ASKS AND CORRECTION DOES NOT. Deleting cascades to every access
 * rule pointing at the item, so one click could quietly change who can reach
 * what on the day it runs. Correcting is recoverable by correcting again.
 *
 * WHY THE OLD SECRET IS NOT SHOWN IN THE FORM. Relay cannot read it — that is
 * the point of the encryption, not a limitation of this screen — so an update
 * replaces the value rather than editing it. Saying so on the form prevents the
 * reasonable assumption that a blank box means "leave it alone".
 *
 * Feature: relay-h0-mvp
 * Requirements: 1.1–1.4
 */

import { useState } from 'react';
import { CryptoService } from '../../../../lib/crypto/crypto-service';
import type { DashboardItem } from '../../../../lib/vault/dashboard-view';
import type { VaultItemType } from '../../../../lib/domain/enums';

type Mode = 'idle' | 'editing' | 'confirming-delete';

export function ItemControls({
  item,
  onChanged,
}: {
  item: DashboardItem;
  onChanged: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [title, setTitle] = useState(item.title);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quiet: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t1)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 'var(--s1) var(--s2)',
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await new CryptoService().updateItemSecret(item.id, secret, {
        type: item.type as VaultItemType,
        title: title.trim() || item.title,
        service_name: item.service_name ?? undefined,
        url: item.url ?? undefined,
        category: item.category ?? undefined,
      });
      setSecret('');
      setMode('idle');
      await onChanged();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/vault/items/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Could not remove it (${res.status})`);
      setMode('idle');
      await onChanged();
    } catch (err) {
      // Surfaced, not swallowed. A control that silently does nothing is worse
      // than one that is missing, because the owner believes it worked.
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'editing') {
    return (
      <form onSubmit={save} style={{ marginTop: 'var(--s2)', maxWidth: 460 }}>
        {/*
          The title is editable here because it is the ONE field the family
          reads. It was sent on every update and silently discarded by the route
          until 2026-08-13, so a typo in the name of an account was permanent.
        */}
        {/*
          htmlFor/id, not a bare <label>. An unassociated label is read by a
          screen reader as loose text and the field beside it as unnamed — and
          the ids have to carry the item id because a vault renders many rows.
        */}
        <label
          htmlFor={`title-${item.id}`}
          style={{ display: 'block', fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}
        >
          What it is called
        </label>
        <input
          id={`title-${item.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          style={{
            marginTop: 'var(--s1)',
            marginBottom: 'var(--s2)',
            width: '100%',
            fontSize: 'var(--t2)',
            padding: 'var(--s2)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
          }}
        />
        <label
          htmlFor={`secret-${item.id}`}
          style={{ display: 'block', fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}
        >
          New value for {item.title}. Relay cannot show you the old one — it cannot read it — so
          this replaces it.
        </label>
        <textarea
          id={`secret-${item.id}`}
          required
          rows={2}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="The rotated password, the corrected number, the updated note"
          style={{
            marginTop: 'var(--s1)',
            width: '100%',
            minHeight: 56,
            fontFamily: 'var(--font-mono, ui-monospace)',
            fontSize: 'var(--t2)',
            padding: 'var(--s2)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
          }}
        />
        {error ? (
          <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)' }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
          <button
            type="submit"
            disabled={busy}
            style={{ ...quiet, border: '1px solid var(--rule-strong)', borderRadius: 4, color: 'var(--ink)' }}
          >
            {busy ? 'Encrypting…' : 'Replace it'}
          </button>
          <button type="button" onClick={() => { setMode('idle'); setSecret(''); setTitle(item.title); }} style={{ ...quiet, color: 'var(--ink-muted)' }}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === 'confirming-delete') {
    return (
      <div style={{ marginTop: 'var(--s2)', maxWidth: 460 }}>
        <p style={{ fontSize: 'var(--t1)', color: 'var(--ink)' }}>
          Remove {item.title}? Any access rule pointing at it goes too, so nobody will be left
          holding a grant to something that is not there. This cannot be undone.
        </p>
        {error ? (
          <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)' }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
          <button
            onClick={remove}
            disabled={busy}
            style={{ ...quiet, border: '1px solid var(--clay)', borderRadius: 4, color: 'var(--clay)' }}
          >
            {busy ? 'Removing…' : 'Yes, remove it'}
          </button>
          <button onClick={() => setMode('idle')} style={{ ...quiet, border: '1px solid var(--rule-strong)', borderRadius: 4, color: 'var(--ink)' }}>
            Keep it
          </button>
        </div>
      </div>
    );
  }

  /*
    🔴 REQUIREMENT 11.8 HAD NO CONTROL ANYWHERE. The spec says the owner may
    override any classification and that the override "SHALL NOT be overwritten
    on subsequent re-analyses" — but nothing could be overridden, so the intake
    agent re-decided this from the item's title on every run.

    It is worded as the question an owner can actually answer. "is_root_credential"
    is a schema word; "other accounts reset through this one" is the thing they
    know about their own life, and it is the fact that decides what their family
    is told to do FIRST — a root credential is forced into "Do today" whatever
    the model scored it.

    Tri-state, not a checkbox: setting it back to "let Relay decide" must be
    possible, or an owner who ticks it by accident has permanently overruled the
    agent with no way back.
  */
  async function setRoot(value: boolean | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vault/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner_set_root: value }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const ownerSaid = item.owner_set_root;

  return (
    <div style={{ display: 'flex', gap: 'var(--s1)', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        onClick={() => setRoot(ownerSaid === true ? null : true)}
        disabled={busy}
        title={
          ownerSaid === true
            ? 'You marked this as the one others reset through. Click to let Relay decide again.'
            : 'Mark this as the account others reset through — it will be first in what your family sees.'
        }
        style={{
          ...quiet,
          color: ownerSaid === true ? 'var(--ochre-text)' : 'var(--ink-muted)',
          border: ownerSaid === true ? '1px solid var(--ochre)' : '1px solid transparent',
          borderRadius: 4,
        }}
      >
        {ownerSaid === true ? '★ Others reset through this' : 'Others reset through this'}
      </button>
      <button onClick={() => setMode('editing')} style={{ ...quiet, color: 'var(--ink-muted)' }}>
        Update
      </button>
      <button onClick={() => setMode('confirming-delete')} style={{ ...quiet, color: 'var(--clay)' }}>
        Remove
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
