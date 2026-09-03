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

/**
 * What a role's trust policy must say.
 *
 * A ROLE differs from a user in a way that matters more than the API call: a
 * user is reached with a key, a role is reached by satisfying a trust policy.
 * Auditing `relay-kms-wall-ci`'s PERMISSIONS and not its TRUST would check the
 * smaller half -- the permissions are three read-only KMS calls, and the thing
 * actually worth protecting is who may assume it. A trust policy widened from
 * one branch of one repo to `repo:owner/relay:*` grants those calls to every
 * pull request, including one opened by a stranger against a public repo.
 */
export interface TrustContract {
  /** e.g. `token.actions.githubusercontent.com` — the only federation allowed. */
  provider: string;
  /**
   * The EXACT `sub` the trust policy must pin, e.g.
   * `repo:sgharlow/relay:ref:refs/heads/master`. A `StringLike` with a wildcard
   * is a finding even when it contains this string.
   */
  subject: string;
  consequence: string;
}

/**
 * Whether this principal's grants must name their targets.
 *
 * Added 2026-08-29 (B16.3), and only after a reading. The header called this a
 * blind spot in plain words -- "the verdict reads actions, not `Resource`. A
 * `dsql:DbConnect` widened from the two cluster ARNs to `*` passes" -- and left
 * it open rather than guessing at what the account held. The first live run
 * printed every Resource: all four principals grant on explicit ARNs, the two
 * DSQL cluster ARNs and one CMK, with no wildcard anywhere. So the rule is
 * pinned from what is there, which is the discipline the relay-dev KMS note
 * spent a week arguing for.
 */
export interface ResourceScope {
  /** A bare `*` (or an absent Resource) on an Allow is a finding. */
  mustNotBeWildcard: true;
  consequence: string;
}

/** What one IAM principal is expected to hold, and expected never to hold. */
export interface PrincipalContract {
  /**
   * User or role. Added 2026-08-29 (B16.4): this file audited users only, so
   * `relay-kms-wall-ci` -- an OIDC role in a PUBLIC repo -- was audited by
   * nothing, which is the same shape as `relay-ro` being unwatched on 08-21.
   * Roles are collected through a different set of API calls entirely, exactly
   * like inline policies, and "a different API call" is this file's recurring
   * blind-spot shape.
   */
  kind: 'user' | 'role';
  /** The IAM user OR role name, as the account has it. */
  user: string;
  /** Roles only: what the assume-role policy must say. */
  trust?: TrustContract;
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
  /** Must every Allow name its target ARNs? See `ResourceScope`. */
  resourceScope?: ResourceScope;
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
  kind: 'user',
  user: 'relay-runtime',
  purpose: 'the live site — Vercel authenticates as this, and only this one serves customer traffic',
  /*
    🆕 2026-08-29 (B16.6) — THE KMS HALF IS REQUIRED, NOT MERELY PERMITTED.
    This list read `['dsql:DbConnect']`, and the note below said the KMS grant was
    "legitimate and is not forbidden here". Both true, and together they meant a
    policy stripped of kms:GenerateDataKey and kms:Decrypt PASSED. That is exactly
    the failure this file's header names for the connect grant — "a policy stripped
    to nothing grants no admin and takes the site down; reporting that as secure
    would be a check that is happiest when the product is broken" — applied to the
    half that had only ever been discussed in prose.

    Pinned from a live read, not from the docs: `npm run verify:iam` on 2026-08-29
    printed relay-runtime-policy v2 granting exactly
    `dsql:DbConnect, kms:GenerateDataKey, kms:Decrypt`.
  */
  requires: ['dsql:DbConnect', 'kms:GenerateDataKey', 'kms:Decrypt'],
  requiresConsequence:
    'That is not a secure state, it is a broken one. Without dsql:DbConnect the live site cannot ' +
    'reach its database at all; without kms:GenerateDataKey it cannot WRITE a vault item, and ' +
    'without kms:Decrypt it cannot REVEAL one — the product loses the feature it exists for while ' +
    'every other check stays green. A wall check that is happiest when the product is down is ' +
    'checking the wrong thing.',
  resourceScope: {
    mustNotBeWildcard: true,
    consequence:
      'A grant on Resource "*" is a different grant from the one this account actually makes. ' +
      'Read live on 2026-08-29, every policy here names its targets: the two DSQL cluster ARNs ' +
      'and the one CMK. Widening to "*" reaches every cluster and every key in the account — ' +
      'including any created later, which nobody would think to re-audit — while the ACTION list ' +
      'this file spent a year getting right stays word-for-word identical. That is the whole ' +
      'shape of a silent widening.',
  },
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
  notes: [
    'Its KMS grant is legitimate and is now REQUIRED here rather than merely unforbidden: the ' +
      'live site is what wraps and unwraps vault data keys. Only relay-ro is held to an ABSENCE ' +
      'of KMS.',
  ],
};

