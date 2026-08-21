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
import Link from 'next/link';
import { parseCSV, parseCsvText, detectFormat, CSV_FORMATS, CsvError, type CsvFormat, type ParseResult } from '../../../../lib/import/csv-parser';
import { CONTACT_MAILTO } from '../../../../lib/contact';
import { encodeSecretPayload } from '../../../../lib/crypto/secret-payload';
import { CryptoService } from '../../../../lib/crypto/crypto-service';
import { apiSend } from '../_lib/api';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<CsvFormat>('1password');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<{
    imported: number;
    skipped: number;
    duplicates: number;
    /** How many rows the parser could read — what `position` below counts among. */
    read: number;
    /**
     * Which rows were skipped, not just how many — see the report below.
     *
     * ⚠️ `position`, not `row`. It is an index into what was UPLOADED, which is
     * `parsed.rows` — the rows that survived parsing. It is not the line in the
     * file, and `parsed.skipped[].row` on this same screen is. See the route.
     */
    duplicateRows: Array<{ position: number; title: string; url: string | null }>;
    /** How many access rules the new items matched (J4-R4). */
    policiesMatched: number;
    /** True when the batch was too large to match inline, or matching failed. */
    coverageDeferred: boolean;
  } | null>(null);
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
    /*
      🔴 ONE `catch` USED TO COVER BOTH HALVES OF THIS AND REPORTED THE WRONG ONE.
      It said "Import aborted" for any failure — true of a row that fails to
      encrypt, where nothing has left the browser (Req 10.4), and false the
      moment the request has been sent. /api/import INSERTS every item before it
      scores or covers anything, and its own comment says a timeout in the
      coverage pass "would report a successful import as a failure". So an owner
      whose request timed out after the writes read "aborted", imported again,
      and finished with two of everything — and the second run is a real
      re-import that dedupe has no memory of refusing.

      Split deliberately rather than by re-wording one message: the two halves
      know different things, and only the first one can honestly promise that
      nothing was stored.
    */
    const items: Awaited<ReturnType<CryptoService['encryptForUpload']>>[] = [];
    try {
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        /*
          🔴 THIS WROTE `JSON.stringify({ username, password })` UNTIL 2026-08-17,
          and `AccessClient` rendered whatever it decrypted into a `<pre>` — so a
          recipient of any imported item was shown raw JSON at the worst moment
          of their life. It also dropped the second factor entirely, on a column
          the parser was already reading in order to detect the format.

          The envelope is versioned and the decoder still understands both older
          shapes, permanently: the server cannot read plaintext, so no migration
          can ever normalise the rows written before today.
        */
        const payload = await svc.encryptForUpload(encodeSecretPayload([
          { kind: 'username', value: row.username ?? '' },
          { kind: 'password', value: row.password },
          { kind: 'totp', value: row.totp ?? '' },
        ]), {
          type: 'login',
          title: row.service_name,
          service_name: row.service_name,
          url: row.url ?? undefined,
        });
        items.push(payload);
        setProgress(Math.round(((i + 1) / parsed.rows.length) * 90)); // 0–90% = encrypt
      }
    } catch (err) {
      // The honest abort: nothing has been sent, so nothing was stored.
      setError(
        `Could not encrypt one of your rows, so nothing was uploaded and your vault is unchanged: ${String(
          (err as Error).message,
        )}`,
      );
      setProgress(null);
      return;
    }

    try {
      setProgress(95);
      const res = await apiSend<{
        imported: number;
        duplicatesSkipped?: number;
        duplicateRows?: Array<{ position: number; title: string; url: string | null }>;
        policiesMatched?: number;
        coverageDeferred?: boolean;
      }>('/api/import', 'POST', { items });
      setProgress(100);
      setReport({
        imported: res.imported,
        skipped: parsed.skipped.length,
        read: parsed.rows.length,
        duplicates: res.duplicatesSkipped ?? 0,
        // Older deploys of the route answer without this. An absent list is
        // reported as no list rather than as no skips — the count is separate.
        duplicateRows: res.duplicateRows ?? [],
        policiesMatched: res.policiesMatched ?? 0,
        coverageDeferred: res.coverageDeferred ?? false,
      });
    } catch (err) {
      /*
        Sent, and no report came back. What the server did with it is genuinely
        unknown from here — the items are written before the scoring and coverage
        passes that are the likeliest things to time out — so this says that
        rather than guessing, and points at the one check that settles it.
      */
      setError(
        `Your items were sent, but no report came back (${String((err as Error).message)}). ` +
          'They may already be saved — open your vault and look before importing this file again, ' +
          'or you could end up with two of everything.',
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-t7 font-semibold tracking-tight">Import</h1>
        <p className="text-t2 text-muted">Import a CSV export. It is parsed and encrypted entirely in your browser.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded border border-rule bg-paper-raised p-4">
        <label className="text-t2">
          <span className="mb-1 block text-muted">CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-t2" />
        </label>
        <label className="text-t2">
          <span className="mb-1 block text-muted">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as CsvFormat)} className="rounded border border-rule-strong px-2.5 py-1.5 text-t2">
            {CSV_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <button onClick={parse} disabled={!file} className="rounded border border-rule-strong px-3 py-1.5 text-t2 font-medium hover:bg-paper-sunken disabled:opacity-50">
          Preview
        </button>
      </div>

      {error ? <p role="alert" className="rounded border border-clay bg-clay-soft px-4 py-3 text-t2 text-clay">{error}</p> : null}

      {parsed ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-t2 text-muted">
              {parsed.rows.length} item{parsed.rows.length === 1 ? '' : 's'} to import
              {parsed.skipped.length ? ` · ${parsed.skipped.length} skipped` : ''}
            </p>
            <button onClick={runImport} disabled={progress !== null || parsed.rows.length === 0} className="rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink disabled:opacity-60">
              {progress !== null ? 'Importing…' : `Encrypt & import ${parsed.rows.length}`}
            </button>
          </div>

          {progress !== null ? (
            <div className="h-2 overflow-hidden rounded bg-paper-sunken">
              <div className="h-full bg-ink transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}

          {/* overflow-x-auto, not overflow-hidden: the root hides horizontal
              overflow, so a clipped table's right-hand columns are unreachable
              on a phone rather than just awkward. Here that is the preview of
              what is about to be imported — the columns a person checks before
              committing. */}
          <div
            className="overflow-x-auto rounded border border-rule"
            tabIndex={0}
            role="region"
            aria-label="Preview of the items about to be imported"
          >
            <table className="w-full text-left text-t2">
              <thead className="bg-paper-sunken text-t1 uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">Username</th>
                  {/*
                    Shown so the owner can SEE their second factors came across.
                    Until 2026-08-17 they were silently dropped and the vault
                    reported itself complete — a fix nobody can observe is
                    indistinguishable from the bug.
                  */}
                  <th className="px-3 py-2">2FA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {parsed.rows.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{row.service_name}</td>
                    <td className="truncate px-3 py-1.5 text-muted">{row.url ?? '—'}</td>
                    <td className="px-3 py-1.5 text-muted">{row.username ?? '—'}</td>
                    {/* Never the seed itself — that is the secret. Only whether one is there. */}
                    <td className="px-3 py-1.5 text-muted">{row.totp ? 'Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 50 ? <p className="px-3 py-2 text-t1 text-muted">+{parsed.rows.length - 50} more…</p> : null}
          </div>

          {parsed.skipped.length ? (
            <details className="rounded border border-rule bg-paper-raised p-3 text-t2">
              <summary className="cursor-pointer text-muted">{parsed.skipped.length} skipped rows</summary>
              <ul className="mt-2 space-y-1 text-t1 text-muted">
                {parsed.skipped.map((s) => (
                  <li key={s.row}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div className="rounded border border-sage bg-sage-soft px-4 py-3 text-t2 text-sage-text">
          Imported {report.imported} item{report.imported === 1 ? '' : 's'}
          {report.skipped ? `, skipped ${report.skipped} unreadable row${report.skipped === 1 ? '' : 's'}` : ''}
          {report.duplicates
            ? `, and left ${report.duplicates} already in your vault untouched`
            : ''}
          .
          {/* Naming the duplicates matters: an owner who counted the rows in
              their export would otherwise conclude the import lost credentials. */}
          {report.imported ? (
            <p className="mt-2 text-sage-text">
              We&apos;ve re-checked which of these unlock the others — your vault ranking is up
              to date.
            </p>
          ) : null}
          {/*
            🔴 IMPORTED ITEMS USED TO LAND UNCOVERED, SILENTLY. `coverNewItem`
            ran on the single-item route only — under a comment saying it was
            there "so an import cannot land silently uncovered (J4-R4)" — and
            /api/import never called it. An owner accepted the rules Relay
            proposed, imported their password manager, and none of it was
            reachable by anyone they had named. J4-R4's second half is that the
            owner SHALL be notified; nothing rendered the count, so this is it.
          */}
          {report.policiesMatched ? (
            <p className="mt-2 text-sage-text">
              {report.policiesMatched === 1
                ? 'One of these matched an access rule you already had, and is now covered by it.'
                : `${report.policiesMatched} of these matched access rules you already had, and are now covered by them.`}
            </p>
          ) : null}
          {/*
            🔴 THIS SENTENCE USED TO SAY "Open Rules and re-apply your rules to
            cover them", AND THERE IS NO SUCH CONTROL. Nothing in src or lib
            re-applies existing policies across items — the only path that
            materialises one over the whole vault is CREATING a policy, and
            /circle offers that Accept button only while the owner holds none,
            which is the opposite of the condition that gets you here. So the
            branch handed an owner a screen and a button that does not exist, in
            the same sprint whose charter was deleting copy that promises what
            the product cannot do.

            What is true: /rules grants one recipient access to one item, and
            that is what makes an imported item reachable. It is per-item and
            this fires above a hundred, so the copy says so rather than implying
            a batch control, and offers the address instead of pretending the
            owner should click a hundred times. `import-copy.test.ts` holds every
            screen this paragraph names to being a route that exists.
          */}
          {report.coverageDeferred ? (
            <p className="mt-2 text-t2 text-clay">
              These were imported, but they have <strong>not</strong> been matched against your
              access rules — so nobody can reach them yet. On{' '}
              <Link href="/rules" className="underline">
                Rules
              </Link>{' '}
              you can give someone access to an item, one at a time. There is no control that does a
              whole import at once, so if this is more than you want to do by hand,{' '}
              <a href={CONTACT_MAILTO} className="underline">
                write to us
              </a>{' '}
              and we will sort it out with you.
            </p>
          ) : null}
          {/*
            🔴 SILENCE HERE READ AS SUCCESS. `splitDuplicates` matches an incoming
            row against items already in the vault on a normalised
            title + service_name, so re-importing a fresh export — the natural
            thing to do after turning on two-factor somewhere — skips EVERY row
            and reports `imported: 0`. Nothing is updated, and until 2026-08-17
            nothing said the second factor had not come across.

            Deliberately not fixed by making import overwrite existing items:
            that would turn the importer into a path that can write over stored
            secrets, which it has never been, and a stale export could quietly
            replace a good credential with a worse one. Telling the owner what
            happened is the smaller and more honest change.
          */}
          {report.duplicates ? (
            <p className="mt-2 text-sage-text">
              The {report.duplicates === 1 ? 'one already in your vault was' : `${report.duplicates} already in your vault were`}{' '}
              left alone — <strong>including any two-factor codes in this export</strong>. To add a
              code to an account you already have, open it in your vault and choose Update.
            </p>
          ) : null}
          {/*
            🔴 A COUNT IS NOT A REPORT. Until 2026-08-21 this said "left 1 already
            in your vault untouched" and stopped there, which tells an owner that
            something did not arrive and gives them no way to find out what.

            It mattered more than tidiness because the matching was wrong as well:
            the client sends `title: row.service_name`, so every row from an export
            has title === service_name, and two Google logins were one key. The
            second credential was dropped and this sentence was the only trace.
            lib/vault/dedupe.ts now separates them on url; this names whatever it
            still merges, so a silent skip cannot happen again.

            J2 step 3: every skip reported with its row number and reason.

            ⚠️ AND IT CLAIMED A LINE NUMBER IT DOES NOT HAVE. This said "by their
            line in your file" over `position`, which counts among the rows that
            SURVIVED parsing — while the unreadable-rows list further up this same
            screen numbers by `dataRow`, which really is the line in the file. One
            missing password in the export shifts every number here by one, and
            the two lists then disagree under the same word. The address is what
            actually identifies the account anyway, and it is what tells two
            logins at one provider apart. Corrected 2026-08-21. Carrying the true
            file line needs `dataRow` on `ParsedRow` in lib/import/csv-parser.ts.
          */}
          {report.duplicateRows.length ? (
            <div className="mt-2 text-t2 text-muted">
              <p>Left out because they are already in your vault:</p>
              <ul className="mt-1 space-y-0.5">
                {report.duplicateRows.map((d) => (
                  <li key={d.position}>
                    {d.title}
                    {d.url ? <> &middot; {d.url}</> : null} &mdash; item {d.position} of the{' '}
                    {report.read} we could read
                  </li>
                ))}
              </ul>
              {report.duplicateRows.length < report.duplicates ? (
                <p className="mt-1">
                  &hellip; and {report.duplicates - report.duplicateRows.length} more.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
