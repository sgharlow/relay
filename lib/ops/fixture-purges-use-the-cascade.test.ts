/**
 * A fixture script may not invent its own account deletion.
 *
 * 🔴 THE DEFECT. `.env.local` points at the PRODUCTION cluster, because Relay
 * has no other one. Three fixture scripts cleaned up after themselves with
 * hand-written SQL, and each wrote a different, shorter cascade than the real
 * one:
 *
 *   scripts/capture-screens.ts  `DELETE FROM users WHERE id = $1` and nothing
 *                               else, then printed "cluster clean: no fixture
 *                               rows remain". Every vault_item, recipient,
 *                               release_state and audit_log row it had created
 *                               survived with a dangling owner_id.
 *   scripts/reset-demo.ts       seven tables, of the twenty-one the cascade
 *                               touches.
 *   scripts/family-arc.ts       ten.
 *
 * `deleteAccount()` in lib/account/lifecycle.ts is the integrity layer — this
 * schema has no foreign keys, so that function IS the referential integrity, and
 * it also cancels billing first and repairs the standby roles held in OTHER
 * owners' rosters, which no `WHERE owner_id = $1` can reach. D4 records the rule
 * in as many words: the product's own cascade, never a hand-written DELETE.
 *
 * ⚠️ AND THE CENSUS COULD NOT SEE THE RESULT. `disposable-sweep.ts` finds
 * accounts through `FROM users WHERE email LIKE …`, so a row whose users row is
 * already gone is invisible to it: the exact wreckage a users-only delete leaves
 * is the one shape `npm run verify:orphans` was structurally unable to report.
 * It now counts dangling owner ids per table as well.
 *
 * These checks are textual, for the reason
 * `disposable-sweep-matches-the-cascade.test.ts` gives: executing the SQL needs
 * the production cluster, which is the dependency this whole area exists to
 * remove.
 *
 * Feature: relay-h0-mvp
 * Requirements: D2, D4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Only executable text speaks for the file. A negative grep that reads comments
 * matches the paragraph explaining why the thing is banned — this repo has been
 * caught by that four times, and this file's own header names the banned SQL.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

const scripts = readdirSync('scripts')
  .filter((f) => /\.(ts|mjs)$/.test(f) && !f.startsWith('scratch-'))
  .map((f) => [`scripts/${f}`, codeOnly(readFileSync(`scripts/${f}`, 'utf8'))] as const);

describe('no script writes its own account cascade', () => {
  it('reads the scripts directory at all, so this suite is not vacuous', () => {
    expect(scripts.length).toBeGreaterThan(10);
  });

  it('nothing under scripts/ deletes a users row by hand', () => {
    const offenders = scripts
      .filter(([, src]) => /DELETE\s+FROM\s+users\b/i.test(src))
      .map(([name]) => name);

    expect(
      offenders,
      offenders.length
        ? 'These scripts delete a users row directly:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\nThis schema has no foreign keys, so `deleteAccount()` IS the referential ' +
          'integrity — and it also cancels billing first and releases the standby roles this ' +
          "account holds in other owners' rosters, which no `WHERE owner_id = $1` reaches. " +
          'Removing the users row alone leaves every owned row orphaned on the PRODUCTION ' +
          'cluster, and the sweep that would have found them keys off the users table. ' +
          'Call deleteAccount(id) from lib/account/lifecycle.ts instead.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    The positive half. Banning the SQL is not enough on its own — a script could
    satisfy the check above by simply not cleaning up, which is the other way
    fixture rows reach production.

    TWO WAYS COUNT, and the second is the better one. `deleteAccount()` in
    process is the cascade itself; `DELETE /api/account` is the product's own
    deletion path, which walks UC-20 and reaches the same function through the
    handler a real person would. e2e-ui.ts uses the latter deliberately — that
    IS the thing it is there to prove — so requiring the literal import would
    have pushed it toward the worse option.
  */
  it('every script that purges a fixture account goes through the cascade', () => {
    const purgers = scripts.filter(
      ([, src]) => /purge|wipeOwner|cleanup|leftover/i.test(src) && /FROM users\b/i.test(src),
    );
    expect(purgers.length, 'no fixture script looks up a user to purge any more').toBeGreaterThan(0);
    for (const [name, src] of purgers) {
      const inProcess = /deleteAccount\s*\(/.test(src);
      const throughTheProduct = /['"`]\/api\/account['"`]/.test(src);
      expect(
        inProcess || throughTheProduct,
        `${name} looks up fixture users to clean up and reaches neither deleteAccount() nor ` +
          "DELETE /api/account. Whatever it does instead is a cascade of its own invention, " +
          'run against production.',
      ).toBe(true);
    }
  });
});

