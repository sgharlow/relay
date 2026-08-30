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

import { OWNER_COLUMNS, RETAINED_BY_DESIGN, danglingLabel } from './disposable-accounts';

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

/**
 * Every `DELETE … WHERE <col> = $1` the cascade issues directly, as
 * `table.column` pairs.
 *
 * Deliberately skips the two deletes that reach their rows through a subquery
 * (`verifier_confirmations` by `release_state_id`, `consent_artifacts` by `id`):
 * neither table carries an owner id, so neither can be censused by one, and
 * demanding it would be demanding a column that does not exist. `users` is
 * skipped because it IS the table every other row is compared against.
 */
function cascadePurgesByOwnerId(src: string): Set<string> {
  const out = new Set<string>();
  for (const [, statement] of src.matchAll(/`(DELETE FROM[\s\S]*?)`/g)) {
    const flat = statement.replace(/\s+/g, ' ');
    const table = /DELETE FROM (\w+)/.exec(flat)?.[1];
    const where = flat.slice(flat.search(/\bWHERE\b/));
    if (!table || table === 'users' || /\bSELECT\b/i.test(where)) continue;
    for (const [, column] of where.matchAll(/(\w+) = \$1/g)) out.add(`${table}.${column}`);
  }
  return out;
}

/**
 * A `[table, column][]` census list in the sweep, as `table.column` pairs.
 * Returns null when the list is not there at all, so a renamed constant reads as
 * "this guard has gone blind" rather than as "nothing is missing".
 */
/**
 * The two census lists, as `table.column` sets.
 *
 * ⚠️ THESE USED TO BE PARSED OUT OF `scripts/disposable-sweep.ts` WITH A REGEX,
 * and they are imported now because the lists moved (2026-08-30). They moved
 * because a second consumer appeared — `lib/ops/orphan-health.ts`, which answers
 * the same question unattended — and eighteen table/column pairs copied into two
 * files is a contract expressed twice; the portfolio rule is one authoritative
 * definition per cross-boundary contract.
 *
 * Importing is strictly stronger than the regex it replaces. The old parser
 * carried a `| null` return and a "this guard is blind" tripwire precisely
 * because a reformat could stop it matching — and it would have stopped matching
 * on this very change, since the lists are now written `] as const;` and the
 * pattern demanded `]\s*;`. A missing export is a compile error instead, which
 * is a tripwire that cannot be silently tripped.
 */
function setOf(list: ReadonlyArray<readonly [string, string]>): Set<string> {
  return new Set(list.map(([t, c]) => danglingLabel(t, c)));
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

/**
 * 🔴 THE CENSUS FAILED THE RUN ON A CLUSTER IN A PERFECTLY CORRECT STATE.
 *
 * The dangling-owner census added on 2026-08-21 listed `audit_log` among the
 * tables whose orphan rows are wreckage. They are not. `deleteAccount()` writes
 * an `account_deleted` entry, deliberately RETAINS the audit trail (it is stated
 * on the privacy page and reported back as `auditEntriesRetained`), and deletes
 * the users row LAST. So the designed end state of every correctly-closed
 * account is at least one audit_log row whose owner_id points at a user that no
 * longer exists — and `npm run verify:orphans` printed
 * `FAIL: N row(s) point at a user that no longer exists` for it.
 *
 * That is the "monitor that cries wolf gets muted" shape the sweep's own header
 * invokes, manufactured by the sweep. The lane knew the retention: reset-demo.ts
 * and family-arc.ts each got an explicit `DELETE FROM audit_log` follow-up in the
 * same session, with a comment explaining exactly this.
 *
 * These checks are anchored to lifecycle.ts, not to the word "audit_log", so if
 * the cascade ever starts purging the audit trail the census is told to start
 * failing on it again.
 */
describe('the census fails on wreckage, and not on what the cascade keeps', () => {
  const code = codeOnly(LIFECYCLE);

  it('the cascade really does retain the audit trail', () => {
    expect(
      /DELETE FROM audit_log/i.test(code),
      'lib/account/lifecycle.ts now purges audit_log. The retention was the whole reason the ' +
        'orphan census excludes it — if a closure no longer leaves audit rows behind, move ' +
        'audit_log back into OWNER_COLUMNS in scripts/disposable-sweep.ts, because a dangling ' +
        'owner_id there is then wreckage again.',
    ).toBe(false);

    expect(
      /action: 'account_deleted'/.test(code),
      'the cascade no longer writes an account_deleted audit entry — that entry is why a ' +
        'closed account leaves a dangling audit row even when nothing went wrong.',
    ).toBe(true);
  });

  it('audit_log is not in the list that fails the run', () => {
    const fails = setOf(OWNER_COLUMNS);
    expect(fails.size, 'OWNER_COLUMNS is empty — this guard is blind').toBeGreaterThan(10);
    expect(
      [...fails].filter((k) => k.startsWith('audit_log.')),
      'OWNER_COLUMNS fails the run on dangling audit_log rows. Every correctly closed account ' +
        'leaves one, by design, so verify:orphans reports FAIL on a healthy cluster — and an ' +
        'alarm that fires when nothing is wrong is an alarm that gets muted. This now binds ' +
        'lib/ops/orphan-health.ts too, which reads the same list unattended.',
    ).toEqual([]);
  });

  it('and is still counted, as a notice rather than a failure', () => {
    /*
      Excluding it must not mean forgetting it. A retained audit trail is still
      worth a number — it is the only remaining trace of an account, and a count
      that jumps says a purge ran — it is simply not a defect.
    */
    const retained = setOf(RETAINED_BY_DESIGN);
    expect(
      retained.size,
      'RETAINED_BY_DESIGN is empty, so the audit rows a closure leaves behind are now invisible ' +
        'rather than merely not-a-failure. Count them and report them as a notice.',
    ).toBeGreaterThan(0);
    expect([...retained]).toContain('audit_log.owner_id');
  });
});

/**
 * The other direction, and the one that lets the census go quietly blind: a
 * table the cascade purges by owner id that the census does not ask about.
 *
 * `delegations` was exactly that — the cascade removes it with
 * `WHERE owner_id = $1 OR delegate_user_id = $1`, and the first census listed
 * neither column, so a users-only delete left dangling delegation rows that the
 * check written to find dangling rows could not see.
 */
describe('the census asks about every table the cascade purges by owner id', () => {
  it('derives a plausible set from the cascade, so this guard is not vacuous', () => {
    expect(cascadePurgesByOwnerId(codeOnly(LIFECYCLE)).size).toBeGreaterThan(10);
  });

  it('leaves no owner-scoped table uncensused', () => {
    const censused = new Set([...setOf(OWNER_COLUMNS), ...setOf(RETAINED_BY_DESIGN)]);
    const missing = [...cascadePurgesByOwnerId(codeOnly(LIFECYCLE))].filter((k) => !censused.has(k)).sort();

    expect(
      missing,
      missing.length
        ? 'deleteAccount() purges these by owner id and the orphan census never asks about them:\n' +
          missing.map((m) => `  ${m}`).join('\n') +
          '\n\nSo a users-row-only delete leaves them dangling and verify:orphans reports a clean ' +
          'cluster — the exact blindness the census was added to close, one table over.'
        : 'ok',
    ).toEqual([]);
  });
});
