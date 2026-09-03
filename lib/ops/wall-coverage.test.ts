/**
 * The two least-privilege instruments must watch the same set of identities.
 *
 * 🔴 THE MISTAKE THIS GUARDS AGAINST HAS ALREADY HAPPENED, TWICE IN ONE DAY.
 * `relay-ro` was created on 2026-08-21. `scripts/verify-roles.ts` grew a
 * contract for it in the same change; `lib/ops/iam-wall.ts` did not, and was
 * "hardcoded to one user" — so for part of that day the new identity was
 * audited at the database layer and by NOTHING at the IAM layer. That was
 * caught by a sweep, by hand, and closed the same day. Nothing stopped it
 * recurring, and the next identity gets added by somebody who has read neither
 * file.
 *
 * The two halves are not interchangeable and that is exactly why both are
 * required. `verify:roles` connects to the database: it reads
 * `sys.iam_pg_role_mappings`, so it sees WHICH ARN is bound to a role and what
 * that role may do once connected. `verify:iam` reads the IAM API: it sees what
 * that ARN's POLICY permits — including whether it can obtain an admin token at
 * all, and whether it holds any `kms:*` action. An identity in one list and not
 * the other has half a wall, and the half it is missing is invisible from the
 * instrument it does have.
 *
 * WHY IT PARSES A SCRIPT. `scripts/verify-roles.ts` is an executable, not a
 * module: its `CONTRACT` is a file-local const and exporting it to satisfy a
 * test would change the shape of the thing under test. Reading the source is
 * what `lib/ops/body-limit.ts` and `lib/ops/route-auth.ts` already do for the
 * same reason — the claim being checked is about a file, so the file is what is
 * read.
 *
 * ⚠️ THIS PROVES SET EQUALITY AND NOTHING ELSE. It does not prove either
 * contract is CORRECT — `iam-wall.test.ts` covers the rules, and only a run
 * against the live account proves the account. A name in both lists with a
 * contract that forbids nothing would pass here.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACTS } from './iam-wall';

const ROLES_SCRIPT = join(process.cwd(), 'scripts', 'verify-roles.ts');

/**
 * The IAM principals named by `verify-roles.ts`'s own contract, read from its
 * `iamArns:` arrays. Anchored on the property name so the ARN inside the
 * explanatory comment beside `relay_ro` — which is not a contract entry — cannot
 * be counted as one.
 *
 * ⚠️ IT READS ROLES AS WELL AS USERS SINCE 2026-09-02 (D21), and the field is
 * now a LIST. `relay_ro` is bound to two principals on purpose — the user
 * `relay-ro` and the OIDC role `relay-ro-ci` — so a matcher pinned to
 * `iamArn:` and to `:user/` would have gone on comparing an incomplete set
 * while reporting equality, which is this file's own failure shape.
 */
function usersWatchedByVerifyRoles(): string[] {
  const src = readFileSync(ROLES_SCRIPT, 'utf8');
  const found = [...src.matchAll(/iamArns:\s*\[([\s\S]*?)\]/g)]
    .flatMap((m) => [
      ...m[1].matchAll(/'arn:aws:iam::\d+:(?:user|role)\/([A-Za-z0-9_+=,.@-]+)'/g),
    ])
    .map((m) => m[1]);
  return [...new Set(found)].sort();
}

/**
 * CONTRACTS entries that have a database half — i.e. everything the two walls
 * can meaningfully be compared across.
 *
 * 🔴 THE EXCLUSION IS A NAMED LIST, NOT A KIND, SINCE 2026-09-02. It was
 * `kind === 'user'`, which was right while every role was a KMS reader that
 * never connects to the database. `relay-ro-ci` is a role that DOES connect —
 * it is the read-only database identity reached from a runner — so excluding
 * roles by kind would have dropped it out of the comparison silently, and the
 * one identity D21 exists to add would have been the one identity this guard
 * could not see. Naming the exception costs a sentence and cannot be got wrong
 * by a future contract's `kind`.
 */
const NO_DATABASE_HALF = ['relay-kms-wall-ci'];

function dbPrincipals(): string[] {
  return CONTRACTS.filter((c) => !NO_DATABASE_HALF.includes(c.user))
    .map((c) => c.user)
    .sort();
}

describe('the database wall and the IAM wall watch the same identities', () => {
  it('finds a contract list in verify-roles.ts at all', () => {
    // If the regex stops matching — the script is renamed, the field is renamed,
    // the ARNs move to a constant — this test would otherwise pass by comparing
    // two empty sets, which is the "guard that cannot see its subject" shape
    // this repo has caught three times. Fail loudly instead.
    expect(usersWatchedByVerifyRoles().length).toBeGreaterThanOrEqual(4);
  });

  it('every identity verify:roles watches is also audited by verify:iam', () => {
    const iam = CONTRACTS.map((c) => c.user).sort();  // roles included — a DB identity may never be missing from IAM
    const missing = usersWatchedByVerifyRoles().filter((u) => !iam.includes(u));

    expect(missing, `add a PrincipalContract to lib/ops/iam-wall.ts CONTRACTS for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every DATABASE identity verify:iam audits is also watched by verify:roles', () => {
    const roles = usersWatchedByVerifyRoles();
    const missing = dbPrincipals().filter((u) => !roles.includes(u));

    expect(missing, `add a RoleContract to scripts/verify-roles.ts CONTRACT for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the ONLY principal excluded from that comparison is the one with no database half', () => {
    /*
      🆕 2026-08-29 (B16.4). `relay-kms-wall-ci` is an IAM ROLE that reads KMS
      metadata from GitHub Actions. It never connects to the database, so it has
      no `sys.iam_pg_role_mappings` row and cannot have a verify:roles contract
      — demanding one would mean inventing a database identity to satisfy a test.

      ⚠️ THE EXCLUSION MOVED FROM A KIND TO A NAME on 2026-09-02, because
      `relay-ro-ci` is a role that DOES connect to the database. Exempting roles
      as a class would have exempted it, and the set-equality guard would have
      reported agreement while the new identity sat in one list only — which is
      exactly the hole this file was written for, re-opened by a rule that had
      been correct the day before. Adding ANY principal now fails the tests
      above until it is either watched by both walls or written into
      NO_DATABASE_HALF with a reason.
    */
    const excluded = CONTRACTS.filter((c) => !dbPrincipals().includes(c.user));
    expect(excluded.every((c) => c.kind === 'role')).toBe(true);
    expect(excluded.map((c) => c.user)).toEqual(NO_DATABASE_HALF);
    // Named because it reads KMS metadata and holds no dsql grant at all, so it
    // has no `sys.iam_pg_role_mappings` row for verify:roles to read.
    expect(NO_DATABASE_HALF).toEqual(['relay-kms-wall-ci']);
  });

  it('the two lists are the same set of DATABASE identities, not merely overlapping', () => {
    // Set equality, not "each is a subset of the other by accident". Scoped to
    // users since 2026-08-29 — see the exclusion case above, which asserts that
    // the only thing this scoping drops is an IAM role with no database half.
    expect(dbPrincipals()).toEqual(usersWatchedByVerifyRoles());
  });
});