describe('the orphan census can see what a bad purge leaves behind', () => {
  const sweep = readFileSync('scripts/disposable-sweep.ts', 'utf8');

  it('counts rows whose owner no longer exists', () => {
    expect(
      codeOnly(sweep),
      'disposable-sweep.ts finds accounts only through the users table, so rows left behind ' +
        'by a users-only delete are invisible to it — the census cannot see the exact damage ' +
        'it exists to report.',
    ).toMatch(/NOT IN \(SELECT id FROM users\)/i);
  });

  it('fails the run when it finds one', () => {
    // A census whose only output is prose is a census nobody notices going
    // quiet — the sweep's own header says so about its exit code.
    expect(sweep).toMatch(/dangling/i);
  });
});

/**
 * 🔴 AND THE CASCADE LEAVES SOMETHING BEHIND ON PURPOSE, WHICH A FIXTURE MUST NOT
 * INHERIT.
 *
 * `deleteAccount()` writes an `account_deleted` entry, RETAINS the audit trail
 * (privacy page; returned as `auditEntriesRetained`) and removes the users row
 * LAST. For a real person that is correct — closing an account must not erase
 * the record that it happened. For a throwaway fixture on the PRODUCTION cluster
 * it is litter with a dangling owner_id, and it accumulates one run at a time.
 *
 * reset-demo.ts and family-arc.ts each worked this out and added an explicit
 * `DELETE FROM audit_log` after the cascade, with the reasoning written down.
 * capture-screens.ts, editing the same area in the same session, did not — so
 * its backstop printed "purged leftover fixture user" while manufacturing
 * exactly the retained-orphan rows that `disposable-sweep.ts` then has to treat
 * as normal. Three scripts, one rule, two of them following it.
 *
 * This is the rule, applied where the mistake happens rather than left as a
 * comment for the next author to notice.
 */
describe('a fixture purge also removes the audit trail the cascade keeps', () => {
  /*
    Keyed on the IMPORT, not on `deleteAccount(` appearing somewhere. The sweep
    names the function inside a `console.log` string — advice to the operator
    reading its output — and a substring match read that as a call, which is the
    same "a mention is not a use" trap `codeOnly` was written for one layer down.
  */
  const callers = scripts.filter(([, src]) =>
    /import\s*\{[^}]*\bdeleteAccount\b[^}]*\}\s*from/.test(src),
  );

  it('finds the scripts that call the cascade in process, so this is not vacuous', () => {
    expect(
      callers.map(([name]) => name),
      'no script calls deleteAccount() any more — this guard has nothing to check',
    ).not.toEqual([]);
  });

  it('every one of them clears audit_log afterwards', () => {
    const offenders = callers
      .filter(([, src]) => !/DELETE\s+FROM\s+audit_log/i.test(src))
      .map(([name]) => name);

    expect(
      offenders,
      offenders.length
        ? 'These scripts close a fixture account and leave its audit trail behind:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\ndeleteAccount() retains audit_log deliberately, and deletes the users row last, ' +
          'so what survives is a row with a dangling owner_id on the PRODUCTION cluster. That ' +
          'is right for a real person and wrong for a fixture: nobody is entitled to that ' +
          'record and nothing will ever look at it. Follow the cascade with ' +
          '`DELETE FROM audit_log WHERE owner_id = $1` for the ids you closed, as ' +
          'reset-demo.ts and family-arc.ts do.'
        : 'ok',
    ).toEqual([]);
  });
});