/** A laptop. `.env.local` authenticates as this and maps to DB role `relay_dev`. */
export const LAPTOP_CONTRACT: PrincipalContract = {
  kind: 'user',
  user: 'relay-dev',
  purpose:
    'a laptop — .env.local authenticates as this, mapped to DB role relay_dev: read/write on ' +
    'product tables, no DDL, and it cannot write caregiver_leads',
  /*
    🆕 2026-08-29 (B16.2) — PINNED FROM THE FIRST LIVE READ. The note this replaces
    said the KMS action list "was never written down anywhere in this repo", that
    pinning a guess would make the first live run fail on the checker instead of on
    the account, and that the fix was to read it once and pin it from the output.
    `npm run verify:iam` on 2026-08-29 printed relay-dev-policy v1 granting exactly
    `dsql:DbConnect, kms:GenerateDataKey, kms:Decrypt` — the same shape as the
    runtime identity. Requiring it makes relay-ro's ABSENCE of KMS a measured
    distinction on both sides of the comparison instead of only one.
  */
  requires: ['dsql:DbConnect', 'kms:GenerateDataKey', 'kms:Decrypt'],
  requiresConsequence:
    'Local walks and scripts stop, and the reveal path stops in a way that reads like a product ' +
    'bug rather than a missing grant. Production is unaffected, so this is a broken instrument ' +
    'rather than an exposure — but it is broken, not safe.',
  resourceScope: {
    mustNotBeWildcard: true,
    consequence:
      'A grant on Resource "*" is a different grant from the one this account actually makes. ' +
      'Read live on 2026-08-29, every policy here names its targets: the two DSQL cluster ARNs ' +
      'and the one CMK. Widening to "*" reaches every cluster and every key in the account — ' +
      'including any created later, which nobody would think to re-audit — while the ACTION list ' +
      'this file spent a year getting right stays word-for-word identical. That is the whole ' +
      'shape of a silent widening.',
  },
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
};

/**
 * The verification identity, created 2026-08-21 (IAM `relay-ro`, DB role
 * `relay_ro` via migration 039, both regions).
 */
