'use client';

/**
 * Audit log viewer (Requirement 8.6 / task 29.1).
 *
 * Paginated table of audit entries in ascending seq. "Verify chain" recomputes
 * every entry hash CLIENT-SIDE (Web Crypto SHA-256 over the same canonicalJson
 * used by the server) and highlights the first broken link. The server also
 * returns its own verification in GET /api/audit, shown as the initial status.
 *
 * Feature: relay-h0-mvp
 */

import { useEffect, useState } from 'react';
import { GENESIS_PREV_HASH, canonicalJson } from '../../../../lib/audit/canonical';

interface AuditEntry {
  id: string;
  seq: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  ts: string;
}
interface Verification {
  valid: boolean;
  brokenSeq: number | null;
}

const PAGE_SIZE = 25;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Client-side chain recompute (mirrors lib/audit/chain.verifyAuditChain). */
async function verifyClient(entries: AuditEntry[]): Promise<Verification> {
  let prev = GENESIS_PREV_HASH;
  for (const e of entries) {
    if (e.prev_hash !== prev) return { valid: false, brokenSeq: e.seq };
    if ((await sha256Hex(e.prev_hash + canonicalJson(e))) !== e.entry_hash) {
      return { valid: false, brokenSeq: e.seq };
    }
    prev = e.entry_hash;
  }
  return { valid: true, brokenSeq: null };
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [serverV, setServerV] = useState<Verification | null>(null);
  const [clientV, setClientV] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetch('/api/audit')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load audit log (${res.status})`);
        const data = (await res.json()) as { entries: AuditEntry[]; verification: Verification };
        setEntries(data.entries);
        setServerV(data.verification);
      })
      .catch((e) => setError(String(e.message)));
  }, []);

  async function verify() {
    setVerifying(true);
    setClientV(await verifyClient(entries));
    setVerifying(false);
  }

  const broken = clientV?.brokenSeq ?? null;
  const pageEntries = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-t7 font-semibold tracking-tight">Audit log</h1>
          <p className="text-t2 text-muted">{entries.length} entries · append-only, hash-chained.</p>
        </div>
        <div className="flex items-center gap-3">
          <ChainBadge label="Server" v={serverV} />
          <ChainBadge label="Client" v={clientV} />
          <button onClick={verify} disabled={verifying || entries.length === 0} className="rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink disabled:opacity-60">
            {verifying ? 'Verifying…' : 'Verify chain'}
          </button>
        </div>
      </header>

      {error ? <p className="rounded border border-clay bg-clay-soft px-4 py-3 text-t2 text-clay">{error}</p> : null}

      <div className="overflow-hidden rounded border border-rule">
        <table className="w-full text-left text-t2">
          <thead className="bg-paper-sunken text-t1 uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Seq</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2">Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {pageEntries.map((e) => (
              <tr key={e.id || e.seq} className={broken === e.seq ? 'bg-clay-soft' : ''}>
                <td className="px-3 py-1.5 tabular-nums text-muted">{e.seq}</td>
                <td className="px-3 py-1.5 text-t1 text-muted">{new Date(e.ts).toLocaleString()}</td>
                <td className="px-3 py-1.5">{e.actor}</td>
                <td className="px-3 py-1.5 font-medium">{e.action}</td>
                <td className="px-3 py-1.5 text-muted">
                  {e.entity}
                  {e.entity_id ? <span className="text-muted"> · {e.entity_id.slice(0, 8)}</span> : null}
                </td>
                <td className="px-3 py-1.5">
                  {Object.keys(e.detail ?? {}).length ? (
                    <details>
                      <summary className="cursor-pointer text-t1 text-ink">view</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-t1 text-muted">{JSON.stringify(e.detail, null, 2)}</pre>
                    </details>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => navigator.clipboard?.writeText(e.entry_hash)}
                    title="Copy full hash"
                    className="font-mono text-t1 text-muted hover:text-ink"
                  >
                    {e.entry_hash.slice(0, 12)}…
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && !error ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-t2 text-muted">No audit entries yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-t2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded border border-rule-strong px-2 py-1 disabled:opacity-40">
            Prev
          </button>
          <span className="text-muted">
            Page {page + 1} / {pageCount}
          </span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded border border-rule-strong px-2 py-1 disabled:opacity-40">
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChainBadge({ label, v }: { label: string; v: Verification | null }) {
  if (!v) return <span className="text-t1 text-muted">{label}: —</span>;
  return v.valid ? (
    <span className="rounded bg-sage-soft px-2 py-0.5 text-t1 font-semibold text-sage-text">{label}: intact</span>
  ) : (
    <span className="rounded bg-clay-soft px-2 py-0.5 text-t1 font-semibold text-clay">{label}: broken @ {v.brokenSeq}</span>
  );
}
