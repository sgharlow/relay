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
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-slate-500">{entries.length} entries · append-only, hash-chained.</p>
        </div>
        <div className="flex items-center gap-3">
          <ChainBadge label="Server" v={serverV} />
          <ChainBadge label="Client" v={clientV} />
          <button onClick={verify} disabled={verifying || entries.length === 0} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {verifying ? 'Verifying…' : 'Verify chain'}
          </button>
        </div>
      </header>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <div className="overflow-hidden rounded border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
          <tbody className="divide-y divide-slate-100">
            {pageEntries.map((e) => (
              <tr key={e.id || e.seq} className={broken === e.seq ? 'bg-red-50' : ''}>
                <td className="px-3 py-1.5 tabular-nums text-slate-500">{e.seq}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{new Date(e.ts).toLocaleString()}</td>
                <td className="px-3 py-1.5">{e.actor}</td>
                <td className="px-3 py-1.5 font-medium">{e.action}</td>
                <td className="px-3 py-1.5 text-slate-500">
                  {e.entity}
                  {e.entity_id ? <span className="text-slate-400"> · {e.entity_id.slice(0, 8)}</span> : null}
                </td>
                <td className="px-3 py-1.5">
                  {Object.keys(e.detail ?? {}).length ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600">view</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-slate-600">{JSON.stringify(e.detail, null, 2)}</pre>
                    </details>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => navigator.clipboard?.writeText(e.entry_hash)}
                    title="Copy full hash"
                    className="font-mono text-xs text-slate-500 hover:text-slate-900"
                  >
                    {e.entry_hash.slice(0, 12)}…
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && !error ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No audit entries yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
            Prev
          </button>
          <span className="text-slate-500">
            Page {page + 1} / {pageCount}
          </span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChainBadge({ label, v }: { label: string; v: Verification | null }) {
  if (!v) return <span className="text-xs text-slate-400">{label}: —</span>;
  return v.valid ? (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{label}: intact</span>
  ) : (
    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{label}: broken @ {v.brokenSeq}</span>
  );
}
