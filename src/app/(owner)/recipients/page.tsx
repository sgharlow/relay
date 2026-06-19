'use client';

/**
 * Recipients & Verifiers screen (Requirement 3.1, 3.2 / task 12.3).
 *
 * Lists and creates recipients (name, relationship, email, phone, role) and
 * verifiers (name, email, phone), with inline validation errors from the API.
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useState } from 'react';
import { VALID_ROLES, type RecipientRole } from '../../../../lib/domain/enums';
import { apiGet, apiSend } from '../_lib/api';

interface Recipient {
  id: string;
  name: string;
  relationship: string | null;
  email: string;
  phone: string | null;
  role: RecipientRole;
}
interface Verifier {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  verification_status: string;
}

const inputCls =
  'w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [verifiers, setVerifiers] = useState<Verifier[]>([]);

  const load = useCallback(async () => {
    const [r, v] = await Promise.all([
      apiGet<{ recipients: Recipient[] }>('/api/recipients'),
      apiGet<{ verifiers: Verifier[] }>('/api/verifiers'),
    ]);
    setRecipients(r.recipients);
    setVerifiers(v.verifiers);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Recipients &amp; Verifiers</h1>
        <p className="text-sm text-slate-500">People who receive access, and those who confirm a trigger.</p>
      </header>

      <RecipientSection items={recipients} onChange={load} />
      <VerifierSection items={verifiers} onChange={load} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

function RecipientSection({ items, onChange }: { items: Recipient[]; onChange: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', relationship: '', email: '', phone: '', role: 'recipient' as RecipientRole });
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
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Recipients</h2>
      <ul className="mb-4 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
        {items.length === 0 ? <li className="px-4 py-3 text-sm text-slate-400">No recipients yet.</li> : null}
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <span className="font-medium">{r.name}</span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{r.role}</span>
              <div className="text-xs text-slate-500">
                {r.email}
                {r.relationship ? ` · ${r.relationship}` : ''}
              </div>
            </div>
            <button onClick={() => remove(r.id)} className="text-xs text-red-600 hover:underline">
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <input className={inputCls} placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RecipientRole })}>
          {VALID_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <input className={inputCls} placeholder="Relationship (optional)" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
        <input className={inputCls} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          Add recipient
        </button>
        {error ? <p role="alert" className="col-span-full text-sm text-red-600">{error}</p> : null}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Verifiers
// ---------------------------------------------------------------------------

function VerifierSection({ items, onChange }: { items: Verifier[]; onChange: () => Promise<void> }) {
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
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Verifiers</h2>
      <ul className="mb-4 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
        {items.length === 0 ? <li className="px-4 py-3 text-sm text-slate-400">No verifiers yet.</li> : null}
        {items.map((v) => (
          <li key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <span className="font-medium">{v.name}</span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{v.verification_status}</span>
              <div className="text-xs text-slate-500">{v.email}</div>
            </div>
            <button onClick={() => remove(v.id)} className="text-xs text-red-600 hover:underline">
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <input className={inputCls} placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className={inputCls} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:col-start-3">
          Add verifier
        </button>
        {error ? <p role="alert" className="col-span-full text-sm text-red-600">{error}</p> : null}
      </form>
    </section>
  );
}
