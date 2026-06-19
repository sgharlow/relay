/**
 * Client-side CSV parser for password-manager exports (Requirement 10).
 *
 * Runs entirely in the browser (Req 10.2) — no raw CSV or plaintext credential
 * ever reaches the server. Maps source-specific columns to the canonical
 * {service_name, url, username, password}, skips rows missing required fields
 * (Req 10.3/10.7), case-insensitively deduplicates on (service_name, url)
 * (Req 10.6), and rejects the whole file on >10MB / invalid CSV / unrecognised
 * format (Req 10.1/10.9).
 *
 * Pure + DB-free so it is fully unit-testable (and importable into a Web Worker).
 *
 * Feature: relay-h0-mvp
 * Requirements: 10.1–10.3, 10.6, 10.7, 10.9
 */

export type CsvFormat = '1password' | 'bitwarden' | 'lastpass' | 'chrome' | 'firefox';

export const CSV_FORMATS: CsvFormat[] = ['1password', 'bitwarden', 'lastpass', 'chrome', 'firefox'];

export interface ParsedRow {
  service_name: string;
  url: string | null;
  username: string | null;
  /** Plaintext — stays client-side; encrypted before any upload. */
  password: string;
}

export interface SkippedRow {
  row: number; // 1-based data-row number
  reason: string;
}

export interface ParseResult {
  format: CsvFormat;
  rows: ParsedRow[];
  skipped: SkippedRow[];
}

/** Whole-file failure (size, structure, format) — aborts the import (Req 10.9). */
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
    Object.setPrototypeOf(this, CsvError.prototype);
  }
}

const MAX_BYTES = 10 * 1024 * 1024;

// Canonical field → candidate header names per format (lowercased).
const FORMAT_COLUMNS: Record<CsvFormat, { service_name: string[]; url: string[]; username: string[]; password: string[] }> = {
  '1password': { service_name: ['title'], url: ['url', 'website'], username: ['username'], password: ['password'] },
  bitwarden: { service_name: ['name'], url: ['login_uri', 'uri'], username: ['login_username'], password: ['login_password'] },
  lastpass: { service_name: ['name'], url: ['url'], username: ['username'], password: ['password'] },
  chrome: { service_name: ['name'], url: ['url'], username: ['username'], password: ['password'] },
  firefox: { service_name: [], url: ['url'], username: ['username'], password: ['password'] }, // service_name from url host
};

// ---------------------------------------------------------------------------
// CSV tokenizer (RFC-4180-ish: quoted fields, "" escapes, CRLF/LF)
// ---------------------------------------------------------------------------

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows (trailing newlines / blank lines).
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Best-effort format guess from the header row (for the picker's auto-detect). */
export function detectFormat(headers: string[]): CsvFormat | null {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (h.has('login_password') || h.has('login_uri')) return 'bitwarden';
  if (h.has('httprealm') || h.has('formactionorigin')) return 'firefox';
  if (h.has('title')) return '1password';
  if (h.has('grouping') || h.has('totp')) return 'lastpass';
  if (h.has('name') && h.has('url') && h.has('username') && h.has('password')) {
    return h.has('note') || h.has('notes') ? 'chrome' : 'lastpass';
  }
  return null;
}

function indexOfAny(headers: string[], candidates: string[]): number {
  const lower = headers.map((x) => x.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return idx;
  }
  return -1;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

export async function parseCSV(file: File, format: CsvFormat): Promise<ParseResult> {
  if (file.size > MAX_BYTES) {
    throw new CsvError(`File exceeds the 10 MB limit (${file.size} bytes)`);
  }
  const cols = FORMAT_COLUMNS[format];
  if (!cols) throw new CsvError(`Unrecognised format: ${format}`);

  const text = await file.text();
  const table = parseCsvText(text);
  if (table.length < 1) throw new CsvError('CSV is empty or not valid');

  const headers = table[0];
  const idx = {
    service_name: indexOfAny(headers, cols.service_name),
    url: indexOfAny(headers, cols.url),
    username: indexOfAny(headers, cols.username),
    password: indexOfAny(headers, cols.password),
  };

  // Required columns must exist for the declared format.
  const hasName = idx.service_name !== -1 || (format === 'firefox' && idx.url !== -1);
  if (idx.password === -1 || !hasName) {
    throw new CsvError(`CSV does not match the ${format} format (missing required columns)`);
  }

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < table.length; r++) {
    const fields = table[r];
    const dataRow = r; // 1-based among data rows
    const get = (i: number) => (i >= 0 && i < fields.length ? fields[i].trim() : '');

    const url = get(idx.url) || null;
    const service_name = format === 'firefox' && idx.service_name === -1 ? hostFromUrl(url ?? '') : get(idx.service_name);
    const username = get(idx.username) || null;
    const password = idx.password >= 0 && idx.password < fields.length ? fields[idx.password] : '';

    if (!service_name || !password) {
      skipped.push({ row: dataRow, reason: 'missing required field (service name or password)' });
      continue;
    }

    const key = `${service_name.toLowerCase()}|${(url ?? '').toLowerCase()}`;
    if (seen.has(key)) {
      skipped.push({ row: dataRow, reason: 'duplicate of an earlier row (service name + url)' });
      continue;
    }
    seen.add(key);
    rows.push({ service_name, url, username, password });
  }

  return { format, rows, skipped };
}
