/**
 * The half of the least-privilege wall that leaves no trace in the database.
 *
 * WHY THIS EXISTS, in the words of the sprint that shipped the cutover and said
 * so plainly: "the IAM half is not automated — re-adding `dsql:DbConnectAdmin`
 * would go unnoticed by `verify:roles`."
 *
 * The wall has two halves and they fail differently. `verify:roles` re-measures
 * the DATABASE half — what a role may do once connected — by reading the live
 * catalog. It cannot see the IAM half, which decides something prior and
 * stronger: whether a principal can obtain an ADMIN token at all.
 * `dsqlIdentity()` returns `admin: true` whenever `DSQL_ROLE` is unset, and
 * before 2026-08-16 that is exactly what production did. Stripping
 * `dsql:DbConnectAdmin` from `relay-runtime-policy` is what makes that
 * unreachable by permission rather than by configuration: a token minted with
 * `dsql:DbConnect` cannot authenticate as `admin` however the client asks.
 *
 * One `aws iam create-policy-version` puts it back. It appears in no diff, no
 * test run and no build, and the app would keep working — which is the whole
 * problem. Nothing would be observably different until the day it mattered.
 *
 * 🔴 THREE WAYS A FORBIDDEN GRANT CAN COME BACK, and a check that saw only the
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
 * ─────────────────────────────────────────────────────────────────────────────
 * 🆕 2026-08-21 — ONE PRINCIPAL BECAME THREE, SO THE RULES BECAME A CONTRACT
 *
 * This file was written for `relay-runtime` and hardcoded it: one user, one
 * forbidden action, one required action. On 2026-08-21 a third IAM identity was
 * created — `relay-ro`, the read-only verification credential — and the IAM
 * layer audited it with NOTHING. That is the same gap `verify-roles.ts` found on
 * itself the same day and closed by going from two roles to three behind a
 * declared contract; this is that change on the other side of the wall, and it
 * is worth stating why the shape matters rather than just widening a constant:
 * a new wall that the instrument does not watch is a wall that can be widened
 * silently, which is the exact failure this file's own header describes.
 *
 * 🔴 THE PROPERTY THAT NEEDED A NEW KIND OF RULE. `relay_ro` exists so that
 * unattended work can check the live system at all, which means `.env.ro` is the
 * one credential in this product meant to sit somewhere less trusted than
 * Steve's laptop. Everything that makes that defensible rests on a single fact:
 * `relay-ro-policy` carries **no `kms:*` action at all**. A leaked `relay_ro`
 * key reads metadata and can never turn a ciphertext column into a secret — the
 * vault stays ciphertext with no key. `relay-dev` by contrast holds KMS, so this
 * is a real distinction and not a formality.
 *
 * That claim is NOT expressible as "does not confer `kms:Decrypt`". A policy
 * granting `kms:DescribeKey` confers no decryption today, and would pass such a
 * check, while making false the sentence that `.env.example`, the rotation
 * runbook and `verify-roles.ts` all actually print: *no KMS*. So the forbidden
 * unit here is a whole SERVICE, not an action — check the claim that was made.
 *
 * WHAT THIS FILE STILL DOES NOT SEE is recorded in `scripts/verify-iam.ts`,
 * which is where the reading happens: group-attached policies are a fourth way
 * in and are not collected.
 *
 * PURE, like `kms-wall.ts`. No SDK call, no environment, no I/O — it takes the
 * shape AWS returns and produces a verdict, so every rule is testable against a
 * planted fixture and provable with no credentials at all.
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

/**
 * One action that must be unreachable, and what it costs when it returns.
 *
 * The consequence is a sentence, not a label, and it is deliberately stored
 * beside the rule rather than composed at the failure site: the whole value of
 * this check is that the person who meets the failure — possibly months from now
 * — learns what it means without going and reading this file.
 */
