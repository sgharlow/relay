/**
 * `relay_ro` is bound to TWO IAM principals on purpose, and the contract says so.
 *
 * 🔴 THE RULE THIS DELIBERATELY BENDS IS THE ONE WORTH BEING CAREFUL ABOUT.
 * `scripts/verify-roles.ts` has held, since it was written, that a database role
 * is bound to exactly ONE IAM principal and that anything else is a side door:
 * "A second principal on a role is how a wall quietly acquires a side door."
 * D21 adds a second one — the GitHub Actions OIDC role `relay-ro-ci`, so CI can
 * hold a read-only database identity with no stored secret.
 *
 * A rule bent by adding a name to a list is a rule that still holds. A rule bent
 * by deleting the check is a rule that is gone, and the difference is invisible
 * in a diff six months later. So the contract now DECLARES the set of principals
 * bound to each role, the "extra principal" finding fires against that declared
 * set, and a THIRD principal on `relay_ro` is still a finding — which is what
 * this file pins.
 *
 * ⚠️ IT READS THE SCRIPT AS TEXT, for the reason `wall-coverage.test.ts` already
 * gives about the same file: `CONTRACT` is a file-local const in an executable
 * that runs `main()` on import, and exporting it to satisfy a test would change
 * the shape of the thing under test. The limitation is stated rather than left
 * implicit — this proves the contract's SHAPE, never that a live cluster agrees
 * with it. Only `npm run verify:roles` can do that, and only after the grant is
 * applied.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.4 (least privilege)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { CONTRACTS } from './iam-wall';

const ROLES_SCRIPT = join(process.cwd(), 'scripts', 'verify-roles.ts');
const MIGRATION = join(process.cwd(), 'db', 'migrations', '040_relay_ro_ci_grant.sql');

/** The one ARN this whole change turns on, written here once. */
const CI_ROLE_ARN = 'arn:aws:iam::461293170793:role/relay-ro-ci';
const RO_USER_ARN = 'arn:aws:iam::461293170793:user/relay-ro';

/**
 * Every `{ role, iamArns }` pair the script declares, read out of its source.
 *
 * Anchored on `role:` and then the NEXT `iamArns: [...]`, so an ARN mentioned in
 * a comment cannot be counted as a declaration — the same trap
 * `wall-coverage.test.ts` names about the explanatory comment beside `relay_ro`.
 */
function declaredPrincipals(): Map<string, string[]> {
  const src = readFileSync(ROLES_SCRIPT, 'utf8');
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/role:\s*'([a-z_]+)',\s*iamArns:\s*\[([\s\S]*?)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'(arn:aws:iam::[^']+)'/g)].map((a) => a[1]));
  }
  return out;
}

describe('the contract declares the second principal rather than dropping the check', () => {
  it('finds a contract in verify-roles.ts at all, so nothing below passes vacuously', () => {
    // The failure this guards is a rename: `iamArns` becomes something else, the
    // regex matches nothing, and every assertion below compares empty to empty.
    expect(declaredPrincipals().size).toBe(3);
  });

  it('declares BOTH principals for relay_ro — the user and the CI role', () => {
    expect(declaredPrincipals().get('relay_ro')).toEqual([RO_USER_ARN, CI_ROLE_ARN]);
  });

  it('leaves the other two roles at exactly one principal each', () => {
    // The bend is scoped to the one role it was argued for. relay_app is the
    // live site and relay_dev is a laptop; a second principal on either is the
    // side door the original rule was written about.
    expect(declaredPrincipals().get('relay_app')).toEqual([
      'arn:aws:iam::461293170793:user/relay-runtime',
    ]);
    expect(declaredPrincipals().get('relay_dev')).toEqual([
      'arn:aws:iam::461293170793:user/relay-dev',
    ]);
  });

  it('still reports an EXTRA principal — a third ARN is a finding, not a widening', () => {
    const src = readFileSync(ROLES_SCRIPT, 'utf8');
    // The finding survives, and it is computed against the DECLARED SET rather
    // than against a single ARN — which is the only shape in which "one more
    // than we declared" remains answerable.
    expect(src).toContain('EXTRA IAM principals');
    expect(src).toMatch(/bound\.filter\(\(a\) => !c\.iamArns\.includes\(a\)\)/);
    // And the other direction: every declared principal must actually be bound,
    // or the CI role is declared and the cluster never got the grant.
    expect(src).toMatch(/c\.iamArns\.filter\(\(a\) => !bound\.includes\(a\)\)/);
  });
});

describe('migration 040 binds the second principal, and says why', () => {
  it('exists', () => {
    expect(existsSync(MIGRATION), 'db/migrations/040_relay_ro_ci_grant.sql is missing').toBe(true);
  });

  it('binds relay_ro to the CI ROLE and does nothing else', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    expect(statements).toEqual([`AWS IAM GRANT relay_ro TO '${CI_ROLE_ARN}'`]);
  });

  it('explains that the second principal is deliberate, in the file a reader opens', () => {
    // A one-line migration whose whole content contradicts a rule stated in
    // another file is the shape that gets "cleaned up" by somebody who only
    // read the rule. The argument travels with the statement.
    const header = readFileSync(MIGRATION, 'utf8');
    expect(header).toMatch(/second principal/i);
    expect(header).toMatch(/\.env\.admin/);
    expect(header).toMatch(/both regions/i);
  });
});

describe('one ARN, spelled the same way in all three places', () => {
  it('the migration, the verify:roles contract and the IAM contract name the same role', () => {
    // A cross-boundary identity re-expressed three times is three chances to be
    // wrong in a way no single file can see: the grant would bind a role that
    // the IAM wall never audits, and verify:roles would report an extra
    // principal for the role the grant actually created.
    const fromContract = CONTRACTS.find((c) => c.user === 'relay-ro-ci');
    expect(fromContract, 'lib/ops/iam-wall.ts has no contract for relay-ro-ci').toBeDefined();
    expect(fromContract?.kind).toBe('role');
    expect(CI_ROLE_ARN.endsWith(`:role/${fromContract?.user}`)).toBe(true);
    expect(readFileSync(MIGRATION, 'utf8')).toContain(CI_ROLE_ARN);
    expect(declaredPrincipals().get('relay_ro')).toContain(CI_ROLE_ARN);
  });
});
