/**
 * Every table the code queries is declared by a migration.
 *
 * WHY. `npm run verify:schema` answers "has this cluster been given what the
 * migrations declare?" — the direction that failed on 2026-08-15, when
 * `auth_challenges` existed in a file and not in the database. This is the
 * other direction: code that reads a table NO migration creates. That one needs
 * no cluster to detect, so unlike verify:schema it runs in CI on every push.
 *
 * Both directions end the same way — `relation "x" does not exist` in
 * production, on whichever path touches it first — and neither is visible until
 * something reads the table. `migrate.ts` tracks nothing, so there has never
 * been a place to look this up.
 *
 * 🔴 THE OBVIOUS IMPLEMENTATION DOES NOT WORK, and it was tried first (sprint
 * report 2026-08-15, item D2, filed as debt rather than shipped). Grepping the
 * source for `FROM (\w+)` returns 183 candidates on this repo, almost all of
 * them English: "from a", "from anyone", "from here". This codebase explains
 * itself at length, so prose is the dominant match and the check is unusable.
 *
 * So SQL is taken only from TEMPLATE LITERALS that look like SQL, after
 * comments are stripped. Comments must go first for a reason this file has met
 * three times now: they quote SQL to explain it — the Stripe webhook's own
 * header quotes the INSERT it used to have — and a check that reads an
 * explanation as a use is a check that gets deleted.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { declaredTables } from '../db/schema-manifest';

/**
 * Tables that exist without a migration: PostgreSQL's own catalogue, and DSQL's
 * `sys` schema. Queried by the schema checker and the role tooling.
 */
const SYSTEM_TABLES = new Set(['pg_tables', 'pg_indexes', 'pg_class', 'pg_namespace']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full.split('\\').join('/'));
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/** Template literals whose content reads as a SQL statement. */
function sqlLiterals(code: string): string[] {
  const literals = [...code.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  return literals.filter((l) => /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(l));
}

/**
 * Table names referenced by a statement.
 *
 * CTE names are collected and subtracted: `WITH recent AS (...) SELECT * FROM
 * recent` must not report `recent` as an undeclared table.
 */
function tablesIn(sql: string): string[] {
  const ctes = new Set(
    [...sql.matchAll(/\b(?:WITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()),
  );

  const refs = [
    ...sql.matchAll(/\bFROM\s+([a-z_][a-z0-9_.]*)/gi),
    ...sql.matchAll(/\bJOIN\s+([a-z_][a-z0-9_.]*)/gi),
    ...sql.matchAll(/\bINSERT\s+INTO\s+([a-z_][a-z0-9_.]*)/gi),
    ...sql.matchAll(/\bUPDATE\s+([a-z_][a-z0-9_.]*)/gi),
  ].map((m) => m[1].toLowerCase());

  return [...new Set(refs)].filter((t) => !ctes.has(t));
}

const migrations = readdirSync('db/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`db/migrations/${f}`, 'utf8'));
const declared = new Set(declaredTables(migrations));

interface Ref {
  file: string;
  table: string;
}

function allReferences(): Ref[] {
  const out: Ref[] = [];
  for (const file of [...sourceFiles('lib'), ...sourceFiles('src')]) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const sql of sqlLiterals(code)) {
      for (const table of tablesIn(sql)) out.push({ file, table });
    }
  }
  return out;
}

const refs = allReferences();

describe('every table the code queries is declared by a migration', () => {
  it('actually finds queries, so this is not vacuous', () => {
    // A regex that matched nothing would make the assertion below pass forever
    // while checking no SQL at all.
    expect(refs.length, 'no SQL template literals were found in lib/ or src/').toBeGreaterThan(20);
  });

  it('finds the tables the product cannot run without', () => {
    const seen = new Set(refs.map((r) => r.table));
    for (const t of ['users', 'vault_items', 'release_state', 'audit_log']) {
      expect(seen, `${t} is queried nowhere — the extractor is missing statements`).toContain(t);
    }
  });

  it('references no table that no migration creates', () => {
    const undeclaredRefs = refs.filter(
      (r) => !declared.has(r.table) && !SYSTEM_TABLES.has(r.table) && !r.table.startsWith('sys.'),
    );

    const grouped = [...new Set(undeclaredRefs.map((r) => `${r.table}  ← ${r.file}`))];

    expect(
      grouped,
      `these tables are queried but no migration in db/migrations creates them:\n` +
        grouped.map((g) => `  ${g}`).join('\n') +
        `\nEither add the migration, or fix the query. A deploy that reads a table ` +
        `nothing creates fails with 'relation does not exist' on the first request that touches it.`,
    ).toEqual([]);
  });
});