export interface ForbiddenAction {
  /** e.g. `dsql:DbConnectAdmin`. Matched case-insensitively, because IAM is. */
  action: string;
  consequence: string;
}

/**
 * A whole IAM service this principal may not touch AT ALL.
 *
 * Stronger than forbidding actions one at a time, and the difference is the
 * point: see the `relay-ro` note in the header. `kms:DescribeKey` decrypts
 * nothing and still falsifies "no KMS".
 */
export interface ForbiddenService {
  /** An IAM service prefix without the colon, e.g. `kms`. */
  service: string;
  consequence: string;
}

/** What one IAM principal is expected to hold, and expected never to hold. */
export interface PrincipalContract {
  /** The IAM user name, as the account has it. */
  user: string;
  /** One sentence: what this identity is for, and where its credential lives. */
  purpose: string;
  /**
   * Actions this principal MUST hold.
   *
   * An absence is reported as a finding, not as safety. A principal stripped to
   * nothing is a broken product, and a wall check happiest when the product is
   * down is measuring something adjacent to the question.
   */
  requires: string[];
  /** What an absence actually breaks. Written into the failure. */
  requiresConsequence: string;
  forbids: ForbiddenAction[];
  forbidsServices?: ForbiddenService[];
  /**
   * True things this contract deliberately does NOT assert, printed on every
   * run. A blind spot nobody can see is indistinguishable from coverage.
   */
  notes?: string[];
}

export interface WallVerdict {
  ok: boolean;
  /** The principal this verdict is about — three of them now share a run. */
  user: string;
  /** Every way something forbidden is reachable. Empty is the goal. */
  violations: string[];
  /** Required actions that no policy grants. Empty is the goal. */
  missing: string[];
  reason: string;
}

/**
 * `dsqlIdentity()` returns admin whenever `DSQL_ROLE` is unset, so this action
 * is one unset environment variable away from full DDL rights.
 *
 * ⚠️ THE SENTENCE USED TO END "over all 25 tables" AND THAT NUMBER WAS COPIED,
 * not derived — this repo has since printed 26 (`verify:roles`, 2026-08-20) and
 * a bare `CREATE TABLE` count over `db/migrations/` gives 28. Three figures for
 * one fact is the argument for none of them living here: `lib/db/schema-manifest.ts`
 * derives the set, `npm run verify:schema` prints it, and this file names neither.
 */
const ADMIN_TOKEN_CONSEQUENCE =
  'That is a DSQL ADMIN token: dsqlIdentity() returns admin whenever DSQL_ROLE is unset, so this ' +
  'is one unset environment variable away from DDL rights over every table the migrations declare ' +
  '(the set is derived in lib/db/schema-manifest.ts — run npm run verify:schema to see it). ' +
  'docs/least-privilege-cutover.md holds the strip command.';

/** The identity Vercel authenticates as. The only one that serves customer traffic. */
export const RUNTIME_CONTRACT: PrincipalContract = {
  user: 'relay-runtime',
  purpose: 'the live site — Vercel authenticates as this, and only this one serves customer traffic',
  requires: ['dsql:DbConnect'],
  requiresConsequence:
    'That is not a secure state, it is a broken one — the live site cannot reach its database at ' +
    'all. A wall check that is happiest when the product is down is checking the wrong thing.',
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
  notes: [
    'Its KMS grant is legitimate and is not forbidden here: the live site is what wraps and ' +
      'unwraps vault data keys, so kms:GenerateDataKey and kms:Decrypt are the product working. ' +
      'Only relay-ro is held to an ABSENCE of KMS.',
  ],
};

