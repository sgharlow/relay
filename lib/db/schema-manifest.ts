/**
 * What the migrations SAY the database contains.
 *
 * WHY THIS EXISTS. `db/migrations/migrate.ts` applies ONE named file and tracks
 * nothing: "Migrations are NOT tracked in a table; pass the file you intend to
 * apply." So the set of migrations that have actually reached a cluster is not
 * recorded anywhere — not in the database, not in the repo, not in a ledger.
 * The only way to know is to look at the tables and remember.
 *
 * On 2026-08-15 that gap produced its first alert. Migration 029 carries an
 * unusually loud header — "⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT USES
 * IT. Not a preference — an ordering requirement with teeth" — because the code
 * that needs `auth_challenges` throws rather than silently falling back to the
 * weaker stateless seal. That direction is right. But the ordering it demands
 * was enforced by a comment, and a comment is not a check: for four minutes a
 * dev server threw `relation "auth_challenges" does not exist` on every passkey
 * sign-in, and the only thing that noticed was an email that misattributed it
 * to production.
 *
 * That instance was harmless — one laptop, four minutes, caught immediately.
 * The class is not. The same omission against production takes out passkey
 * registration and sign-in for everyone, loudly, and the first report is a
 * customer. A missing migration is invisible until something reads the table.
 *
 * This module is the cheap half of closing that: parse what the migrations
 * declare, so a script can compare it against what a cluster actually has. It
 * is deliberately pure and file-free — it takes SQL text, not paths — so it
 * unit-tests in CI with no database and no credentials, and the half that DOES
 * need credentials (scripts/verify-schema.ts) stays a one-command human check
 * alongside verify:live.
 *
 * Feature: relay-h0-mvp
 */

/**
 * Table names declared by `CREATE TABLE [IF NOT EXISTS] <name>` across the
 * given migration SQL, lowercased and de-duplicated.
 *
 * Comments are stripped first. This is not fastidiousness: `002_unique_auth_sub`
 * is an unapplied draft, several migrations quote DDL in their prose to explain
 * what they are NOT doing, and a manifest that believed those would report
 * permanent, unfixable drift — a check that cries wolf gets muted exactly like
 * an alerting channel that does.
 *
 * Only tables. Indexes and constraints are deliberately out of scope: DSQL
 * builds `CREATE INDEX ASYNC` in the background, so an index can be legitimately
 * absent from `pg_indexes` for a while after a correct apply, and a drift check
 * that reports a false positive on a good day is worse than no check.
 */
export function declaredTables(sqlSources: readonly string[]): string[] {
  const names = new Set<string>();

  for (const raw of sqlSources) {
    const sql = stripComments(raw);
    const pattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
    for (const match of sql.matchAll(pattern)) {
      names.add(match[1].toLowerCase());
    }
  }

  return [...names].sort();
}

/** Strips `--` line comments and `/* *​/` block comments. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

export interface SchemaDrift {
  /** Declared by a migration, absent from the cluster. The dangerous direction. */
  missing: string[];
  /** Present on the cluster, declared by no migration. Worth knowing, not fatal. */
  undeclared: string[];
}

/**
 * Compares what the migrations declare against what a cluster reports.
 *
 * The two directions are NOT symmetric, and the caller is expected to treat
 * them differently. `missing` is the failure that produced this module: code is
 * deployed against a table that is not there, and every path touching it is
 * broken. `undeclared` is usually archaeology — a table created by hand, or a
 * migration deleted after the fact — and is reported without failing, because
 * an extra table breaks nothing and turning it into an error would make the
 * check something people learn to skip.
 */
export function compareSchema(declared: readonly string[], live: readonly string[]): SchemaDrift {
  const liveSet = new Set(live.map((t) => t.toLowerCase()));
  const declaredSet = new Set(declared.map((t) => t.toLowerCase()));

  return {
    missing: [...declaredSet].filter((t) => !liveSet.has(t)).sort(),
    undeclared: [...liveSet].filter((t) => !declaredSet.has(t)).sort(),
  };
}

/** One column a migration adds to a table that already exists. */
export interface DeclaredColumn {
  table: string;
  column: string;
}

/**
 * Columns declared by `ALTER TABLE <t> ADD COLUMN [IF NOT EXISTS] <c>` across
 * the given migration SQL, lowercased and de-duplicated.
 *
 * WHY THIS IS SEPARATE FROM `declaredTables`, AND WHY IT IS NARROWER.
 * `pg_tables` answers "does the table exist", and that is the only question the
 * live check could ask until now. A migration that adds a column to a table
 * already present is therefore invisible to it: the check passes, the column is
 * absent, and the failure surfaces as a runtime error on whichever write path
 * touches it first. 034 of this repo's 34 migrations add columns rather than
 * tables, so that is now the likelier half of the class.
 *
 * ONLY `ALTER TABLE ... ADD COLUMN`. Columns inside a `CREATE TABLE` body are
 * deliberately out of scope: they arrive with their table or not at all, so the
 * table check already answers for them, and parsing a table body means parsing
 * types, constraints and multi-line definitions — the place a drift check earns
 * its false positives. Same reasoning that keeps indexes out.
 *
 * Comments are stripped first, and that matters more here than it does for
 * tables: these migrations argue with themselves in prose. 034 spends thirty
 * lines explaining the column it is NOT writing and why, and 033 quotes DDL it
 * deliberately does not run.
 */
export function declaredColumns(sqlSources: readonly string[]): DeclaredColumn[] {
  const seen = new Map<string, DeclaredColumn>();

  for (const raw of sqlSources) {
    const sql = stripComments(raw);
    const pattern =
      /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
    for (const match of sql.matchAll(pattern)) {
      const table = match[1].toLowerCase();
      const column = match[2].toLowerCase();
      seen.set(`${table}.${column}`, { table, column });
    }
  }

  return [...seen.values()].sort((a, b) =>
    a.table === b.table ? a.column.localeCompare(b.column) : a.table.localeCompare(b.table),
  );
}

export interface ColumnDrift {
  /** Declared by a migration, absent from the cluster. */
  missing: DeclaredColumn[];
}

/**
 * Compares the columns migrations add against the columns a cluster reports.
 *
 * ONE DIRECTION ONLY, unlike `compareSchema`, and that asymmetry is a decision
 * rather than an omission to tidy up later. Only ADD COLUMN statements are
 * parsed, so every column that arrived with its own CREATE TABLE — which is
 * most of them — would read as "undeclared". Reporting that would bury the one
 * direction that matters under a hundred lines of noise on every run, and a
 * check whose output nobody reads is the failure mode this whole module exists
 * to argue against.
 */
export function compareColumns(
  declared: readonly DeclaredColumn[],
  live: readonly DeclaredColumn[],
): ColumnDrift {
  const liveSet = new Set(live.map((c) => `${c.table.toLowerCase()}.${c.column.toLowerCase()}`));

  return {
    missing: declared.filter((c) => !liveSet.has(`${c.table}.${c.column}`)),
  };
}
