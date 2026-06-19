'use client';

/**
 * Add vault item (Requirement 1, 2 / task 12.2 CTA).
 *
 * Collects non-secret metadata + the secret value, then runs the full
 * client-side envelope flow via CryptoService.saveItem: POST /api/kms/wrap →
 * AES-GCM encrypt in-browser → POST /api/vault/items. The plaintext never leaves
 * the browser. On success, returns to the vault.
 *
 * Feature: relay-h0-mvp
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  VALID_TYPES,
  VALID_CATEGORIES,
  VALID_CRITICALITY,
  type VaultItemType,
} from '../../../../../lib/domain/enums';
import { CryptoService } from '../../../../../lib/crypto/crypto-service';

const inputCls =
  'w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function NewVaultItemPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    type: 'login' as VaultItemType,
    service_name: '',
    url: '',
    category: '',
    criticality: 'medium',
    secret: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await new CryptoService().saveItem(form.secret, {
        type: form.type,
        title: form.title,
        service_name: form.service_name || undefined,
        url: form.url || undefined,
        category: form.category || undefined,
        criticality: form.criticality || undefined,
      });
      router.push('/vault');
      router.refresh();
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Add item</h1>
        <p className="text-sm text-slate-500">The secret is encrypted in your browser before it is sent.</p>
      </header>

      <form onSubmit={submit} className="space-y-4 rounded border border-slate-200 bg-white p-5">
        <Field label="Title">
          <input className={inputCls} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Gmail" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as VaultItemType })}>
              {VALID_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Criticality">
            <select className={inputCls} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
              {VALID_CRITICALITY.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Service name (optional)">
            <input className={inputCls} value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} placeholder="Google" />
          </Field>
          <Field label="Category (optional)">
            <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>
              {VALID_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="URL (optional)">
          <input className={inputCls} type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
        </Field>

        <Field label="Secret value">
          <textarea className={`${inputCls} font-mono`} required rows={3} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Password, note, or instructions — encrypted before upload" />
        </Field>

        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? 'Encrypting…' : 'Save item'}
          </button>
          <button type="button" onClick={() => router.push('/vault')} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      {children}
    </label>
  );
}
