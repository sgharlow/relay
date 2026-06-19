'use client';

/**
 * CSV import (Requirement 10 / task 13.1).
 *
 * Pick a password-manager export → auto-detect format → preview mapped columns →
 * encrypt every row in-browser (CryptoService.encryptForUpload) → batch-POST to
 * /api/import. Parsing + encryption are entirely client-side (Req 10.2): only
 * ciphertext leaves the browser. If any row fails to encrypt, the whole import
 * aborts before anything is uploaded (Req 10.4).
 *
 * NOTE: parsing runs on the main thread (fast for ≤300 rows); a dedicated Web
 * Worker (Req 10.1 perf) is a deferred optimization.
 *
 * Feature: relay-h0-mvp
 */

import { useState } from 'react';
import { parseCSV, parseCsvText, detectFormat, CSV_FORMATS, CsvError, type CsvFormat, type ParseResult } from '../../../../lib/import/csv-parser';
import { CryptoService } from '../../../../lib/crypto/crypto-service';
import { apiSend } from '../_lib/api';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<CsvFormat>('1password');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setParsed(null);
    setReport(null);
    setError(null);
    if (!f) return;
    try {
      const headers = parseCsvText(await f.text())[0] ?? [];
      const detected = detectFormat(headers);
      if (detected) setFormat(detected);
    } catch {
      /* detection is best-effort; user can pick manually */
    }
  }

  async function parse() {
    if (!file) return;
    setError(null);
    setReport(null);
    try {
      setParsed(await parseCSV(file, format));
    } catch (err) {
      setError(err instanceof CsvError ? err.message : String((err as Error).message));
    }
  }

  async function runImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setError(null);
    setProgress(0);
    const svc = new CryptoService();
    try {
      const items = [];
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        // Encrypt username+password as the secret; title = service name.
        const payload = await svc.encryptForUpload(JSON.stringify({ username: row.username, password: row.password }), {
          type: 'login',
          title: row.service_name,
          service_name: row.service_name,
          url: row.url ?? undefined,
        });
        items.push(payload);
        setProgress(Math.round(((i + 1) / parsed.rows.length) * 90)); // 0–90% = encrypt
      }
      setProgress(95);
      const res = await apiSend<{ imported: number }>('/api/import', 'POST', { items });
      setProgress(100);
      setReport({ imported: res.imported, skipped: parsed.skipped.length });
    } catch (err) {
      // Abort: nothing uploaded if a row failed to encrypt (Req 10.4).
      setError(`Import aborted: ${String((err as Error).message)}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-slate-500">Import a CSV export. It is parsed and encrypted entirely in your browser.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as CsvFormat)} className="rounded border border-slate-300 px-2.5 py-1.5 text-sm">
            {CSV_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <button onClick={parse} disabled={!file} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50">
          Preview
        </button>
      </div>

      {error ? <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {parsed ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {parsed.rows.length} item{parsed.rows.length === 1 ? '' : 's'} to import
              {parsed.skipped.length ? ` · ${parsed.skipped.length} skipped` : ''}
            </p>
            <button onClick={runImport} disabled={progress !== null || parsed.rows.length === 0} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {progress !== null ? 'Importing…' : `Encrypt & import ${parsed.rows.length}`}
            </button>
          </div>

          {progress !== null ? (
            <div className="h-2 overflow-hidden rounded bg-slate-200">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}

          <div className="overflow-hidden rounded border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">Username</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsed.rows.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{row.service_name}</td>
                    <td className="truncate px-3 py-1.5 text-slate-500">{row.url ?? '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{row.username ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 50 ? <p className="px-3 py-2 text-xs text-slate-400">+{parsed.rows.length - 50} more…</p> : null}
          </div>

          {parsed.skipped.length ? (
            <details className="rounded border border-slate-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer text-slate-600">{parsed.skipped.length} skipped rows</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {parsed.skipped.map((s) => (
                  <li key={s.row}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Imported {report.imported} item{report.imported === 1 ? '' : 's'}
          {report.skipped ? `, skipped ${report.skipped}` : ''}.
        </div>
      ) : null}
    </div>
  );
}
