/**
 * scripts/verify-iam.ts — can any of our IAM principals hold what it must not?
 *
 *   npx tsx --env-file=.env.admin scripts/verify-iam.ts     (npm run verify:iam)
 *
 * WHY THIS EXISTS. The 2026-08-16 cutover closed the least-privilege arc in two
 * halves, and only one of them is watched. `verify:roles` re-measures what the
 * database roles may do ONCE CONNECTED, by reading the live catalog. It cannot
 * see the half that decides something prior and stronger: whether a principal
 * can obtain an ADMIN connection at all.
 *
 * The sprint that shipped the cutover recorded the gap in its own report rather
 * than closing it: "the IAM half is not automated — re-adding
 * `dsql:DbConnectAdmin` would go unnoticed by `verify:roles`." One
 * `aws iam create-policy-version` puts it back, it appears in no diff, no test
 * run and no build, and the application keeps working — so nothing is observably
 * different until the day it matters.
 *
 * 🆕 2026-08-21 — IT AUDITS THREE PRINCIPALS, NOT ONE. This script hardcoded
 * `relay-runtime`. On 2026-08-21 the read-only identity `relay-ro` was created
 * and nothing at the IAM layer looked at it, which is the same hole
 * `verify-roles.ts` closed on itself the same day by growing a contract. The
 * rules now live in `lib/ops/iam-wall.ts → CONTRACTS`, one entry per principal,
 * and this file is the thin shell that fetches the real documents. **A principal
 * absent from that list is audited by nothing**, so adding an IAM user to this
 * account means adding a contract in the same change.
 *
 * The distinction that made a contract necessary rather than a wider constant:
 * `relay-runtime` legitimately holds KMS — the live site is what wraps and
 * unwraps vault data keys — while `relay-ro` must hold NO KMS action at all,
 * because that absence is the entire reason `.env.ro` may sit somewhere less
 * trusted than this laptop. The same policy document is health on one and a
 * breach on the other.
 *
 * READ-ONLY. Five IAM read calls per principal and nothing else:
 * ListAttachedUserPolicies, GetPolicy, GetPolicyVersion, ListUserPolicies and
 * GetUserPolicy. It creates no policy, no version and no key, and it is safe to
 * run against the production account, which is the only account worth running it
 * against. (The header said "four" and then listed five; corrected 2026-08-21.)
 *
 * 🔴 WHAT IT STILL CANNOT SEE, said plainly because a blind spot nobody has
 * written down is indistinguishable from coverage:
 *
 *   · **GROUP-ATTACHED POLICIES.** A policy attached to an IAM group the user
 *     belongs to grants exactly as hard as an attached user policy and is a
 *     THIRD set of API calls (ListGroupsForUser, ListAttachedGroupPolicies,
 *     ListGroupPolicies, GetGroupPolicy). This is the same shape as the inline
 *     policies below — "a different API call entirely" — and closing it is a
 *     small, real improvement. It was left open deliberately on 2026-08-21
 *     rather than written blind: this script cannot be executed without
 *     `.env.admin`, and adding an unrunnable read path to a check that IS proven
 *     live trades a working instrument for an untested one. None of the three
 *     principals is in any group today.
 *   · **RESOURCE SCOPING.** The verdict reads actions, not `Resource`. A
 *     `dsql:DbConnect` widened from the two cluster ARNs to `*` passes.
 *   · **PERMISSION BOUNDARIES**, which can only narrow — so ignoring them makes
 *     this check stricter than reality, which is the safe direction to be wrong.
 *
 * ⚠️ IT NEEDS AN IDENTITY THAT CAN READ IAM, which the application's own
 * credentials deliberately cannot — and neither can `.env.ro`, whose whole point
 * is that a credential living somewhere less trusted has no business enumerating
 * IAM. Run it with `.env.admin`, whose design is that being a sysadmin is
 * something you choose by naming the file. On this machine the AWS CLI
 * additionally needs `AWS_CA_BUNDLE` pointed at a current Windows root export —
 * Norton MITMs TLS and the bundles go stale. The SDK path used here does not
 * need that, which is part of why it is the SDK and not a shell-out.
 *
 * NOT IN CI: CI has no AWS credentials, the same reason verify:schema,
 * verify:roles and verify:live are not.
 *
 * Feature: relay-h0-mvp
 */

import {
  IAMClient,
  ListAttachedUserPoliciesCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
} from '@aws-sdk/client-iam';

import {
  readWall,
  CONTRACTS,
  RUNTIME_CONTRACT,
  type NamedPolicy,
  type PolicyDocument,
  type PrincipalContract,
} from '../lib/ops/iam-wall';

