'use client';

/**
 * Adding and removing the people you trust.
 *
 * Moved here from /recipients so that "People" is ONE destination. The audit
 * found two nav entries for one idea — "Recipients & Verifiers" and "Your
 * circle" — which asked the owner to know an internal distinction in order to
 * find anything. The assessment (who covers what, what nobody can reach) and
 * the management (add, remove) belong on the same screen, because the whole
 * reason to add someone is the gap the assessment just showed you.
 *
 * First components drawn on the design system rather than ad-hoc Tailwind:
 * tokens for every colour, size and space, ink-on-paper, and clay reserved for
 * removal — the only irreversible thing on this screen.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1, 3.2, J4-R2
 */

import { useState } from 'react';

import { apiSend } from '../_lib/api';
import { VALID_ROLES, type RecipientRole } from '../../../../lib/domain/enums';
import { readStandbyState, circleLight } from '../../../../lib/people/standby-state';

/*
  Display shapes, deliberately wider than the form's. /api/circle returns role
  as a plain string and omits verification_status; the create form has its own
  strictly-typed state. Narrowing these would force a second round of fetches
  for two labels.
*/
export interface Recipient {
  id: string;
  name: string;
  email: string;
  relationship?: string | null;
  role: string;
  standby_state?: string;
}

export interface Verifier {
  id: string;
  name: string;
  email: string;
  /** @deprecated dead column — see StandbyLight below. */
  verification_status?: string;
  standby_state?: string;
}

/**
 * Three positions, and green is a claim about CAPABILITY.
 *
 * This replaces a chip that rendered `verification_status` — a column declared
 * NOT NULL DEFAULT 'pending' in migration 001 and written by nothing, so every
 * person in every circle showed the word "pending" forever. It looked like
 * status and carried none.
 *
 * Red is honest right now: claiming does not exist until the identity sprint, so
 * nobody has an account yet and nobody can act through one. The existing
 * invitation path still works for them meanwhile.
 */
function StandbyLight({ state }: { state?: string }) {
  const s = readStandbyState(state);
  const light = circleLight(s);

  const tone = {
    green: { dot: 'var(--ok, #2e7d32)', label: 'Ready' },
    amber: { dot: 'var(--warn, #b26a00)', label: 'Claimed — confirm it is really them' },
    red: { dot: 'var(--rule-strong)', label: s === 'revoked' ? 'Removed' : 'Not claimed yet' },
  }[light];

  return (
    <span
      title={tone.label}
      style={{
        marginLeft: 'var(--s2)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: 'var(--t1)',
        color: 'var(--ink-muted)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: tone.dot,
          display: 'inline-block',
        }}
      />
      {tone.label}
    </span>
  );
}

const field: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t2)',
  padding: 'var(--s2) var(--s3)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
  color: 'var(--ink)',
};

const primaryButton: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t2)',
  fontWeight: 600,
  padding: 'var(--s2) var(--s4)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
};

const card: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
};

function SectionHeading({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, letterSpacing: '-0.01em' }}>{children}</h2>
      <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>{hint}</p>
    </div>
  );
}

/** Removal is the one irreversible action here, so it is the one thing in clay. */
function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--t1)',
        color: 'var(--clay)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 'var(--s1) var(--s2)',
      }}
    >
      Remove
    </button>
  );
}

export function RecipientSection({
  items,
  onChange,
}: {
  items: Recipient[];
  onChange: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: '',
    relationship: '',
    email: '',
    phone: '',
    role: 'recipient' as RecipientRole,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiSend('/api/recipients', 'POST', form);
      setForm({ name: '', relationship: '', email: '', phone: '', role: 'recipient' });
      await onChange();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await apiSend(`/api/recipients/${id}`, 'DELETE').catch(() => {});
    await onChange();
  }

  return (
    <section>
      <SectionHeading hint="The people who would receive access. Nothing opens for them until a trigger fires and someone confirms it is real.">
        Who would step in
      </SectionHeading>

      <ul style={{ ...card, listStyle: 'none', padding: 0, margin: `0 0 var(--s4)` }}>
        {items.length === 0 ? (
          <li style={{ padding: 'var(--s3) var(--s4)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody yet. A vault with no one named cannot open for anyone.
          </li>
        ) : null}
        {items.map((r) => (
          <li
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              borderTop: '1px solid var(--rule)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--t3)', fontWeight: 500 }}>{r.name}</span>
              <span
                style={{
                  marginLeft: 'var(--s2)',
                  fontSize: 'var(--t1)',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-owner)',
                  background: 'var(--paper-sunken)',
                  color: 'var(--ink-muted)',
                }}
              >
                {r.role}
              </span>
              <StandbyLight state={r.standby_state} />
              <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
                {r.email}
                {r.relationship ? ` · ${r.relationship}` : ''}
              </div>
            </div>
            <RemoveButton onClick={() => remove(r.id)} label={`Remove ${r.name}`} />
          </li>
        ))}
      </ul>

      <form
        onSubmit={add}
        style={{ ...card, display: 'grid', gap: 'var(--s2)', padding: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <input style={field} placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input style={field} type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select style={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RecipientRole })}>
          {VALID_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <input style={field} placeholder="Relationship (optional)" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
        <input style={field} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
          Add this person
        </button>
        {error ? (
          <p role="alert" style={{ gridColumn: '1 / -1', fontSize: 'var(--t2)', color: 'var(--clay)' }}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function VerifierSection({
  items,
  onChange,
}: {
  items: Verifier[];
  onChange: () => Promise<void>;
}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiSend('/api/verifiers', 'POST', form);
      setForm({ name: '', email: '', phone: '' });
      await onChange();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await apiSend(`/api/verifiers/${id}`, 'DELETE').catch(() => {});
    await onChange();
  }

  return (
    <section>
      <SectionHeading hint="They confirm an emergency is real. They never see anything inside your vault — not now, and not after they answer.">
        Who confirms it is real
      </SectionHeading>

      <ul style={{ ...card, listStyle: 'none', padding: 0, margin: `0 0 var(--s4)` }}>
        {items.length === 0 ? (
          <li style={{ padding: 'var(--s3) var(--s4)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody yet. One is fragile — they might be on the flight with you.
          </li>
        ) : null}
        {items.map((v) => (
          <li
            key={v.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              borderTop: '1px solid var(--rule)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--t3)', fontWeight: 500 }}>{v.name}</span>
              <StandbyLight state={v.standby_state} />
              <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>{v.email}</div>
            </div>
            <RemoveButton onClick={() => remove(v.id)} label={`Remove ${v.name}`} />
          </li>
        ))}
      </ul>

      <form
        onSubmit={add}
        style={{ ...card, display: 'grid', gap: 'var(--s2)', padding: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <input style={field} placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input style={field} type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input style={field} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
          Add a verifier
        </button>
        {error ? (
          <p role="alert" style={{ gridColumn: '1 / -1', fontSize: 'var(--t2)', color: 'var(--clay)' }}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