/** A laptop. `.env.local` authenticates as this and maps to DB role `relay_dev`. */
export const LAPTOP_CONTRACT: PrincipalContract = {
  user: 'relay-dev',
  purpose:
    'a laptop — .env.local authenticates as this, mapped to DB role relay_dev: read/write on ' +
    'product tables, no DDL, and it cannot write caregiver_leads',
  requires: ['dsql:DbConnect'],
  requiresConsequence:
    'Local walks and scripts stop. Production is unaffected, so this is a broken instrument ' +
    'rather than an exposure — but it is broken, not safe.',
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
  notes: [
    'ITS KMS GRANT IS DELIBERATELY NOT ASSERTED. It holds one — docs/sprint-reports/' +
      '2026-08-15-sprint.md records the provisioning as "dsql:DbConnect only + KMS" — and that ' +
      'grant is exactly what makes relay-ro\'s absence of KMS a real distinction rather than a ' +
      'formality. But the ACTION LIST was never written down anywhere in this repo, and pinning a ' +
      'guess would make the first live run fail on the checker instead of on the account. The run ' +
      'prints every action it reads: pin it from that, in a commit, and this note goes away.',
  ],
};

/**
 * The verification identity, created 2026-08-21 (IAM `relay-ro`, DB role
 * `relay_ro` via migration 039, both regions).
 */
export const READONLY_CONTRACT: PrincipalContract = {
  user: 'relay-ro',
  purpose:
    'the read-only verification identity — .env.ro, mapped to DB role relay_ro: SELECT on every ' +
    'table and nothing else. It exists so unattended work can check the live system at all',
  requires: ['dsql:DbConnect'],
  requiresConsequence:
    'The five database-only verifications stop — verify:schema, verify:dogfood, verify:orphans, ' +
    'flight:snapshot and verify:roles. Nothing serves customer traffic with this identity, so ' +
    'this is an outage of the instruments rather than of the product. Still broken, not safe.',
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
  forbidsServices: [
    {
      service: 'kms',
      consequence:
        '🔴 THIS IS THE ONE PROPERTY THAT MAKES .env.ro PLACEABLE SOMEWHERE LESS TRUSTED THAN ' +
        'THIS LAPTOP. relay_ro holds SELECT on every table, and vault secrets are ciphertext ' +
        'columns — so a leaked key reads metadata and can never turn one into a secret, PROVIDED ' +
        'it cannot reach the CMK. Any KMS action at all ends that: the credential every document ' +
        'in this repo calls the weakest becomes as dangerous as the runtime one, while all of them ' +
        'go on saying otherwise. docs/secret-rotation-runbook.md and .env.example both state the ' +
        'absence as fact; this is the check that makes the statement true rather than aspirational.',
    },
  ],
  notes: [
    '⚠️ Read-only is not harmless, and no IAM rule can make it so. Emails, display names and ' +
      'vault item titles are PLAINTEXT columns, so this is still production PII. That is the ' +
      'accepted trade and it is recorded in PROJECT.yaml, not left implicit here.',
  ],
};

/**
 * Every principal `npm run verify:iam` audits.
 *
 * Adding an IAM user to this account and not to this list is how the next
 * unwatched wall gets built, so the list is the contract: the script iterates it
 * and audits nothing else.
 */
export const CONTRACTS: PrincipalContract[] = [
  RUNTIME_CONTRACT,
  LAPTOP_CONTRACT,
  READONLY_CONTRACT,
];

function lower(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase());
}

