/**
 * A column the application never mentions is a promise nothing keeps.
 *
 * 🔴 WHY THIS EXISTS. Sweeping every table for read/write asymmetry on
 * 2026-08-17 found `consent_artifacts`: written since migration 009, read by
 * nothing, while the screen that collects it says *"This is kept as a record. It
 * is what makes handing someone this help legitimate rather than simply
 * convenient."* The database kept that promise and the product did not.
 *
 * That sweep was a throwaway script. This is the part worth keeping: nothing
 * stops the next column drifting the same way, and schema drift is invisible —
 * it breaks no build, fails no test, and shows up only when somebody goes
 * looking for a value that was never surfaced.
 *
 * ⚠️ A COLUMN IN THE ALLOW-LIST BELOW IS NOT DEAD WEIGHT TO BE DELETED. Dropping
 * a column on Aurora DSQL is a migration, which is a sysadmin act, and three of
 * these are populated by their own DEFAULT — the data is real, it is simply not
 * read. They are listed so nobody re-investigates them, which is the same reason
 * the sprint reports keep a "checked and found correct" table.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Columns declared in the schema that the application deliberately never reads.
 * Every entry argues for itself, and the reason has to name what supersedes it —
 * "unused" is not a reason, it is the finding restated.
 */
const UNREFERENCED_BY_DESIGN: Record<string, string> = {
  'release_state.notified_at':
    'Superseded by email_send_attempts and email_delivery_events, which record ' +
    'per-message outcomes rather than one timestamp per release. Never written.',
  'release_state.first_access_at':
    'Superseded by audit_log — closure.ts derives first and last access from ' +
    'min(ts)/max(ts) by actor, which is hash-chained and cannot be back-dated.',
  'verifier_confirmations.confirmed_at':
    'Populated by its own DEFAULT now() on every insert, so the data is real. ' +
    'Nothing displays it; the audit chain carries the same fact in order.',
  'consent_artifacts.recorded_at':
    'Populated by its own DEFAULT now(). The screen shows delegations.granted_at ' +
    'instead, which is the moment the delegation actually became active.',
  /*
    🔴 THE ONLY ENTRY HERE THAT IS UNREFERENCED ON PURPOSE AND TEMPORARILY, and
    it is the one this guard came closest to being right to refuse.

    Migration 037 declares it; no code reads it, because Sprint 4 is gated to
    DESIGN ONLY (docs/backlog.md) and the wrap/unwrap change it exists for is
    deliberately not in the same branch. That is exactly the shape migration 035
    shipped in — `secret_kinds` was fully unit-tested and completely INERT for a
    day — so this guard firing was correct behaviour, not noise.

    What makes it acceptable HERE and not there: 035's column was believed to be
    wired and was not. This one is declared ahead of its code on purpose, with
    the reason written down before the column existed, and with a second guard
    (lib/ops/encryption-context-design.test.ts) that fails if an EncryptionContext
    is ever passed WITHOUT this marker — the dangerous ordering being the other
    one.
  */
  'vault_items.kms_context_era':
    'Authored ahead of its code by docs/backlog.md S4-2, which gates Sprint 4 to ' +
    'design only. Superseded by nothing — it is waiting for the wrap/unwrap change ' +
    'in docs/encryption-context-design.md. REMOVE THIS ENTRY when that lands; if it ' +
    'is still here once EncryptionContext is passed, the column is inert in the one ' +
    'place where inert means a decrypt cannot tell a legacy blob from a current one.',
};

/** Present on nearly every table and referenced generically, not by name. */
const UBIQUITOUS = new Set(['id', 'created_at', 'updated_at', 'ts']);

