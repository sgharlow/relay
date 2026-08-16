/**
 * The half of the least-privilege wall that leaves no trace in the database.
 *
 * WHY THIS EXISTS, in the words of the sprint that shipped the cutover and said
 * so plainly: "the IAM half is not automated — re-adding `dsql:DbConnectAdmin`
 * would go unnoticed by `verify:roles`."
 *
 * The wall has two halves and they fail differently. `verify:roles` re-measures
 * the DATABASE half — what `relay_app` and `relay_dev` may do once connected —
 * by reading the live catalog. It cannot see the IAM half, which decides
 * something prior and stronger: whether the production principal can obtain an
 * ADMIN token at all. `dsqlIdentity()` returns `admin: true` whenever
 * `DSQL_ROLE` is unset, and before 2026-08-16 that is exactly what production
 * did. Stripping `dsql:DbConnectAdmin` from `relay-runtime-policy` is what makes
 * that unreachable by permission rather than by configuration: a token minted
 * with `dsql:DbConnect` cannot authenticate as `admin` however the client asks.
 *
 * One `aws iam create-policy-version` puts it back. It appears in no diff, no
 * test run and no build, and the app would keep working — which is the whole
 * problem. Nothing would be observably different until the day it mattered.
 *
 * 🔴 THREE WAYS THE ADMIN GRANT CAN COME BACK, and a check that saw only the
 * first would be the fourth thing in this repo to pass on the defect it was
 * written for:
 *
 *   1. the literal action re-added to the attached managed policy
 *   2. a WILDCARD — `dsql:*`, or `*` — which confers it without naming it
 *   3. an INLINE user policy, which is a different API call entirely and is
 *      invisible to anyone listing attached policies
 *
 * AND THE POSITIVE HALF MATTERS TOO. A policy stripped to nothing grants no
 * admin and takes the site down; reporting that as "secure" would be a check
 * that is happiest when the product is broken. `dsql:DbConnect` must still be
 * there.
 *
 * Feature: relay-h0-mvp
 */

/** One IAM policy document, as returned by the IAM API (already URL-decoded). */
export interface PolicyDocument {
  Version?: string;
  Statement?: Statement[];
}

interface Statement {
  Sid?: string;
  Effect?: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
}

/** A policy document paired with where it came from, so a finding can be acted on. */
export interface NamedPolicy {
  /** e.g. "managed relay-runtime-policy v2" or "inline dsql-extra". */
  source: string;
  document: PolicyDocument;
}

export interface WallVerdict {
  ok: boolean;
  /** Every way an admin connection is reachable. Empty is the goal. */
  adminGrants: string[];
  /** True when at least one policy grants the ordinary connect the app needs. */
  connectGranted: boolean;
  reason: string;
}

const ADMIN_ACTION = 'dsql:dbconnectadmin';
const CONNECT_ACTION = 'dsql:dbconnect';

function actionsOf(s: Statement): string[] {
  const a = s.Action ?? [];
  return (Array.isArray(a) ? a : [a]).map((x) => String(x).toLowerCase());
}

/**
 * Does this action string confer `target`?
 *
 * `dsql:*` and `*` both do, without containing it. Matching is on the shape IAM
 * actually uses — a service prefix and a wildcard suffix — rather than a general
 * glob, because the only wildcards that appear in practice are these.
 */
function confers(action: string, target: string): boolean {
  if (action === '*') return true;
  if (action === target) return true;
  if (action.endsWith('*')) return target.startsWith(action.slice(0, -1));
  return false;
}

/**
 * Reads the wall off a set of policy documents.
 *
 * `NotAction` with Allow is treated as conferring everything it does not
 * exclude, which is what it means. It is not used here today; it is handled
 * because it is the classic way an allow-list check is defeated by a policy
 * that never names the action.
 */
export function readWall(policies: NamedPolicy[]): WallVerdict {
  const adminGrants: string[] = [];
  let connectGranted = false;

  for (const { source, document } of policies) {
    for (const s of document.Statement ?? []) {
      if ((s.Effect ?? 'Allow') !== 'Allow') continue;

      if (s.NotAction !== undefined) {
        const excluded = (Array.isArray(s.NotAction) ? s.NotAction : [s.NotAction]).map((x) =>
          String(x).toLowerCase(),
        );
        if (!excluded.some((e) => confers(e, ADMIN_ACTION))) {
          adminGrants.push(`${source} · ${s.Sid ?? 'unnamed'} · NotAction allows everything else`);
        }
        if (!excluded.some((e) => confers(e, CONNECT_ACTION))) connectGranted = true;
        continue;
      }

      for (const action of actionsOf(s)) {
        if (confers(action, ADMIN_ACTION)) {
          adminGrants.push(`${source} · ${s.Sid ?? 'unnamed'} · "${action}"`);
        }
        if (confers(action, CONNECT_ACTION)) connectGranted = true;
      }
    }
  }

  if (adminGrants.length) {
    return {
      ok: false,
      adminGrants,
      connectGranted,
      reason:
        `the production principal can obtain a DSQL ADMIN token: ${adminGrants.join('; ')}. ` +
        `DSQL_ROLE unset means admin, so this is one unset environment variable away from a ` +
        `live site with DDL rights over all 25 tables. docs/least-privilege-cutover.md holds ` +
        `the strip command.`,
    };
  }

  if (!connectGranted) {
    return {
      ok: false,
      adminGrants,
      connectGranted,
      reason:
        `no policy grants dsql:DbConnect. That is not a secure state, it is a broken one — ` +
        `the live site cannot reach its database at all. A wall check that is happiest when ` +
        `the product is down is checking the wrong thing.`,
    };
  }

  return {
    ok: true,
    adminGrants,
    connectGranted,
    reason: 'dsql:DbConnect granted, dsql:DbConnectAdmin unreachable — the IAM half of the wall holds',
  };
}