export const READONLY_CONTRACT: PrincipalContract = {
  kind: 'user',
  user: 'relay-ro',
  purpose:
    'the read-only verification identity — .env.ro, mapped to DB role relay_ro: SELECT on every ' +
    'table and nothing else. It exists so unattended work can check the live system at all',
  requires: ['dsql:DbConnect'],
  requiresConsequence:
    'The five database-only verifications stop — verify:schema, verify:dogfood, verify:orphans, ' +
    'flight:snapshot and verify:roles. Nothing serves customer traffic with this identity, so ' +
    'this is an outage of the instruments rather than of the product. Still broken, not safe.',
  resourceScope: {
    mustNotBeWildcard: true,
    consequence:
      'A grant on Resource "*" is a different grant from the one this account actually makes. ' +
      'Read live on 2026-08-29, every policy here names its targets: the two DSQL cluster ARNs ' +
      'and the one CMK. Widening to "*" reaches every cluster and every key in the account — ' +
      'including any created later, which nobody would think to re-audit — while the ACTION list ' +
      'this file spent a year getting right stays word-for-word identical. That is the whole ' +
      'shape of a silent widening.',
  },
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
/**
 * The OIDC role the KMS wall watch assumes from GitHub Actions, added to this
 * file on 2026-08-29 (B16.4).
 *
 * 🔴 WHY A ROLE NEEDED A CONTRACT AT ALL. Every principal above is reached with
 * a long-lived key that lives on a machine Steve controls. This one is reached
 * by *satisfying a trust policy* from a workflow in a **public** repository, and
 * it was audited by nothing — the same hole `relay-ro` sat in until 08-21, and
 * `verify-roles.ts` before that. The pattern is now three for three: a new
 * identity gets created for a good reason, and the instrument that watches
 * identities is not told about it.
 *
 * THE PERMISSIONS ARE THE SMALLER HALF. `kms:DescribeKey`, `kms:GetKeyPolicy`
 * and `kms:GetKeyRotationStatus` read metadata; none of them turns a ciphertext
 * into a secret, which is the whole reason the wall watch may run unattended in
 * public CI. `kms:Decrypt` or `kms:GenerateDataKey` arriving here would end
 * that, so both are forbidden by naming the actions rather than the service —
 * the service is exactly what this role legitimately touches, so the `relay-ro`
 * shape would be wrong here and would fail on the first run.
 */
export const KMS_WALL_CI_CONTRACT: PrincipalContract = {
  kind: 'role',
  user: 'relay-kms-wall-ci',
  purpose:
    'the GitHub Actions OIDC role for the KMS wall watch — assumed by a workflow in a PUBLIC ' +
    'repo, so it holds KMS metadata reads and nothing that can decrypt',
  requires: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:GetKeyRotationStatus'],
  requiresConsequence:
    'The KMS wall watch cannot read the key it watches, so it reports nothing and the absence of ' +
    'an alarm becomes the absence of a check. It has been proven green AND red since 2026-08-24; ' +
    'losing a read turns that proof into a daily green that means nothing.',
  resourceScope: {
    mustNotBeWildcard: true,
    consequence:
      'A grant on Resource "*" is a different grant from the one this account actually makes. ' +
      'Read live on 2026-08-29, every policy here names its targets: the two DSQL cluster ARNs ' +
      'and the one CMK. Widening to "*" reaches every cluster and every key in the account — ' +
      'including any created later, which nobody would think to re-audit — while the ACTION list ' +
      'this file spent a year getting right stays word-for-word identical. That is the whole ' +
      'shape of a silent widening.',
  },
  forbids: [
    {
      action: 'kms:Decrypt',
      consequence:
        '🔴 This role is assumed from a PUBLIC repository. Decrypt here means a workflow — ' +
        'including one a stranger could influence if the trust policy ever widened past a branch ' +
        '— can turn vault ciphertext into plaintext. The wall watch needs to READ the key policy, ' +
        'never to USE the key.',
    },
    {
      action: 'kms:GenerateDataKey',
      consequence:
        'Wrapping is the other half of the vault. A role that can mint data keys can write items ' +
        'that look legitimate, from CI, in a public repo.',
    },
    { action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE },
  ],
  trust: {
    provider: 'token.actions.githubusercontent.com',
    subject: 'repo:sgharlow/relay:ref:refs/heads/master',
    consequence:
      '🔴 THE TRUST POLICY IS THE REAL WALL FOR A ROLE, and it is the half an actions-only audit ' +
      'misses entirely. Widened to `repo:sgharlow/relay:*`, every pull request against a PUBLIC ' +
      'repo — including one opened by a stranger — can assume this role. The permissions would ' +
      'still read exactly as clean as they do today.',
  },
  notes: [
    'Its permissions are read-only KMS metadata BY DESIGN, so kms: is not forbidden as a service ' +
      'here the way it is on relay-ro — the two named write actions are. Forbidding the service ' +
      'would fail this role on the first run for doing its job.',
  ],
};

/**
 * The OIDC role a GitHub Actions runner assumes to hold the READ-ONLY DATABASE
 * identity, added 2026-09-02 (D21). Steve ruled "yes, via OIDC" on 2026-09-01.
 *
 * 🔴 IT IS `relay-ro` REACHED FROM SOMEWHERE ELSE, AND THAT IS THE WHOLE POINT.
 * The identity table in CLAUDE.md is built from identities rather than
 * environments because there is one cluster: `.env.ro` exists so unattended work
 * can check the live system at all, and the property that makes it placeable
 * somewhere less trusted than Steve's laptop is that `relay-ro-policy` carries
 * NO `kms:*` action. A runner is somewhere less trusted than Steve's laptop.
 * This role inherits the absence, and the absence is why the role may exist.
 *
 * ⚠️ IT DOES NOT INHERIT THE OTHER ROLE'S SHAPE, and the two OIDC roles in this
 * file are the clearest reason a contract is per-principal.
 * `relay-kms-wall-ci` REQUIRES `kms:DescribeKey` — it watches the key, so
 * forbidding the service would fail it on its first run for doing its job. The
 * same action here would end the sentence `.env.example`, the rotation runbook
 * and `verify-roles.ts` all print. One action, two roles, opposite verdicts.
 *
 * ⚠️ AND `dsql:DbConnect` IS NOT HARMLESS. This grants SELECT on every table on
 * the production cluster: emails, display names and vault item TITLES are
 * plaintext columns. What it can never do is decrypt, because of the line
 * above. That trade is stated in docs/d21-runner-db-oidc-proposal.md §4 rather
 * than implied here.
 *
 * ⚠️ NOT YET LIVE. The role is created by the controller under /safe-execute;
 * nothing has read this contract against a real document. `built`, not
 * live-proven — `npm run verify:iam` under `.env.admin` is what changes that.
 */
export const READONLY_CI_CONTRACT: PrincipalContract = {
  kind: 'role',
  user: 'relay-ro-ci',
  purpose:
    'the GitHub Actions OIDC role for the read-only database identity — assumed by a workflow in ' +
    'a PUBLIC repo from the master ref only, mapped to DB role relay_ro: SELECT on every table, ' +
    'no DML, no DDL, and no way to decrypt anything it reads',
  requires: ['dsql:DbConnect'],
  requiresConsequence:
    'The runner cannot reach the database at all, so owner-mode accessibility goes back to being ' +
    'audited only when somebody remembers (B28), and every unattended read-only verification stays ' +
    'a command a person types. Nothing serves customer traffic with this identity — this is an ' +
    'outage of the instruments rather than of the product. Still broken, not safe.',
  resourceScope: {
    mustNotBeWildcard: true,
    consequence:
      'This role is asked for ONE cluster: the primary, us-east-1, the endpoint the workflow ' +
      'connects to. A grant on Resource "*" reaches every cluster in the account including any ' +
      'created later, which nobody would think to re-audit, while the ACTION list stays ' +
      'word-for-word identical. That is the whole shape of a silent widening, and it is worth ' +
      'more here than on a laptop user: this principal is assumed from a public repository.',
  },
  forbids: [{ action: 'dsql:DbConnectAdmin', consequence: ADMIN_TOKEN_CONSEQUENCE }],
  forbidsServices: [
    {
      service: 'kms',
      consequence:
        '🔴 THIS IS THE PROPERTY THAT LETS A DATABASE CREDENTIAL EXIST ON A RUNNER AT ALL. The ' +
        'ruling was "yes, via OIDC" for a read-only identity, and read-only is only defensible ' +
        'while the vault stays ciphertext with no key. Any KMS action here — DescribeKey ' +
        'included, which decrypts nothing — makes a role assumed by CI as dangerous as the ' +
        'runtime one, in a PUBLIC repository, while every document in this repo goes on saying ' +
        'otherwise. The forbidden unit is the whole service because that is the claim that was ' +
        'made. docs/d21-runner-db-oidc-proposal.md is the ruling; this is the check that makes it ' +
        'true rather than aspirational.',
    },
  ],
  trust: {
    provider: 'token.actions.githubusercontent.com',
    subject: 'repo:sgharlow/relay:ref:refs/heads/master',
    consequence:
      '🔴 A TRUST POLICY WIDENED PAST THE MASTER REF HANDS PRODUCTION PII TO STRANGERS. ' +
      'sgharlow/relay is PUBLIC, so `repo:sgharlow/relay:*` lets any pull request opened against a fork assume ' +
      'a role holding SELECT on every table — every owner email, every display name, every vault ' +
      'item title. The permission policy would still read exactly as clean as it does today, ' +
      'which is why this half is audited separately from the actions.',
  },
  notes: [
    'A pull_request run presents a different `sub` and therefore CANNOT assume this role. That is ' +
      'the pin working, not a defect: .github/workflows/a11y.yml audits owner mode on master ' +
      'pushes and manual dispatches, and audits the signed-out half only on a pull request.',
    'Its database half is watched by npm run verify:roles, which asserts relay_ro is bound to ' +
      'exactly these two principals — the user and this role — and reports any third as a side ' +
      'door. Neither instrument can see the other half.',
  ],
};

export const CONTRACTS: PrincipalContract[] = [
  RUNTIME_CONTRACT,
  LAPTOP_CONTRACT,
  READONLY_CONTRACT,
  KMS_WALL_CI_CONTRACT,
  READONLY_CI_CONTRACT,
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
  const scope = contract.resourceScope;

  /* One consequence per rule that fired, in the order it fired — a failure that
     repeats the same paragraph five times is a failure people stop reading. */
  const explain = (consequence: string): void => {
    if (!consequences.includes(consequence)) consequences.push(consequence);
  };

  for (const { source, document } of policies) {
    for (const s of document.Statement ?? []) {
      if ((s.Effect ?? 'Allow') !== 'Allow') continue;
      const where = `${source} · ${s.Sid ?? 'unnamed'}`;

      /*
        Resource scoping is checked on the STATEMENT, before actions, because
        the question is about the statement's reach rather than about any one
        action in it. An Allow with no Resource at all is treated as a wildcard:
        IAM rejects such an identity policy, so meeting one means we are reading
        something other than what we think, and calling that "scoped" would be
        the flattering reading.
      */
      /*
        Only statements that GRANT something are scoped. A statement with
        neither Action nor NotAction confers nothing, so it cannot over-reach,
        and flagging its missing Resource would be a false positive on a shape
        IAM does return — caught by the "empty or odd document" test, which is
        exactly what that test is for.
      */
      const grants = s.Action !== undefined || s.NotAction !== undefined;
      if (scope && grants) {
        const resources = lower(s.Resource);
        if (resources.length === 0) {
          violations.push(`${where} · Allow with no Resource at all`);
          explain(scope.consequence);
        } else if (resources.includes('*')) {
          violations.push(`${where} · granted on Resource "*"`);
          explain(scope.consequence);
        }
      }

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

/**
 * Reads a ROLE's trust policy — who may assume it — against its contract.
 *
 * Kept separate from `readWall` on purpose. `readWall` answers "what may this
 * principal DO"; this answers "who may BECOME it", and for a role reached from
 * a public repository the second question is the sharper one. Merging them
 * would let one green line stand for two unrelated properties.
 *
 * Pure, like everything else here: it takes the document AWS returns.
 */
export function readTrust(contract: PrincipalContract, doc: TrustPolicyDocument): WallVerdict {
  const trust = contract.trust;
  const violations: string[] = [];

  if (!trust) {
    return {
      ok: true, user: contract.user, violations: [], missing: [],
      reason: `${contract.user}: no trust contract declared`,
    };
  }

  const statements = doc.Statement ?? [];
  const allows = statements.filter((s) => (s.Effect ?? 'Allow') === 'Allow');

  if (allows.length === 0) {
    /* Not "secure". A role nothing may assume is a watch that cannot run. */
    return {
      ok: false, user: contract.user, violations: ['trust policy allows nobody'], missing: [],
      reason: `${contract.user}'s trust policy allows no principal at all — that is a broken watch, not a safe one. ${contract.requiresConsequence}`,
    };
  }

  for (const s of allows) {
    const where = s.Sid ?? 'unnamed';

    /* Federated is the only shape this role is allowed to use. An IAM-principal
       or account-root Allow re-opens assumption to anyone in the account with
       sts:AssumeRole, which the OIDC pin says nothing about. */
    const federated = lower(s.Principal?.Federated);
    const others = [
      ...lower(s.Principal?.AWS).map((v) => `AWS=${v}`),
      ...lower(s.Principal?.Service).map((v) => `Service=${v}`),
    ];
    if (others.length) violations.push(`${where} · trusts a non-federated principal: ${others.join(', ')}`);
    if (federated.length && !federated.some((f) => f.endsWith(trust.provider.toLowerCase()))) {
      violations.push(`${where} · federated provider is ${federated.join(', ')}, not ${trust.provider}`);
    }

    /*
      🔴 THE ONE THAT MATTERS. StringEquals on the exact sub is the pin.
      StringLike is a wildcard match by definition, so a StringLike whose value
      happens to CONTAIN the exact subject is still a finding: `repo:o/r:*`
      contains nothing of the sort, and `repo:o/r:ref:refs/heads/*` matches
      every branch. Checking the operator, not just the value, is what makes
      "pinned to master" a measurement.
    */
    const cond = s.Condition ?? {};
    const equals = cond.StringEquals ?? {};
    const like = cond.StringLike ?? {};
    const subKey = 'token.actions.githubusercontent.com:sub';
    const pinned = lower(equals[subKey]);
    const loose = lower(like[subKey]);

    if (loose.length) {
      violations.push(`${where} · sub is matched with StringLike (${loose.join(', ')}) — a wildcard, not a pin`);
    }
    if (!pinned.includes(trust.subject.toLowerCase())) {
      violations.push(
        pinned.length
          ? `${where} · sub pinned to ${pinned.join(', ')}, not ${trust.subject}`
          : `${where} · no StringEquals on ${subKey} — the branch is not pinned at all`,
      );
    }
  }

  if (violations.length) {
    return {
      ok: false, user: contract.user, violations, missing: [],
      reason: `${contract.user}'s trust policy does not hold: ${violations.join('; ')}. ${trust.consequence}`,
    };
  }

  return {
    ok: true, user: contract.user, violations: [], missing: [],
    reason: `${contract.user}: assumable only by ${trust.provider} with sub == ${trust.subject} — the trust half holds`,
  };
}

/** An assume-role document. Its statements differ in shape from a permission policy's. */
export interface TrustPolicyDocument {
  Version?: string;
  Statement?: TrustStatement[];
}

/** The assume-role document's statement shape, which differs from a permission policy's. */
export interface TrustStatement {
  Sid?: string;
  Effect?: string;
  Principal?: { Federated?: string | string[]; AWS?: string | string[]; Service?: string | string[] };
  Condition?: Record<string, Record<string, string | string[]>>;
}
