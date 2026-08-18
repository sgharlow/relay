/**
 * Tests for the migration manifest.
 *
 * The gap this closes: nothing knew which migrations had reached a cluster.
 * `migrate.ts` applies one named file and tracks nothing, so "is the schema
 * this deploy needs actually present?" had no answer short of remembering. On
 * 2026-08-15 a passkey route threw `relation "auth_challenges" does not exist`
 * for four minutes because migration 029 had been written but not yet applied —
 * and the only thing that noticed misreported it as a production failure.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

import { declaredTables, compareSchema, declaredColumns, compareColumns } from './schema-manifest';

describe('declaredTables', () => {
  it('finds a plain CREATE TABLE', () => {
    expect(declaredTables(['CREATE TABLE users (id UUID);'])).toEqual(['users']);
  });

  it('finds IF NOT EXISTS, which is how every migration here is written', () => {
    expect(declaredTables(['CREATE TABLE IF NOT EXISTS auth_challenges (id UUID);'])).toEqual([
      'auth_challenges',
    ]);
  });

  it('is case- and whitespace-insensitive, and de-duplicates across files', () => {
    const names = declaredTables([
      'create   table\n  IF NOT EXISTS   Vault_Items (id UUID);',
      'CREATE TABLE IF NOT EXISTS vault_items (id UUID);',
    ]);
    expect(names).toEqual(['vault_items']);
  });

  it('ignores a table named only inside a comment', () => {
    /*
      Not fastidiousness. Migrations in this repo explain themselves at length,
      and several quote DDL in prose to describe what they are deliberately NOT
      doing — 029's header discusses the UNIQUE index it declines to create. A
      manifest that believed comments would report permanent, unfixable drift,
      and a check that cries wolf gets muted exactly like an alerting channel.
    */
    const sql = `
      -- CREATE TABLE ghost_line (id UUID);
      /* CREATE TABLE ghost_block (id UUID); */
      CREATE TABLE IF NOT EXISTS real_table (id UUID);
    `;
    expect(declaredTables([sql])).toEqual(['real_table']);
  });

  it('finds several tables in one file', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS a (id UUID);
      CREATE INDEX ASYNC idx_a ON a (id);
      CREATE TABLE IF NOT EXISTS b (id UUID);
    `;
    expect(declaredTables([sql])).toEqual(['a', 'b']);
  });

  it('does not mistake an index for a table', () => {
    expect(declaredTables(['CREATE INDEX ASYNC idx_x ON y (id);'])).toEqual([]);
  });
});

describe('compareSchema', () => {
  it('reports a declared table that the cluster does not have', () => {
    // The 2026-08-15 shape exactly.
    const drift = compareSchema(['users', 'auth_challenges'], ['users']);
    expect(drift.missing).toEqual(['auth_challenges']);
    expect(drift.undeclared).toEqual([]);
  });

  it('reports an undeclared table separately, because it is not a failure', () => {
    const drift = compareSchema(['users'], ['users', 'scratch_table']);
    expect(drift.missing).toEqual([]);
    expect(drift.undeclared).toEqual(['scratch_table']);
  });

  it('is clean when both sides agree', () => {
    const drift = compareSchema(['users', 'vault_items'], ['vault_items', 'users']);
    expect(drift).toEqual({ missing: [], undeclared: [] });
  });
});

/*
  The half that runs without credentials. `scripts/verify-schema.ts` is the
  other half and needs a cluster; this one asserts the manifest is real — that
  it parses the actual migration directory and produces the table set the
  product depends on, so a parser regression cannot quietly reduce the check to
  "nothing declared, therefore nothing missing", which would pass forever.
*/
describe('the manifest against the real migration directory', () => {
  const sources = readdirSync('db/migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`db/migrations/${f}`, 'utf8'));

  it('parses every migration file in the repo', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('declares the tables the product cannot run without', () => {
    // A vacuous manifest is the failure mode that would make the live check
    // pass forever while checking nothing, so name what must be in it.
    const names = declaredTables(sources);
    for (const required of [
      'users',
      'vault_items',
      'release_state',
      'audit_log',
      'auth_challenges',
      'webauthn_credentials',
    ]) {
      expect(names, `${required} is missing from the parsed manifest`).toContain(required);
    }
  });
});

/*
  Columns added to a table that already exists.

  THE HOLE THIS CLOSES. `verify:schema` compares `pg_tables` — table names and
  nothing else — so a migration whose entire content is
  `ALTER TABLE vault_items ADD COLUMN owner_set_irreplaceable BOOLEAN` is
  invisible to it. The table was already there; the check passes; the column is
  absent; and the first thing to notice is the vault write path throwing
  `column "owner_set_irreplaceable" does not exist` at whoever pressed Save.

  That is the 2026-08-15 failure with the table swapped for a column, and it is
  the more likely of the two now: 034 of 34 migrations add columns rather than
  tables, and two of those columns (`owner_set_root`, `owner_set_irreplaceable`)
  carry the owner's own overrides — the values the product promises not to
  overwrite.
*/
describe('declaredColumns', () => {
  it('finds a plain ALTER TABLE ... ADD COLUMN', () => {
    expect(declaredColumns(['ALTER TABLE vault_items ADD COLUMN irreplaceable BOOLEAN;'])).toEqual([
      { table: 'vault_items', column: 'irreplaceable' },
    ]);
  });

  it('finds the IF NOT EXISTS form, which is how every migration here is written', () => {
    expect(
      declaredColumns([
        'ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS owner_set_irreplaceable BOOLEAN;',
      ]),
    ).toEqual([{ table: 'vault_items', column: 'owner_set_irreplaceable' }]);
  });

  it('is case- and whitespace-insensitive, and de-duplicates across files', () => {
    expect(
      declaredColumns([
        'alter   table\n  Vault_Items   add column\n IF NOT EXISTS  Owner_Set_Root BOOLEAN;',
        'ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS owner_set_root BOOLEAN;',
      ]),
    ).toEqual([{ table: 'vault_items', column: 'owner_set_root' }]);
  });

  it('ignores a column named only inside a comment', () => {
    /*
      Migration 034 spends thirty lines of prose explaining `owner_set_root`,
      `irreplaceable` and the column it does NOT write, and 033 quotes DDL it is
      deliberately not running. A manifest that believed its own commentary
      would report permanent, unfixable drift — the check would cry wolf and be
      muted, which is the failure mode the table half of this module already
      argues against at length.
    */
    const sql = `
      -- ALTER TABLE vault_items ADD COLUMN never_written TEXT;
      /* ALTER TABLE users ADD COLUMN also_never TEXT; */
      ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS real_one BOOLEAN;
    `;
    expect(declaredColumns([sql])).toEqual([{ table: 'vault_items', column: 'real_one' }]);
  });

  it('ignores columns inside a CREATE TABLE body, which the table check already covers', () => {
    /*
      Deliberately out of scope, for the same reason indexes are. A column in a
      CREATE TABLE arrives with its table or not at all, so the presence check
      one level up already answers for it — and parsing a table body means
      parsing types, constraints and multi-line definitions, which is where a
      drift check earns its false positives.
    */
    expect(declaredColumns(['CREATE TABLE IF NOT EXISTS users (id UUID, email TEXT);'])).toEqual([]);
  });
});

describe('compareColumns', () => {
  it('reports a declared column the cluster does not have', () => {
    const drift = compareColumns(
      [
        { table: 'vault_items', column: 'owner_set_root' },
        { table: 'vault_items', column: 'owner_set_irreplaceable' },
      ],
      [{ table: 'vault_items', column: 'owner_set_root' }],
    );
    expect(drift.missing).toEqual([{ table: 'vault_items', column: 'owner_set_irreplaceable' }]);
  });

  it('is clean when both sides agree', () => {
    const drift = compareColumns(
      [{ table: 'vault_items', column: 'owner_set_root' }],
      [
        { table: 'vault_items', column: 'owner_set_root' },
        { table: 'users', column: 'email' },
      ],
    );
    expect(drift.missing).toEqual([]);
  });

  it('never reports an undeclared live column, unlike the table comparison', () => {
    /*
      The asymmetry is deliberate and is NOT an oversight to be tidied up later.
      Only ADD COLUMN statements are parsed, so every column that arrived with
      its CREATE TABLE — which is most of them — would read as "undeclared".
      Reporting those would bury the one direction that matters under a hundred
      lines of noise on every run.
    */
    const drift = compareColumns([], [{ table: 'users', column: 'email' }]);
    expect(drift).toEqual({ missing: [] });
  });
});

describe('the column manifest against the real migration directory', () => {
  const sources = readdirSync('db/migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`db/migrations/${f}`, 'utf8'));

  it('finds the owner-override columns, which are what this check exists to protect', () => {
    // Anti-vacuity, same as the table half: a parser regression that returned
    // nothing would make the live check pass forever while checking nothing.
    const columns = declaredColumns(sources);
    for (const required of [
      { table: 'vault_items', column: 'owner_set_root' },
      { table: 'vault_items', column: 'owner_set_irreplaceable' },
    ]) {
      expect(columns, `${required.table}.${required.column} is missing from the manifest`).toContainEqual(
        required,
      );
    }
  });
});
