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
