/**
 * The sweep must recognise the same account shape the cascade repairs.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, and it was in the sweep's first draft.
 * `scripts/disposable-sweep.ts` asked for `standby_user_id`. That column exists
 * in no migration and in no query anywhere in this repo — the column is
 * `claimed_user_id`. Every unit test passed, `tsc` was clean, the build was
 * clean, and the script would have thrown on its first real run against
 * production. A SQL string is invisible to the type checker, which is precisely
 * why a script that only ever runs with credentials needs a guard that runs
 * without them.
 *
 * The deeper rule (global CLAUDE.md, "one authoritative definition per
 * cross-boundary contract"): `deleteAccount()` in lib/account/lifecycle.ts is the
 * authority on what an account HOLDS and what a standby role IS. If this sweep
 * recognised a narrower set than that cascade repairs, it would report an
 * account safe to close that closing would in fact orphan — and the orphaned
 * roster row is the 2026-08-12 production incident: a covered circle, a quiet
 * readiness banner, and nobody there on the day.
 *
 * These checks are textual on purpose. The alternative is executing the SQL,
 * which needs the production cluster — the thing this whole area exists to stop
 * depending on.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the countable half)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SWEEP = readFileSync('scripts/disposable-sweep.ts', 'utf8');
const LIFECYCLE = readFileSync('lib/account/lifecycle.ts', 'utf8');

/**
 * ⚠️ THE TRAP THIS AVOIDS HAS NOW BITTEN FOUR TIMES IN THIS REPO — api-reachability's
 * module specifiers, step-up-guard's `Once?` typo, type-scale's backtracking
 * lookahead, and this file on its first run. A NEGATIVE grep ("this string must
 * not appear") matches the comment that EXPLAINS why it must not appear. The
 * sweep's own header records that its first draft said `standby_user_id`, so the
 * naive check failed on the very edit that fixed the bug.
 *
 * Comments are annotation; only executable text is the file speaking in its own
 * voice. Same idea as `ownVoice()` in editorial-preflight-claims.test.ts, applied
 * to code instead of markdown. Positive checks read the whole file — a comment
 * cannot satisfy them, so there is nothing to strip.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Table names the cascade deletes by owner_id — what an account actually holds. */
function tablesDeletedByOwner(src: string): Set<string> {
  const out = new Set<string>();
  for (const [, table] of src.matchAll(/DELETE FROM (\w+) WHERE owner_id = \$1/g)) out.add(table);
  return out;
}

/** Tables the sweep counts rows in, from its OWNED_TABLES list. */
function tablesCountedBySweep(src: string): Set<string> {
  const block = /const OWNED_TABLES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) throw new Error('OWNED_TABLES has gone from the sweep — this guard is blind');
  return new Set(
    block[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
  );
}

describe('the sweep and the cascade agree about what an account is', () => {
  it('the standby-role column is the one the cascade actually uses', () => {
    /*
      Anchored to lifecycle.ts rather than to a literal, so renaming the column
      in both places passes and renaming it in one fails — which is the only
      behaviour worth having.
    */
    expect(
      /claimed_user_id/.test(LIFECYCLE),
      'lib/account/lifecycle.ts no longer mentions claimed_user_id. If the standby column was ' +
        'renamed, scripts/disposable-sweep.ts must be renamed with it — otherwise the sweep ' +
        'queries a column that does not exist and throws on its first real run.',
    ).toBe(true);

    expect(
      /claimed_user_id/.test(SWEEP),
      'scripts/disposable-sweep.ts does not query claimed_user_id, so it cannot see that an ' +
        'account stands by in someone else\'s roster — and it will report as sweepable an ' +
        'account whose deletion orphans a circle.',
    ).toBe(true);

    expect(
      /standby_user_id/.test(codeOnly(SWEEP)),
      'scripts/disposable-sweep.ts QUERIES standby_user_id, which exists in no migration and in ' +
        'no other query. The column is claimed_user_id. (Comments are excluded — the sweep\'s ' +
        'header names the wrong column in order to explain it.)',
    ).toBe(false);
  });

  it('the sweep reads standby roles from both roster tables, as the cascade does', () => {
    for (const table of ['recipients', 'verifiers']) {
      expect(
        new RegExp(`FROM ${table}\\s+WHERE claimed_user_id`).test(SWEEP),
        `the sweep does not count standby roles in ${table}; the cascade resigns from both`,
      ).toBe(true);
    }
  });

  it('the sweep counts every table the cascade deletes by owner_id', () => {
    const cascade = tablesDeletedByOwner(LIFECYCLE);
    const swept = tablesCountedBySweep(SWEEP);

    expect(cascade.size, 'no owner-scoped DELETEs found in lifecycle.ts — this guard is blind').toBeGreaterThan(4);

    /*
      Reported, not asserted equal. The sweep prints a row census to make a purge
      an informed act; it does not have to enumerate every optional table the
      cascade best-efforts. What it must never do is claim to summarise an
      account while missing one of the BIG ones — the tables that carry the
      owner's actual content.
    */
    const mustSummarise = ['vault_items', 'recipients', 'verifiers', 'access_rules', 'release_state'];
    const missing = mustSummarise.filter((t) => cascade.has(t) && !swept.has(t));

    expect(
      missing,
      missing.length
        ? 'The sweep\'s row census omits tables the cascade deletes:\n' +
          missing.map((m) => `  ${m}`).join('\n') +
          '\n\nAn account reported as holding "no rows" while holding vault items is a report ' +
          'that invites exactly the careless purge this script exists to make careful.'
        : 'ok',
    ).toEqual([]);
  });

  it('the sweep never writes', () => {
    /*
      The strongest property this script has, and the cheapest to lose in a later
      edit. Read-only is stated in its header; this is the check that keeps the
      header true.
    */
    const writes = [/\bDELETE FROM\b/, /\bUPDATE\s+\w+\s+SET\b/, /\bINSERT\s+INTO\b/, /\bDROP\b/, /\bTRUNCATE\b/];
    const found = writes.filter((re) => re.test(codeOnly(SWEEP))).map(String);

    expect(
      found,
      found.length
        ? 'scripts/disposable-sweep.ts contains a write statement:\n' +
          found.map((f) => `  ${f}`).join('\n') +
          '\n\nIt runs against PRODUCTION and is documented read-only. Deleting an account is ' +
          'deleteAccount()\'s job — it cancels billing first and repairs standby roles held in ' +
          'other owners\' rosters, neither of which a DELETE here would do, on a schema with no ' +
          'foreign keys to catch the difference.'
        : 'ok',
    ).toEqual([]);
  });
});
