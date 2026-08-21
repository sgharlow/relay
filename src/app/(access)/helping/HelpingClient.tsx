'use client';

/**
 * The helper's workspace — the missing half of J3.
 *
 * An owner could appoint a helper and record consent, and the person on the
 * other end had no screen at all. `enqueueApproval` was called by nothing, so
 * the owner's approvals queue could never fill; `GET /api/vault/items` took no
 * `?ownerId=`, so an item a helper added vanished on save. Appointing a helper
 * achieved nothing (reassessment, 2026-08-12).
 *
 * ⚠️ WHY THIS LIVES IN THE ACCESS ROUTE GROUP, not the owner one. A helper is
 * not an owner of this vault, and the owner group carries the vault, the
 * circle, the triggers and the account in its chrome. Putting the workspace
 * there would mean every one of those pages having to remember it might be
 * looking at somebody else's data — one forgotten check away from a privilege
 * leak. Here a helper cannot reach a trigger screen because it is not in the
 * tree, which is the structural version of the same guarantee.
 *
 * TWO BOUNDARIES ARE STATED, NOT IMPLIED. What a helper can do, and what they
 * can never do, sits above the tools rather than being discoverable by trying —
 * because a person doing a favour for a parent should not have to find out by
 * experiment that they cannot read what they typed yesterday.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R4, J3-R6, J3-R9
 */

import { useCallback, useEffect, useState } from 'react';

import { CryptoService } from '../../../../lib/crypto/crypto-service';

interface EnteredItem {
  id: string;
  title: string;
  type: string;
  category: string | null;
  created_at: string;
}

interface Proposal {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface Vault {
  ownerId: string;
  ownerLabel: string;
  delegationId: string;
  scopes: string[];
  items: EnteredItem[];
  proposals: Proposal[];
}

const TYPES = ['login', 'account', 'document', 'note', 'instruction'] as const;
const CATEGORIES = [
  'finance', 'health', 'government', 'utilities',
  'communication', 'professional', 'personal', 'other',
] as const;

export default function HelpingClient() {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/helping');
    // Same correction as StandbyClient: a 401 is an expired session, not an
    // outage, and the person it happens to deserves the doors rather than an
    // error that reads as "the product is broken".
    if (res.status === 401) {
      setSignedOut(true);
      return;
    }
    if (!res.ok) {
      setError('We could not load what you are helping with.');
      return;
    }
    setVaults(((await res.json()) as { vaults: Vault[] }).vaults);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (signedOut) {
    return (
      <div>
        <h1 style={{ fontSize: 'var(--t7)', fontWeight: 700, letterSpacing: '-0.01em' }}>
          You are signed out
        </h1>
        <p style={{ fontSize: 'var(--t4)', lineHeight: 1.6, marginTop: 12 }}>
          Nothing is wrong — sessions end on their own after a while.{' '}
          <a href="/auth/signin" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Sign back in
          </a>{' '}
          and this page will be exactly as you left it.
        </p>
      </div>
    );
  }

  if (error) return <p style={{ fontSize: 'var(--t4)' }}>{error}</p>;
  if (!vaults) return <p style={{ fontSize: 'var(--t4)', color: '#6b6257' }}>Loading…</p>;

  if (vaults.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 'var(--t7)', fontWeight: 600 }}>You are not helping anyone yet</h1>
        <p style={{ fontSize: 'var(--t4)', lineHeight: 1.6, marginTop: 10, color: '#6b6257' }}>
          If somebody asks you to help set up their Relay vault, and you both record how you agreed
          to it, their vault will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 'var(--t7)', fontWeight: 600 }}>
        {vaults.length === 1 ? `Helping ${vaults[0].ownerLabel}` : 'People you are helping'}
      </h1>
      {vaults.map((v) => (
        <VaultWorkspace key={v.delegationId} vault={v} onChange={load} />
      ))}
    </div>
  );
}

