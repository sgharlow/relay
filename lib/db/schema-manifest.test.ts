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

import { declaredTables, compareSchema } from './schema-manifest';

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
