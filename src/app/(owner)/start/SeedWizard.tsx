'use client';

/**
 * Prompted 8-item caregiver seed, with the zero-knowledge legibility moment.
 *
 * A blank vault is not a first-run experience (J1-R4). The first save shows the
 * actual ciphertext that left the browser, because trust is the acquisition
 * barrier and the guarantee has to be legible to a non-technical person, not
 * merely documented (J1-R5).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4, J1-R5
 */

import { useEffect, useState } from 'react';

import { CAREGIVER_CHECKLIST, type ChecklistEntry } from '../../../../lib/seed/caregiver-checklist';
import { CryptoService } from '../../../../lib/crypto/crypto-service';
import { emitFunnel, resolveChannel } from '../../../../lib/analytics/funnel';

const inputCls =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

interface Props {
  onComplete: () => void;
}

export default function SeedWizard({ onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [service, setService] = useState('');
  const [secret, setSecret] = useState('');
  const [isRoot, setIsRoot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<{ plaintext: string; ciphertext: string } | null>(null);
  const [saved, setSaved] = useState(0);

  const entry: ChecklistEntry | undefined = CAREGIVER_CHECKLIST[index];

  useEffect(() => {
    const channel = resolveChannel(window.location.search);
    void emitFunnel('seed_started', { channel });
  }, []);

  useEffect(() => {
    setIsRoot(entry?.suggestedRoot ?? false);
  }, [entry]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) return;

    setError(null);
    setBusy(true);

    try {
      const crypto = new CryptoService();
      const metadata = {
        type: 'login' as const,
        title: entry.label,
        service_name: service || entry.label,
        category: entry.category,
        criticality: isRoot ? ('critical' as const) : ('high' as const),
      };

      // Encrypt first so the ciphertext can be shown, then upload the same payload.
      const payload = await crypto.encryptForUpload(secret, metadata);

      const res = await fetch('/api/vault/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }

      // The zero-knowledge moment, shown once — on the very first save.
      if (saved === 0) {
        setProof({ plaintext: secret, ciphertext: payload.ciphertext });
      }

      setSaved((n) => n + 1);
      setService('');
      setSecret('');

      if (index + 1 >= CAREGIVER_CHECKLIST.length) {
        void emitFunnel('seed_completed', { channel: resolveChannel(window.location.search) });
        onComplete();
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that item.');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (index + 1 >= CAREGIVER_CHECKLIST.length) {
      void emitFunnel('seed_completed', { channel: resolveChannel(window.location.search) });
      onComplete();
    } else {
      setIndex((i) => i + 1);
    }
  }

  if (!entry) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Step {index + 1} of {CAREGIVER_CHECKLIST.length}
        </span>
        <span>{saved} saved</span>
      </div>

      <div className="h-1 w-full rounded bg-slate-200">
        <div
          className="h-1 rounded bg-blue-600 transition-all"
          style={{ width: `${((index + 1) / CAREGIVER_CHECKLIST.length) * 100}%` }}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{entry.label}</h2>
        <p className="mt-1 text-sm text-slate-500">{entry.hint}</p>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label htmlFor="service" className="mb-1 block text-sm font-medium text-slate-700">
            Which one? <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="service"
            className={inputCls}
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Gmail, Chase, Blue Cross…"
          />
        </div>

        <div>
          <label htmlFor="secret" className="mb-1 block text-sm font-medium text-slate-700">
            Login details or a note
          </label>
          <textarea
            id="secret"
            required
            rows={3}
            className={`${inputCls} font-mono`}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Encrypted in your browser before it is sent"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={isRoot} onChange={(e) => setIsRoot(e.target.checked)} />
          Other accounts reset through this one
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || secret.length === 0}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Encrypting…' : 'Save and continue'}
          </button>
          <button
            type="button"
            onClick={skip}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Skip
          </button>
        </div>
      </form>

      {proof && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">What we actually stored</p>
          <p className="mt-1 text-xs text-emerald-800">You typed:</p>
          <code className="mt-1 block truncate rounded bg-white px-2 py-1 text-xs text-slate-700">
            {proof.plaintext}
          </code>
          <p className="mt-2 text-xs text-emerald-800">What left your browser:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs text-slate-500">
            {proof.ciphertext.slice(0, 96)}…
          </code>
          <p className="mt-2 text-xs text-emerald-800">
            That is what our server received. We cannot read it — and neither can anyone who
            breaches us.
          </p>
        </div>
      )}
    </div>
  );
}