function VaultWorkspace({ vault, onChange }: { vault: Vault; onChange: () => Promise<void> }) {
  return (
    <section style={{ marginTop: 28 }}>
      {/*
        The boundary, before the tools. A helper who does not know they cannot
        read yesterday's entry will assume the product lost it.
      */}
      <div style={{ padding: 16, borderRadius: 10, background: '#f6f3ee', border: '1px solid #e4ded4' }}>
        <p style={{ fontSize: 'var(--t4)', lineHeight: 1.6 }}>
          <strong>You can add things to {vault.ownerLabel}&rsquo;s vault, and suggest people.</strong>{' '}
          Anything that decides <strong>who can reach what</strong> goes to {vault.ownerLabel} as a
          question — you cannot make that call for them.
        </p>
        <p style={{ fontSize: 'var(--t3)', lineHeight: 1.6, marginTop: 10, color: '#6b6257' }}>
          You cannot open or read anything in their vault — including the things you type here. Once
          an entry is saved it is sealed to them, so check it before you save it. That is deliberate:
          it is what makes it safe for them to accept help.
        </p>
      </div>

      <AddItem vault={vault} onSaved={onChange} />

      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, marginTop: 28 }}>What you have added</h2>
      {vault.items.length === 0 ? (
        <p style={{ fontSize: 'var(--t3)', marginTop: 8, color: '#6b6257' }}>Nothing yet.</p>
      ) : (
        <ul style={{ marginTop: 10, paddingLeft: 0, listStyle: 'none' }}>
          {vault.items.map((i) => (
            <li
              key={i.id}
              style={{
                fontSize: 'var(--t4)', padding: '10px 14px', borderRadius: 8,
                background: '#fffdf9', border: '1px solid #e4ded4', marginBottom: 8,
              }}
            >
              {i.title}
              <span style={{ color: '#6b6257', fontSize: 'var(--t3)' }}>
                {' '}· {i.type}
                {i.category ? ` · ${i.category}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ProposePerson vault={vault} onProposed={onChange} />

      {vault.proposals.length > 0 && (
        <>
          <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, marginTop: 28 }}>
            Waiting for {vault.ownerLabel}
          </h2>
          <ul style={{ marginTop: 10, paddingLeft: 0, listStyle: 'none' }}>
            {vault.proposals.map((p) => (
              <li
                key={p.id}
                style={{
                  fontSize: 'var(--t4)', padding: '10px 14px', borderRadius: 8,
                  background: '#fdf6ea', border: '1px solid #e8d9b8', marginBottom: 8,
                }}
              >
                {String(p.payload.name ?? 'Someone')} — suggested as someone who would step in
                {p.kind === 'self_designation' ? ' (that is you)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AddItem({ vault, onSaved }: { vault: Vault; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('login');
  const [category, setCategory] = useState<string>('finance');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      style={{ marginTop: 20, padding: 16, borderRadius: 10, background: '#fffdf9', border: '1px solid #e4ded4' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        setMsg(null);
        try {
          // Encrypted in this browser before anything is sent, exactly as it is
          // for an owner. The delegation is checked server-side; passing the id
          // grants nothing on its own.
          await new CryptoService().saveItem(secret, { type: type as never, title, category: category as never }, vault.ownerId);
          setTitle('');
          setSecret('');
          setMsg('Saved. It is sealed to them now.');
          await onSaved();
        } catch {
          setErr('We could not save that. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>Add something</h2>

      <label htmlFor="h-title" style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600, marginTop: 12 }}>
        What is it?
      </label>
      <input
        id="h-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Electricity account"
        style={fieldStyle}
      />

      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 160px' }}>
          <span style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600 }}>Kind</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={fieldStyle}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ flex: '1 1 160px' }}>
          <span style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600 }}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <label htmlFor="h-secret" style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600, marginTop: 12 }}>
        The details they would need
      </label>
      <p style={{ fontSize: 'var(--t3)', lineHeight: 1.5, color: '#6b6257', marginTop: 2 }}>
        Account number, sign-in, where the paperwork is — whatever would actually help. This is
        encrypted before it leaves this page, and you will not be able to read it back.
      </p>
      <textarea
        id="h-secret"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        rows={4}
        style={{ ...fieldStyle, lineHeight: 1.5 }}
      />

      {err ? <p role="alert" style={{ fontSize: 'var(--t3)', color: '#9a3412', marginTop: 10 }}>{err}</p> : null}
      {msg ? <p role="status" style={{ fontSize: 'var(--t3)', color: '#365547', marginTop: 10 }}>{msg}</p> : null}

      <button type="submit" disabled={busy || !title.trim() || !secret.trim()} style={primaryStyle(busy || !title.trim() || !secret.trim())}>
        {busy ? 'Saving…' : 'Save to their vault'}
      </button>
    </form>
  );
}

function ProposePerson({ vault, onProposed }: { vault: Vault; onProposed: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('recipient');
  const [self, setSelf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <form
      style={{ marginTop: 28, padding: 16, borderRadius: 10, background: '#fffdf9', border: '1px solid #e4ded4' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
          const res = await fetch('/api/approvals', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ownerId: vault.ownerId,
              kind: self ? 'self_designation' : 'recipient',
              payload: { name, email, role },
            }),
          });
          if (!res.ok) {
            const b = (await res.json().catch(() => ({}))) as { message?: string };
            setErr(b.message ?? 'We could not send that suggestion.');
            return;
          }
          setName('');
          setEmail('');
          setSent(true);
          await onProposed();
        } catch {
          setErr('We could not reach the server. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>Suggest someone who would step in</h2>
      <p style={{ fontSize: 'var(--t3)', lineHeight: 1.6, marginTop: 4, color: '#6b6257' }}>
        This does not add them. It goes to {vault.ownerLabel} as a question, and only they can say
        yes.
      </p>

      {sent ? (
        <p role="status" style={{ fontSize: 'var(--t3)', color: '#365547', marginTop: 10 }}>
          Sent. It is waiting for {vault.ownerLabel} to answer.
        </p>
      ) : null}

      <label htmlFor="p-name" style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600, marginTop: 12 }}>Their name</label>
      <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />

      <label htmlFor="p-email" style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600, marginTop: 12 }}>Their email</label>
      <input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} />

      <label htmlFor="p-role" style={{ display: 'block', fontSize: 'var(--t3)', fontWeight: 600, marginTop: 12 }}>How would you describe them?</label>
      <select id="p-role" value={role} onChange={(e) => setRole(e.target.value)} style={fieldStyle}>
        {/*
          was: ['recipient', 'partner', 'caregiver', 'executor'] — a second,
          hand-copied version of VALID_ROLES. `executor` is gone for the reason
          recorded on the owner's own form in PeopleSections.tsx: /terms says
          there is no executor role, and estate was withdrawn permanently on
          2026-08-14, so the label promised a capability and did nothing.
          role-options.test.ts reads both selects, because they are two lists.
        */}
        {['recipient', 'partner', 'caregiver'].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      {/*
        J3-R6's reason for existing. A helper proposing THEMSELVES is the single
        most dangerous thing they can ask for, so it is offered plainly and
        labelled on the way past rather than hidden — hiding it would only mean
        somebody typing their own name into the field above and nobody noticing.
      */}
      <label style={{ display: 'flex', gap: 10, marginTop: 14, fontSize: 'var(--t3)' }}>
        {/*
          `flexShrink: 0` because without it the flex row squashed this to 13x20
          — a visibly lopsided box on the single most consequential control a
          helper has. The HIT AREA was never the problem: the input sits inside
          the label, so the real target is 294x122 and clicking the text toggles
          it. This is about the affordance looking broken, not about reaching it.
        */}
        <input
          type="checkbox"
          checked={self}
          onChange={(e) => setSelf(e.target.checked)}
          style={{ marginTop: 3, width: 20, height: 20, flexShrink: 0 }}
        />
        <span>
          This is me.
          <span style={{ display: 'block', color: '#6b6257', fontSize: 'var(--t3)' }}>
            Perfectly reasonable to ask — and {vault.ownerLabel} will be told clearly that the
            person suggesting it is the person it is about.
          </span>
        </span>
      </label>

      {err ? <p role="alert" style={{ fontSize: 'var(--t3)', color: '#9a3412', marginTop: 10 }}>{err}</p> : null}

      <button type="submit" disabled={busy || !name.trim() || !email.trim()} style={primaryStyle(busy || !name.trim() || !email.trim())}>
        {busy ? 'Sending…' : `Suggest to ${vault.ownerLabel}`}
      </button>
    </form>
  );
}

const fieldStyle: React.CSSProperties = {
  marginTop: 6,
  width: '100%',
  minHeight: 48,
  fontSize: 'var(--t4)',
  padding: '0 12px',
  border: '1px solid #cfc7ba',
  borderRadius: 8,
  background: '#fffdf9',
};

function primaryStyle(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 16,
    minHeight: 48,
    padding: '0 22px',
    fontSize: 'var(--t4)',
    fontWeight: 600,
    color: '#fffdf9',
    background: '#211d18',
    border: 'none',
    borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
