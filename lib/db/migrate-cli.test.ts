/**
 * The migration runner is a loaded gun pointed at production, and nothing checked it.
 *
 * 🔴 TWO DEFECTS THIS WAS WRITTEN FOR, both live until 2026-08-21.
 *
 * 1. `const SQL_FILENAME = process.argv[2] ?? '001_initial.sql'` — a BARE
 *    invocation against the production cluster re-ran the bootstrap. It was
 *    harmless only by accident: every `CREATE TABLE` hits 42P07 and is skipped
 *    by the idempotence branch. Migration 029's header had already had to warn
 *    "migrate.ts applies ONE named file and silently applies 001 if called bare
 *    — pass the filename", which is a comment asking somebody to remember, on
 *    the one tool in this repo that runs as `admin` with DDL rights. A guard
 *    goes where the mistake happens.
 *
 * 2. `EXPECTED_TABLES` was a hand-written list of 8 names, and it printed
 *    "All 8 expected tables are present. ✓" while the migrations declare far
 *    more. A sanity check that congratulates you on a third of the schema is
 *    worse than none, because it is read as coverage. It is now derived from
 *    the file being applied via `declaredTables()`.
 *
 * TEXTUAL, like `disposable-sweep-matches-the-cascade.test.ts`, and for the same
 * reason: the alternative is executing the script, which needs `.env.admin` and
 * the production cluster — the thing this whole area exists to stop depending
 * on. `codeOnly` strips comments so that a header EXPLAINING the old default
 * cannot satisfy or defeat the check; that trap has bitten this repo four times.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { declaredTables } from './schema-manifest';

const MIGRATE = readFileSync('db/migrations/migrate.ts', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

describe('migrate.ts refuses to guess which migration you meant', () => {
  it('has no default filename — a bare call must not apply anything', () => {
    const code = codeOnly(MIGRATE);

    expect(
      /process\.argv\[2\]\s*\?\?/.test(code),
      'migrate.ts still defaults `process.argv[2]`. A bare `npx tsx db/migrations/migrate.ts` ' +
        'against production would re-run whatever that default names, as admin, with DDL ' +
        'rights. Require the argument instead.',
    ).toBe(false);

    expect(
      /process\.exit\(1\)/.test(code) && /argv\[2\]/.test(code),
      'migrate.ts must read argv[2] and exit non-zero when it is absent',
    ).toBe(true);
  });

  it('derives its sanity check from the migration it applied, not a frozen list', () => {
    const code = codeOnly(MIGRATE);

    expect(
      /declaredTables/.test(code),
      'migrate.ts does not use declaredTables(). A hand-maintained EXPECTED_TABLES goes stale ' +
        'the first time a migration adds a table, and then reports success over a schema it ' +
        'never looked at.',
    ).toBe(true);

    expect(
      /All \d+ expected tables/.test(code),
      'migrate.ts prints a hardcoded table count. Derive it from what the file declares.',
    ).toBe(false);
  });
});

describe('declaredTables answers for the file migrate.ts is about to apply', () => {
  it('reads the tables out of a single migration source', () => {
    // The property migrate.ts now depends on: given one file's SQL, name the
    // tables that file creates — so an ALTER-only migration correctly declares
    // none, rather than being compared against somebody else's list.
    expect(declaredTables([readFileSync('db/migrations/012_access_requests.sql', 'utf8')]))
      .toEqual(['access_requests']);

    expect(
      declaredTables([readFileSync('db/migrations/034_owner_set_irreplaceable.sql', 'utf8')]),
      'an ADD COLUMN migration declares no tables; verify:schema is what checks its columns',
    ).toEqual([]);
  });
});
