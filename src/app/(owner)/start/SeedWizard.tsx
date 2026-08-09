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
import { buttonPrimary, buttonQuiet, cardPadded, errorText, h2, input as inputStyle, mono, muted, sunken } from '../_lib/ui';

interface Props {
  onComplete: () => void;
}

/**
 * Runs the Intake Agent over the freshly seeded vault.
 *
 * R11.1 says classification happens when an item is created or imported, but
 * nothing invoked it: every seeded item sat at the default 0.5 score with no
 * root-credential flag and no `depends_on_item_id`. The consequence was silent
 * and total — the risk-graph reveal ALWAYS fell back to its "add a few more
 * accounts" degradation, because there were never any dependency edges to find.
 * Caught by walking the funnel in a browser; no unit test could see it, since
 * they all feed synthetic items that already carry edges.
 *
 * Best-effort by design: scoring failure must never block vault creation
 * (R11.9), so a failure here still advances to the reveal.
 */
async function scoreSeededVault(): Promise<void> {
  try {
    await fetch('/api/ai/intake', { method: 'POST' });
  } catch {
    // R11.9 — the reveal degrades honestly rather than blocking the funnel.
  }
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
        await scoreSeededVault();
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

  async function skip() {
    if (index + 1 >= CAREGIVER_CHECKLIST.length) {
      void emitFunnel('seed_completed', { channel: resolveChannel(window.location.search) });
      setBusy(true);
      await scoreSeededVault();
      setBusy(false);
      onComplete();
    } else {
      setIndex((i) => i + 1);
    }
  }

  if (!entry) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between" style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
        <span>
          Step {index + 1} of {CAREGIVER_CHECKLIST.length}
        </span>
        <span>{saved} saved</span>
      </div>

      <div className="h-1 w-full" style={{ background: 'var(--paper-sunken)', borderRadius: 'var(--radius-owner)' }}>
        <div
          className="h-1 transition-all"
          // Ochre: the one thing in motion on this screen.
          style={{ background: 'var(--ochre)', borderRadius: 'var(--radius-owner)',
            width: `${((index + 1) / CAREGIVER_CHECKLIST.length) * 100}%` }}
        />
      </div>

      <div>
        <h2 style={h2}>{entry.label}</h2>
        <p style={{ ...muted, marginTop: 'var(--s1)' }}>{entry.hint}</p>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label htmlFor="service" style={{ display: 'block', fontSize: 'var(--t2)', fontWeight: 500, marginBottom: 'var(--s1)' }}>
            Which one? <span style={{ fontWeight: 400, color: 'var(--ink-faint)' }}>(optional)</span>
          </label>
          <input
            id="service"
            style={inputStyle}
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Gmail, Chase, Blue Cross…"
          />
        </div>

        <div>
          <label htmlFor="secret" style={{ display: 'block', fontSize: 'var(--t2)', fontWeight: 500, marginBottom: 'var(--s1)' }}>
            Login details or a note
          </label>
          <textarea
            id="secret"
            required
            rows={3}
            style={{ ...inputStyle, ...mono, fontSize: 'var(--t2)' }}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Encrypted in your browser before it is sent"
          />
        </div>

        <label className="flex items-center" style={{ gap: 'var(--s2)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={isRoot} onChange={(e) => setIsRoot(e.target.checked)} />
          Other accounts reset through this one
        </label>

        {error && <p style={errorText}>{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || secret.length === 0}
            style={{ ...buttonPrimary, flex: 1, opacity: busy || secret.length === 0 ? 0.5 : 1 }}
          >
            {busy ? 'Encrypting…' : 'Save and continue'}
          </button>
          <button
            type="button"
            onClick={() => void skip()}
            style={buttonQuiet}
          >
            Skip
          </button>
        </div>
      </form>

      {proof && (
        /*
          Not a success message — there is no success colour in this system, and
          this is not a congratulation. It is evidence, so it is set like
          evidence: paper, ink, and the two strings side by side.
        */
        <div style={cardPadded}>
          <p style={{ fontSize: 'var(--t3)', fontWeight: 600 }}>What just left your browser</p>

          <p style={{ ...muted, marginTop: 'var(--s3)' }}>You typed</p>
          <code style={{ ...mono, ...sunken, display: 'block', padding: 'var(--s2)', marginTop: 'var(--s1)', overflowWrap: 'anywhere' }}>
            {proof.plaintext}
          </code>

          <p style={{ ...muted, marginTop: 'var(--s3)' }}>What we received</p>
          <code style={{ ...mono, ...sunken, display: 'block', padding: 'var(--s2)', marginTop: 'var(--s1)', color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>
            {proof.ciphertext.slice(0, 96)}…
          </code>

          <p style={{ fontSize: 'var(--t2)', lineHeight: 1.6, marginTop: 'var(--s3)' }}>
            That is the whole row on our servers. We can tell you have an account here — that is how
            the ranking works. We cannot tell what the password is, and neither can the part of Relay
            that decides which of these matters most.
          </p>
        </div>
      )}
    </div>
  );
}