function actionsOf(s: Statement): string[] {
  return lower(s.Action);
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
 * Does this action reach ANYWHERE inside `service`?
 *
 * Deliberately not `confers(action, 'kms:something')`. The claim being checked
 * is "carries no KMS action", so `kms:DescribeKey` — which decrypts nothing —
 * must fail it. `*` and any wildcard that spans the prefix reach it too.
 */
function touchesService(action: string, service: string): boolean {
  if (action === '*') return true;
  const prefix = `${service}:`;
  if (action.startsWith(prefix)) return true;
  return action.endsWith('*') && prefix.startsWith(action.slice(0, -1));
}

/**
 * Does a `NotAction` entry exclude the WHOLE of `service`?
 *
 * `NotAction: ["kms:Decrypt"]` does not: it allows every other KMS action, which
 * is precisely the hole `touchesService` exists to close. Only `*` or a wildcard
 * spanning the prefix keeps the service out.
 */
function excludesWholeService(excluded: string, service: string): boolean {
  if (excluded === '*') return true;
  return excluded.endsWith('*') && `${service}:`.startsWith(excluded.slice(0, -1));
}

/**
 * Reads one principal's half of the wall off its policy documents.
 *
 * `NotAction` with Allow is treated as conferring everything it does not
 * exclude, which is what it means. It is not used in this account today; it is
 * handled because it is the classic way an allow-list check is defeated by a
 * policy that never names the action.
 *
 * @param contract what this principal must and must not hold — see `CONTRACTS`.
 * @param policies every policy attached to or inline on that principal.
 */
export function readWall(contract: PrincipalContract, policies: NamedPolicy[]): WallVerdict {
  const violations: string[] = [];
  const consequences: string[] = [];
  const held = new Set<string>();

  const required = contract.requires.map((a) => a.toLowerCase());
  const forbidden = contract.forbids.map((f) => ({ ...f, action: f.action.toLowerCase() }));
  const forbiddenServices = (contract.forbidsServices ?? []).map((f) => ({
    ...f,
    service: f.service.toLowerCase(),
  }));

  /* One consequence per rule that fired, in the order it fired — a failure that
     repeats the same paragraph five times is a failure people stop reading. */
  const explain = (consequence: string): void => {
    if (!consequences.includes(consequence)) consequences.push(consequence);
  };

  for (const { source, document } of policies) {
    for (const s of document.Statement ?? []) {
      if ((s.Effect ?? 'Allow') !== 'Allow') continue;
      const where = `${source} · ${s.Sid ?? 'unnamed'}`;

      if (s.NotAction !== undefined) {
        const excluded = lower(s.NotAction);

        for (const rule of forbidden) {
          if (!excluded.some((e) => confers(e, rule.action))) {
            violations.push(`${where} · NotAction allows everything else, including "${rule.action}"`);
            explain(rule.consequence);
          }
        }
        for (const rule of forbiddenServices) {
          if (!excluded.some((e) => excludesWholeService(e, rule.service))) {
            violations.push(
              `${where} · NotAction allows everything else, including the whole ${rule.service}: service`,
            );
            explain(rule.consequence);
          }
        }
        for (const need of required) {
          if (!excluded.some((e) => confers(e, need))) held.add(need);
        }
        continue;
      }

      for (const action of actionsOf(s)) {
        for (const rule of forbidden) {
          if (confers(action, rule.action)) {
            violations.push(`${where} · "${action}"`);
            explain(rule.consequence);
          }
        }
        for (const rule of forbiddenServices) {
          if (touchesService(action, rule.service)) {
            violations.push(`${where} · "${action}" reaches the ${rule.service}: service`);
            explain(rule.consequence);
          }
        }
        for (const need of required) {
          if (confers(action, need)) held.add(need);
        }
      }
    }
  }

  const missing = required.filter((a) => !held.has(a));

  if (violations.length) {
    return {
      ok: false,
      user: contract.user,
      violations,
      missing,
      reason: `${contract.user} holds what its contract forbids: ${violations.join('; ')}. ${consequences.join(' ')}`,
    };
  }

  if (missing.length) {
    return {
      ok: false,
      user: contract.user,
      violations,
      missing,
      reason: `no policy on ${contract.user} grants ${missing.join(', ')}. ${contract.requiresConsequence}`,
    };
  }

  const barred = [
    ...forbidden.map((f) => f.action),
    ...forbiddenServices.map((f) => `${f.service}:* (the whole service)`),
  ];

  return {
    ok: true,
    user: contract.user,
    violations,
    missing,
    reason:
      `${contract.user}: ${contract.requires.join(', ')} granted, ` +
      `${barred.join(' and ')} unreachable — its half of the wall holds`,
  };
}
