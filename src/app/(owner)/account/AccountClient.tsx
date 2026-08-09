'use client';

/**
 * Export and account closure.
 *
 * The export DECRYPTS IN THE BROWSER. The server holds ciphertext it cannot
 * read, so a server-produced file would either contain unreadable blobs — not
 * "what you have stored" — or require a plaintext path that breaks the guarantee
 * the product is sold on. So the page fetches the encrypted material, unwraps
 * each key through the KMS proxy, decrypts locally, and assembles the file here.
 *
 * That has a visible consequence worth being honest about: exporting a large
 * vault takes a moment and needs the network per item. Progress is shown rather
 * than hidden behind a spinner that looks stuck.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1, J13-R2
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CryptoService, base64ToBytes, unpackIvCiphertext } from '../../../../lib/crypto/crypto-service';

interface ExportItem {
  id: string;
  type: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  ciphertext: string;
  wrapped_data_key: string;
  created_at: string;
}

interface ExportPayload {
  exportedAt: string;
  owner: { email: string; display_name: string | null };
  items: ExportItem[];
  recipients: Array<{ name: string; email: string; role: string }>;
  verifiers: Array<{ name: string; email: string }>;
}

export default function AccountClient() {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [nameSaved, setNameSaved] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  async function onExport() {
    setError(null);
    setProgress('Fetching your vault…');
    try {
      const res = await fetch('/api/account/export');
      if (!res.ok) throw new Error('Could not read your vault.');
      const data = (await res.json()) as ExportPayload;

      const crypto = new CryptoService();
      const items: Array<Record<string, unknown>> = [];

      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        setProgress(`Decrypting ${i + 1} of ${data.items.length}…`);

        let secret: string;
        try {
          const un = await fetch('/api/kms/unwrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wrapped_data_key: item.wrapped_data_key, vault_item_id: item.id }),
          });
          if (!un.ok) throw new Error('unwrap failed');
          const { plaintext_data_key } = (await un.json()) as { plaintext_data_key: string };
          const { iv, ciphertext } = unpackIvCiphertext(base64ToBytes(item.ciphertext));
          secret = await crypto.decryptItem(ciphertext, iv, plaintext_data_key);
        } catch {
          // One unreadable item must not cost the owner the other 199. Mark it
          // and carry on — a partial export they can see the holes in beats no
          // export at all.
          secret = '⚠️ Could not be decrypted — contact us before relying on this export.';
        }

        items.push({
          title: item.title,
          service: item.service_name,
          url: item.url,
          category: item.category,
          criticality: item.criticality,
          type: item.type,
          secret,
          created_at: item.created_at,
        });
      }

      const file = {
        relay_export: 1,
        exported_at: data.exportedAt,
        owner: data.owner,
        items,
        recipients: data.recipients,
        verifiers: data.verifiers,
      };

      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relay-export-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setProgress(`Exported ${items.length} item${items.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setProgress(null);
      setError(String((err as Error).message));
    }
  }

  async function onDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setDeleting(false);
        setError(data.message ?? 'Could not close the account.');
        return;
      }
      router.push('/');
    } catch {
      setDeleting(false);
      setError('Could not reach the server.');
    }
  }

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNameSaved(null);
    const res = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not save that name.');
      return;
    }
    setNameSaved(data.displayName ?? '(cleared — your email will be used)');
  }

  async function onRegenerate() {
    setError(null);
    setRegenerating(true);
    const res = await fetch('/api/account/recovery-codes', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setRegenerating(false);
    if (!res.ok) {
      setError(data.message ?? 'Could not issue new codes.');
      return;
    }
    setNewCodes(data.recoveryCodes ?? []);
  }

  return (
    <div className="space-y-8">
      <section className="rounded border border-rule bg-paper-raised p-5">
        <h2 className="font-medium text-ink">Your name</h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          This is how you appear to the people you trust. They see it on every message Relay sends
          on your behalf — including the one that arrives when something has gone wrong, which is
          the worst possible moment for it to say an email address they do not recognise.
        </p>
        <form onSubmit={onSaveName} className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Margaret Chen"
            className="w-64 rounded border border-rule-strong px-3 py-2 text-t2 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
          <button
            type="submit"
            className="rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink"
          >
            Save name
          </button>
          {nameSaved ? <span className="text-t2 text-muted">Saved: {nameSaved}</span> : null}
        </form>
      </section>

      <section className="rounded border border-rule bg-paper-raised p-5">
        <h2 className="font-medium text-ink">Recovery codes</h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          Relay has no password. If you lose the phone with your authenticator on it, these codes
          are the only way back in — so if you cannot find the list you were given at signup, get a
          new one now, while you still can.
        </p>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          Issuing a new list immediately stops the old one working.
        </p>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="mt-4 rounded border border-rule-strong px-3 py-2 text-t2 font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
        >
          {regenerating ? 'Issuing…' : 'Issue new recovery codes'}
        </button>

        {newCodes ? (
          <div className="mt-4 rounded border border-ochre bg-ochre-soft p-4">
            <p className="text-t2 font-medium text-ochre-text">
              Write these down now. They are not shown again.
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-t2 text-ink">
              {newCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className="rounded border border-rule bg-paper-raised p-5">
        <h2 className="font-medium text-ink">Export everything</h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          Downloads a readable file containing every item, decrypted here in your browser, plus the
          people you have designated. Keep it somewhere you would keep a password list — it is not
          protected once it leaves.
        </p>
        <button
          onClick={onExport}
          className="mt-4 rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink"
        >
          Export my vault
        </button>
        {progress ? <p className="mt-3 text-t2 text-muted">{progress}</p> : null}
      </section>

      <section className="rounded border border-clay bg-clay-soft p-5">
        <h2 className="font-medium text-clay">Close this account</h2>
        <p className="mt-2 text-t2 leading-relaxed text-clay">
          Removes your vault, the people you designated, and your access rules. This cannot be
          undone, and anyone relying on this vault will lose their access immediately.
        </p>
        <p className="mt-2 text-t2 leading-relaxed text-clay">
          The tamper-evident event log is kept, exactly as our privacy page says. It holds no
          secrets — only the record of what happened and when.
        </p>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-4 rounded border border-clay bg-paper-raised px-3 py-2 text-t2 font-medium text-clay hover:bg-clay-soft"
          >
            Close my account
          </button>
        ) : (
          <div className="mt-4">
            <label htmlFor="confirmEmail" className="block text-t2 font-medium text-clay">
              Type your email address to confirm
            </label>
            <input
              id="confirmEmail"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              className="mt-1 w-full rounded border border-clay px-3 py-2 text-t2"
              autoComplete="off"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={onDelete}
                disabled={deleting || !confirmEmail.trim()}
                className="rounded bg-clay px-3 py-2 text-t2 font-semibold text-paper hover:bg-clay disabled:opacity-50"
              >
                {deleting ? 'Closing…' : 'Permanently close'}
              </button>
              <button
                onClick={() => {
                  setConfirming(false);
                  setConfirmEmail('');
                }}
                className="rounded border border-rule-strong bg-paper-raised px-3 py-2 text-t2 text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error ? <p className="mt-3 text-t2 font-medium text-clay">{error}</p> : null}
      </section>
    </div>
  );
}
