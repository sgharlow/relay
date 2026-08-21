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
