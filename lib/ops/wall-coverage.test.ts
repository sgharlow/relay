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
 * The IAM user names named by `verify-roles.ts`'s own contract, read from its
 * `iamArn:` entries. Anchored on the property name so the ARN inside the
 * explanatory comment beside `relay_ro` — which is not a contract entry — cannot
 * be counted as one.
 */
function usersWatchedByVerifyRoles(): string[] {
  const src = readFileSync(ROLES_SCRIPT, 'utf8');
  const found = [...src.matchAll(/iamArn:\s*'arn:aws:iam::\d+:user\/([A-Za-z0-9_+=,.@-]+)'/g)].map(
    (m) => m[1],
  );
  return [...new Set(found)].sort();
}

describe('the database wall and the IAM wall watch the same identities', () => {
  it('finds a contract list in verify-roles.ts at all', () => {
    // If the regex stops matching — the script is renamed, the field is renamed,
    // the ARNs move to a constant — this test would otherwise pass by comparing
    // two empty sets, which is the "guard that cannot see its subject" shape
    // this repo has caught three times. Fail loudly instead.
    expect(usersWatchedByVerifyRoles().length).toBeGreaterThanOrEqual(3);
  });

  it('every identity verify:roles watches is also audited by verify:iam', () => {
    const iam = CONTRACTS.map((c) => c.user).sort();
    const missing = usersWatchedByVerifyRoles().filter((u) => !iam.includes(u));

    expect(missing, `add a PrincipalContract to lib/ops/iam-wall.ts CONTRACTS for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every identity verify:iam audits is also watched by verify:roles', () => {
    const roles = usersWatchedByVerifyRoles();
    const missing = CONTRACTS.map((c) => c.user).filter((u) => !roles.includes(u));

    expect(missing, `add a RoleContract to scripts/verify-roles.ts CONTRACT for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the two lists are the same set, not merely overlapping', () => {
    expect(CONTRACTS.map((c) => c.user).sort()).toEqual(usersWatchedByVerifyRoles());
  });
});
