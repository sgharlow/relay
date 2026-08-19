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
import { encodeSecretPayload } from '../../../../lib/crypto/secret-payload';
import type { DashboardItem } from '../../../../lib/vault/dashboard-view';
import { parseFactorList } from '../../../../lib/vault/usability';
import { setFactorsRequired, type DeclarableFactor } from '../../../../lib/vault/declare-factors';
import type { VaultItemType } from '../../../../lib/domain/enums';

type Mode = 'idle' | 'editing' | 'noting' | 'confirming-delete';

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
  const [username, setUsername] = useState('');
  const [totp, setTotp] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState('');
  const [note, setNote] = useState(item.backup_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Metadata-only save — no crypto, no secret. Sends `null` when the box is
   * emptied, which genuinely clears the note: an owner who wrote down where
   * something was kept and then moved it has to be able to take that back.
   */
  async function saveNote() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const res = await fetch(`/api/vault/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backup_note: trimmed.length > 0 ? trimmed : null }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      setMode('idle');
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--t1)',
    color: 'var(--ink-muted)',
  };
  const fieldBox: React.CSSProperties = {
    marginTop: 'var(--s1)',
    width: '100%',
    fontSize: 'var(--t2)',
    padding: 'var(--s2)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 4,
  };

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
      /*
        REPLACES, and says so — it does not merge. True field-level editing would
        mean decrypting the current payload here first, and there is no
        single-item ciphertext endpoint to fetch it from: the GET was retired on
        2026-08-13, and `/api/account/export` is the whole vault behind a step-up.

        Adding one is a new server surface over ciphertext and belongs to a phase
        that can carry that decision, not to this one. Replacing everything the
        owner can see, with the form saying so, is the honest version of what the
        product already did — and it cannot silently drop a field, because every
        field is on screen.
      */
      await new CryptoService().updateItemSecret(item.id, encodeSecretPayload([
        { kind: 'username', value: username },
        { kind: 'password', value: secret },
        { kind: 'totp', value: totp },
        { kind: 'recovery_codes', value: recoveryCodes },
      ]), {
        type: item.type as VaultItemType,
        title: title.trim() || item.title,
        service_name: item.service_name ?? undefined,
        url: item.url ?? undefined,
        category: item.category ?? undefined,
      });
      setSecret('');
      setUsername('');
      setTotp('');
      setRecoveryCodes('');
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
          everything you enter here replaces what is stored, including any fields you leave blank.
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
        {/*
          The other three parts of a credential, so "everything you enter here
          replaces what is stored" is literally true rather than nearly true.
          Until 2026-08-17 the only thing an item could hold was the password —
          which meant an owner with a 2FA-protected account was handing their
          family a password and a locked door.
        */}
        <div style={{ display: 'grid', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
          <div>
            <label htmlFor={`user-${item.id}`} style={fieldLabel}>Username</label>
            <input id={`user-${item.id}`} value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="off" placeholder="Optional" style={fieldBox} />
          </div>
          <div>
            <label htmlFor={`totp-${item.id}`} style={fieldLabel}>Two-factor code</label>
            <input id={`totp-${item.id}`} value={totp} onChange={(e) => setTotp(e.target.value)}
              autoComplete="off" spellCheck={false}
              placeholder="otpauth://totp/… or the setup key"
              style={{ ...fieldBox, fontFamily: 'var(--font-mono, ui-monospace)' }} />
          </div>
          <div>
            <label htmlFor={`codes-${item.id}`} style={fieldLabel}>Recovery codes</label>
            <textarea id={`codes-${item.id}`} rows={2} value={recoveryCodes}
              onChange={(e) => setRecoveryCodes(e.target.value)} placeholder="One per line"
              style={{ ...fieldBox, fontFamily: 'var(--font-mono, ui-monospace)' }} />
          </div>
        </div>
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

  if (mode === 'noting') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveNote();
        }}
        style={{ marginTop: 'var(--s2)', maxWidth: 460 }}
      >
        <label htmlFor={`note-${item.id}`} style={{ display: 'block', fontSize: 'var(--t1)' }}>
          What should they know about {item.title}?
        </label>
        <textarea
          id={`note-${item.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Everything else resets through this one. The codes are in the desk drawer."
          style={{
            width: '100%',
            marginTop: 'var(--s1)',
            padding: 'var(--s2)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--t2)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
          }}
        />
        {/*
          Same warning as the create form, and load-bearing for the same reason:
          this field is metadata, stored in clear and read by the AI agents,
          sitting inside a product whose entire promise is that it cannot read
          what you store. Saying it once on one form would leave the other one
          quietly inviting a plaintext password.
        */}
        <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
          <strong>Not encrypted</strong> — unlike the value itself, so never a password or a code
          here. They see this when access opens, and not before.
        </p>
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
          <button type="submit" disabled={busy} style={{ ...quiet, color: 'var(--ink)' }}>
            {busy ? 'Saving…' : 'Save note'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('idle');
              setNote(item.backup_note ?? '');
            }}
            style={{ ...quiet, color: 'var(--ink-muted)' }}
          >
            Cancel
          </button>
          {error ? (
            <span role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)' }}>
              {error}
            </span>
          ) : null}
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
  /**
   * The owner's answer to "could this be replaced?" — migration 034.
   *
   * 🔴 THEY COULD OVERRULE THE AGENT ABOUT ROOT CREDENTIALS AND NOT ABOUT THIS,
   * which is the higher-consequence of the two. `irreplaceable` is what raises a
   * CUSTODY_RISK — a deed, a will, a passport — and only the intake agent could
   * ever set it, from the title alone. If it judged a passport replaceable, the
   * warning was never raised and nothing on this screen hinted a judgement had
   * been made at all.
   */
  async function setIrreplaceable(value: boolean | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vault/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner_set_irreplaceable: value }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Does this account also ask for a code?" — the owner's answer to what the
   * ACCOUNT demands, which the server cannot infer and the browser cannot
   * either. Until it is answered, `assessPreparedness` counts an item as
   * reachable whenever an access rule exists, so an owner storing only the
   * password for a 2FA account is told their recipient could reach it. They
   * receive a password and a locked door.
   *
   * ⚠️ THREE STATES, AND THE THIRD IS NOT A NEUTRAL DEFAULT. `null` means
   * nobody has asked — it changes nothing on screen, deliberately, because
   * reading it as "demands nothing" keeps the lie and reading it as "demands
   * something" alarms every owner about every item on one afternoon, which
   * destroys the signal permanently rather than temporarily (design Q1/Q3).
   *
   * ONE FACTOR, NOT SIX. `REQUIRABLE_FACTORS` has six members; this control
   * asks about `totp` alone, because that is the demand an owner can actually
   * satisfy from a vault — recovery codes and a stored seed both answer it. An
   * SMS code or a hardware key cannot be put in a vault at all, so asking about
   * them here would collect an answer the product can do nothing with. The
   * fuller declaration is queued as its own item.
   */
  async function setNeedsCode(value: DeclarableFactor[] | null) {
    setBusy(true);
    setError(null);
    try {
      // The save itself lives in `declare-factors` — the banner's prompt asks
      // the same question and must record it identically. See that module's
      // note on why `[]` and `null` are not interchangeable.
      await setFactorsRequired(item.id, value);
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

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
  const ownerSaidIrreplaceable = item.owner_set_irreplaceable;
  /*
    `null` (never asked) is kept apart from `[]` (asked, answered "nothing").
    `parseFactorList` is the one definition of that split — reimplementing the
    parse here would be a second one, which is how the two drift.
  */
  const needsCode = parseFactorList(item.factors_required ?? null);

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
      {/*
        🔴 THE NOTE WAS ONLY AVAILABLE TO NEW ITEMS UNTIL THIS EXISTED. It went on
        the create form on 2026-08-17, but the only other write path — "Update" —
        demands a re-encrypted secret, because that form replaces the value
        rather than editing it. So adding a note to something already in the
        vault meant retyping its password, and detectGaps went on flagging every
        pre-existing item with advice its owner still could not act on.

        Deliberately its own control rather than a field inside "Update": these
        are different acts. One replaces a secret Relay cannot read; this one
        edits a sentence it can. Putting them on the same form would mean asking
        for a password in order to fix a typo.
      */}
      {/*
        Third state matters as much as the first two, so the cycle is
        yes -> cleared, exactly like the root control beside it: an owner who
        ticks this by mistake must be able to hand the decision back to the
        agent rather than being stuck having overruled it.
      */}
      <button
        onClick={() => setIrreplaceable(ownerSaidIrreplaceable === true ? null : true)}
        disabled={busy}
        title={
          ownerSaidIrreplaceable === true
            ? 'You marked this as impossible to replace. Click to let Relay decide again.'
            : 'Mark this as impossible to replace — a deed, a will, a passport. It will be flagged if nobody can reach it.'
        }
        style={{
          ...quiet,
          color: ownerSaidIrreplaceable === true ? 'var(--clay)' : 'var(--ink-muted)',
          border: ownerSaidIrreplaceable === true ? '1px solid var(--clay)' : '1px solid transparent',
          borderRadius: 4,
        }}
      >
        {ownerSaidIrreplaceable === true ? 'Cannot be replaced' : 'Cannot be replaced?'}
      </button>
      {/*
        Cycles ask → needs a code → needs nothing → ask, so every state is
        reachable and revocable from one control, matching the two overrides
        beside it. Ochre, not clay: declaring a demand is a fact about the
        account, not something irreversible.
      */}
      <button
        onClick={() =>
          setNeedsCode(needsCode === null ? ['totp'] : needsCode.includes('totp') ? [] : null)
        }
        disabled={busy}
        title={
          needsCode === null
            ? 'Say whether this account asks for a code as well as a password. Until you do, Relay cannot tell whether anyone could really get in.'
            : needsCode.includes('totp')
              ? 'You said this account asks for a code. Click to say it does not.'
              : 'You said a password is enough here. Click to stop answering.'
        }
        style={{
          ...quiet,
          color: needsCode?.includes('totp') ? 'var(--ochre)' : 'var(--ink-muted)',
          border: needsCode?.includes('totp')
            ? '1px solid var(--ochre)'
            : '1px solid transparent',
          borderRadius: 4,
        }}
      >
        {needsCode === null
          ? 'Needs a code?'
          : needsCode.includes('totp')
            ? 'Needs a code'
            : 'Password is enough'}
      </button>
      <button onClick={() => setMode('noting')} style={{ ...quiet, color: 'var(--ink-muted)' }}>
        {item.backup_note ? 'Edit note' : 'Add note'}
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
