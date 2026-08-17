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
  'w-full rounded border border-rule-strong px-2.5 py-1.5 text-t2 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink';

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
    backup_note: '',
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
        backup_note: form.backup_note || undefined,
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
        <h1 className="text-t7 font-semibold tracking-tight">Add item</h1>
        <p className="text-t2 text-muted">The secret is encrypted in your browser before it is sent.</p>
      </header>

      <form onSubmit={submit} className="space-y-4 rounded border border-rule bg-paper-raised p-5">
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

        {/*
          🔴 THE VAULT ASKED FOR THIS NOTE AND HAD NOWHERE TO PUT IT. `backup_note`
          has been in the schema since migration 001 and is what `detectGaps` reads
          to decide CUSTODY_RISK and MISSING_NOTE — but no form, API or write path
          ever set it, so every item in every real vault carried a permanent gap
          telling the owner to add a note they could not add.

          ⚠️ THE "not encrypted" LINE IS LOAD-BEARING, NOT A DISCLAIMER. Every other
          field on this form that holds anything sensitive goes through the envelope
          flow. This one does not: it is metadata, stored in clear, and read by the
          AI agents. Without that sentence directly under a box on a page headed
          "the secret is encrypted in your browser", people would reasonably type a
          password into it — which would put a plaintext secret on a server path,
          the single thing the architecture exists to prevent.
        */}
        <Field label="Note for your recipient (optional)">
          <textarea
            className={inputCls}
            rows={2}
            value={form.backup_note}
            onChange={(e) => setForm({ ...form, backup_note: e.target.value })}
            placeholder="e.g. This is the account everything else resets through. Recovery codes are in the desk drawer."
          />
          <p className="mt-1 text-t1 text-muted">
            <strong className="font-semibold">Not encrypted</strong> — unlike the secret above, so
            never put a password or a code here. Say what the account is for, or how to get in if the
            password no longer works.
          </p>
        </Field>

        {error ? <p role="alert" className="text-t2 text-clay">{error}</p> : null}

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink disabled:opacity-60">
            {busy ? 'Encrypting…' : 'Save item'}
          </button>
          <button type="button" onClick={() => router.push('/vault')} className="rounded border border-rule-strong px-3 py-1.5 text-t2 font-medium hover:bg-paper-sunken">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-t2">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}