/**
 * Points the runtime check at a different user name, for an account that names
 * it differently. Documented in `.env.example`; unset changes nothing.
 *
 * It applies to the RUNTIME contract only. The other two principals are named by
 * the contract itself, because an override that silently redirected the
 * `relay-ro` check would be a way to make the KMS assertion pass against the
 * wrong user — which is the class of thing this file exists to refuse.
 */
const RUNTIME_USER = process.env.RELAY_RUNTIME_IAM_USER;

/** IAM returns policy documents URL-encoded. */
function decode(doc: string | undefined): PolicyDocument {
  if (!doc) return {};
  return JSON.parse(decodeURIComponent(doc)) as PolicyDocument;
}

async function collect(iam: IAMClient, user: string): Promise<NamedPolicy[]> {
  const policies: NamedPolicy[] = [];

  const attached = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: user }));
  for (const p of attached.AttachedPolicies ?? []) {
    if (!p.PolicyArn) continue;
    /*
      Only the DEFAULT version is read, and that is the correct choice rather
      than a shortcut. Old versions are retained deliberately as rollbacks —
      v1 of relay-runtime-policy still carries the admin grant and is supposed
      to. What is in force is what the default version says.
    */
    const meta = await iam.send(new GetPolicyCommand({ PolicyArn: p.PolicyArn }));
    const version = meta.Policy?.DefaultVersionId;
    const doc = await iam.send(
      new GetPolicyVersionCommand({ PolicyArn: p.PolicyArn, VersionId: version }),
    );
    policies.push({
      source: `managed ${p.PolicyName} ${version}`,
      document: decode(doc.PolicyVersion?.Document),
    });
  }

  /*
    Inline policies are a SEPARATE API. Anyone checking only attached managed
    policies would report a clean wall while an inline statement granted admin
    beside it — the same shape as every other near-miss in lib/ops.
  */
  const inline = await iam.send(new ListUserPoliciesCommand({ UserName: user }));
  for (const name of inline.PolicyNames ?? []) {
    const doc = await iam.send(new GetUserPolicyCommand({ UserName: user, PolicyName: name }));
    policies.push({ source: `inline ${name}`, document: decode(doc.PolicyDocument) });
  }

  return policies;
}

/** A credentials problem is about the RUN, not about the principal being read. */
function isAboutTheCaller(message: string): boolean {
  return /credential|token|AccessDenied|not authorized|ExpiredToken/i.test(message);
}

/** @returns true when this principal's wall holds. */
async function audit(iam: IAMClient, contract: PrincipalContract): Promise<boolean> {
  console.log(`[iam] ${contract.user} — ${contract.purpose}`);

  const policies = await collect(iam, contract.user);

  if (policies.length === 0) {
    console.error(`[iam] ✗ ${contract.user} has no policies at all — that is broken, not secure.`);
    return false;
  }

  for (const p of policies) {
    const actions = (p.document.Statement ?? [])
      .flatMap((s) => (Array.isArray(s.Action) ? s.Action : s.Action ? [s.Action] : []))
      .join(', ');
    console.log(`      ${p.source}`);
    console.log(`          ${actions || '(no Action — see NotAction)'}`);
  }

  const verdict = readWall(contract, policies);
  if (!verdict.ok) {
    console.error(`[iam] ✗ ${verdict.reason}`);
    return false;
  }

  console.log(`[iam] ✓ ${verdict.reason}`);
  /* Printed on every pass, not only on failure: what a green result does NOT cover. */
  for (const note of contract.notes ?? []) console.log(`[iam]   note: ${note}`);
  console.log();
  return true;
}

async function main(): Promise<void> {
  const iam = new IAMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

  console.log(`[iam] ${CONTRACTS.length} principals, read-only\n`);

  let failures = 0;
  for (const declared of CONTRACTS) {
    const contract =
      declared === RUNTIME_CONTRACT && RUNTIME_USER
        ? { ...declared, user: RUNTIME_USER }
        : declared;

    try {
      if (!(await audit(iam, contract))) failures += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      /*
        Fail fast on a credentials problem: it will recur identically for every
        principal, and three copies of the same error buries the one line that
        says what to do. Anything else is about THIS principal — report it and
        keep going, because a run that dies on the first user never audits the
        third, and the third is the one nothing was watching.
      */
      if (isAboutTheCaller(message)) throw err;
      console.error(`[iam] ✗ ${contract.user}: ${message}`);
      console.error(`[iam]   an unreadable principal is a finding, not a pass.\n`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`[iam] ${failures} of ${CONTRACTS.length} principal(s) FAILED.`);
    process.exit(1);
  }

  console.log(`[iam] ✓ all ${CONTRACTS.length} principals hold their contract`);
  console.log('[iam]   the other half is npm run verify:roles — this one cannot see it');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[iam] failed: ${message}`);
  if (isAboutTheCaller(message)) {
    console.error('[iam]   this needs an identity that can READ IAM — run with .env.admin.');
  }
  process.exit(1);
});
