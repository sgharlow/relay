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
import { encodeSecretPayload, type SecretField } from '../../../../../lib/crypto/secret-payload';

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
    username: '',
    totp: '',
    recovery_codes: '',
    backup_note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      /*
        One ciphertext blob, as before — the structure lives INSIDE it, so
        nothing about KMS, the recipient decrypt path or the release machine
        changes. `encodeSecretPayload` drops empty fields, so an item with only a
        password encodes exactly as it always did in substance.
      */
      const fields: SecretField[] = [
        { kind: 'username', value: form.username },
        { kind: 'password', value: form.secret },
        { kind: 'totp', value: form.totp },
        { kind: 'recovery_codes', value: form.recovery_codes },
      ];
      /*
        No `secret_kinds` passed here, deliberately. It is derived inside
        `encryptForUpload` from the plaintext it is about to encrypt, and any
        value passed here would be ignored — so passing one would be a second,
        droppable definition of a fact that now has exactly one home. Every
        write path gets the declaration for free by going through that one
        function; this one used to be the only path that declared, which was the
        Phase-1 bug.
      */
      await new CryptoService().saveItem(encodeSecretPayload(fields), {
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

        <Field label="Username (optional)">
          <input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="The email or name you sign in with" autoComplete="off" />
        </Field>

        <Field label="Secret value">
          <textarea className={`${inputCls} font-mono`} required rows={3} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Password, note, or instructions — encrypted before upload" />
        </Field>

        {/*
          🔴 A PASSWORD ALONE IS NOT ACCESS, and until 2026-08-17 a password was
          all this form could take. An owner storing a 2FA-protected account was
          handing their family a password and a locked door, while the vault
          reported them covered.

          The seed is stored, and the RECIPIENT'S browser turns it into the live
          six digits — handing somebody `JBSWY3DPEHPK3PXP` and expecting them to
          enrol it in an authenticator app during the worst week of their life is
          not a plan.

          ⚠️ A PASSKEY CANNOT GO HERE, and no field would help. It is bound to a
          device and cannot be handed over by anyone. For those accounts the only
          useful thing is the recovery route: name what recovers it, and say so
          in the note below.
        */}
        <Field label="Two-factor code (optional)">
          <input
            className={`${inputCls} font-mono`}
            value={form.totp}
            onChange={(e) => setForm({ ...form, totp: e.target.value })}
            placeholder="otpauth://totp/… or the setup key"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-t1 text-muted">
            From your authenticator app&rsquo;s &ldquo;can&rsquo;t scan the code?&rdquo; text. Whoever
            you name will get the six digits, not this.
          </p>
        </Field>

        <Field label="Recovery codes (optional)">
          <textarea
            className={`${inputCls} font-mono`}
            rows={2}
            value={form.recovery_codes}
            onChange={(e) => setForm({ ...form, recovery_codes: e.target.value })}
            placeholder="One per line — the backup codes the service gave you"
          />
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