const SEP = String.fromCharCode(92);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** table -> columns, from CREATE TABLE bodies and ALTER TABLE ADD COLUMN. */
function declaredColumns(): Map<string, Set<string>> {
  const dir = 'db/migrations';
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');

  const columns = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(column);
  };

  const tableRe = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql))) {
    for (const line of m[2].split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      const cm = t.match(
        /^([a-z_]+)\s+(UUID|TEXT|BOOLEAN|BIGINT|INT|INTEGER|NUMERIC|TIMESTAMPTZ|JSONB|BYTEA|DATE)/i,
      );
      if (cm) add(m[1], cm[1]);
    }
  }

  const alterRe = /ALTER TABLE ([a-z_]+)[\s\S]*?ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/gi;
  while ((m = alterRe.exec(sql))) add(m[1], m[2]);

  return columns;
}

/**
 * All application source, comments stripped so a mention is not a use.
 *
 * ⚠️ MEMOISED, AND NOT AS A MICRO-OPTIMISATION. Three tests here need it, and
 * reading every file under lib/, src/ and scripts/ three times added enough
 * wall-clock to the suite to tip `recipient-token`'s 100-run property test past
 * its 5-second limit — a timeout, in an unrelated file, that looked like a
 * correctness failure. A check is allowed to be thorough; it is not allowed to
 * make other tests flaky.
 */
let sourceCache: string | null = null;
function applicationSource(): string {
  if (sourceCache === null) {
    sourceCache = [...walk('lib'), ...walk('src'), ...walk('scripts')]
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  }
  return sourceCache;
}

describe('every column the schema declares is referenced by the application', () => {
  it('finds no unreferenced column outside the allow-list', () => {
    const src = applicationSource();
    const unreferenced: string[] = [];

    for (const [table, cols] of declaredColumns()) {
      for (const col of cols) {
        if (UBIQUITOUS.has(col)) continue;
        const key = `${table}.${col}`;
        if (key in UNREFERENCED_BY_DESIGN) continue;
        if (!new RegExp(`\\b${col}\\b`).test(src)) unreferenced.push(key);
      }
    }

    expect(
      unreferenced,
      'These columns exist in the schema and are named nowhere in lib/, src/ or scripts/. ' +
        'Either wire them up, or add them to UNREFERENCED_BY_DESIGN with a reason naming what ' +
        'supersedes them. Schema drift breaks no build and fails no other test.',
    ).toEqual([]);
  });

  it('the allow-list only lists columns that really are unreferenced', () => {
    /*
      The other direction, and the one that rots. If a listed column is later
      wired up, the entry becomes a stale claim that would hide a genuine
      regression on the same column. Removing it is part of wiring it.
    */
    const src = applicationSource();
    const nowUsed = Object.keys(UNREFERENCED_BY_DESIGN).filter((key) =>
      new RegExp(`\\b${key.split('.')[1]}\\b`).test(src),
    );
    expect(
      nowUsed,
      'These are on the allow-list but the application now references them — delete the entry',
    ).toEqual([]);
  });

  it('every allow-list entry argues for itself', () => {
    // The convention the other ops checks use: a reason short enough to be
    // decoration is not a reason, and "unused" restates the finding.
    for (const [key, reason] of Object.entries(UNREFERENCED_BY_DESIGN)) {
      expect(reason.length, `${key}'s reason is too short to be an argument`).toBeGreaterThan(40);
      expect(reason, `${key}'s reason should name what supersedes it`).toMatch(
        /superseded|DEFAULT|audit_log|instead/i,
      );
    }
  });

  it('the scan actually parses the schema — a clean result must not be an empty one', () => {
    /*
      🔴 THE THROWAWAY VERSION OF THIS SCAN REPORTED "no findings" WHILE BROKEN.
      A sibling sweep for dead-end error states pinned the closing paren to one
      indentation level, found nothing, and looked like good news until a planted
      defect proved it could not see anything at all.

      So: assert the parser found a plausible schema before trusting that it
      found no problems.
    */
    const columns = declaredColumns();
    expect(columns.size, 'no tables parsed — the migration regex has broken').toBeGreaterThan(20);
    expect(columns.get('vault_items')?.has('backup_note')).toBe(true);
    expect(columns.get('release_state')?.has('notified_at')).toBe(true);
    expect(applicationSource().length, 'no application source read').toBeGreaterThan(100_000);
    expect(SEP).toBe('\\');
  });
});
