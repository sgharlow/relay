/**
 * scripts/verify-iam.ts — can the live site still obtain a DSQL admin token?
 *
 *   npx tsx --env-file=.env.admin scripts/verify-iam.ts     (npm run verify:iam)
 *
 * WHY THIS EXISTS. The 2026-08-16 cutover closed the least-privilege arc in two
 * halves, and only one of them is watched. `verify:roles` re-measures what
 * `relay_app` and `relay_dev` may do ONCE CONNECTED, by reading the live
 * catalog. It cannot see the half that decides something prior and stronger:
 * whether the production principal can obtain an ADMIN connection at all.
 *
 * The sprint that shipped the cutover recorded the gap in its own report rather
 * than closing it: "the IAM half is not automated — re-adding
 * `dsql:DbConnectAdmin` would go unnoticed by `verify:roles`. Command recorded
 * in docs/least-privilege-cutover.md." One `aws iam create-policy-version` puts
 * it back, it appears in no diff, no test run and no build, and the application
 * keeps working — so nothing is observably different until the day it matters.
 *
 * READ-ONLY. Four IAM read calls and nothing else: ListAttachedUserPolicies,
 * GetPolicy, GetPolicyVersion, ListUserPolicies + GetUserPolicy. It creates no
 * policy, no version and no key, and it is safe to run against the production
 * account, which is the only account worth running it against.
 *
 * ⚠️ IT NEEDS AN IDENTITY THAT CAN READ IAM, which the application's own
 * credentials deliberately cannot. Run it with `.env.admin`, whose whole design
 * is that being a sysadmin is something you choose by naming the file. On this
 * machine the AWS CLI additionally needs `AWS_CA_BUNDLE` pointed at a current
 * Windows root export — Norton MITMs TLS and the bundles go stale. The SDK path
 * used here does not need that, which is part of why it is the SDK and not a
 * shell-out.
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

import { readWall, type NamedPolicy, type PolicyDocument } from '../lib/ops/iam-wall';

/** The IAM user Vercel authenticates as. */
const PRINCIPAL = process.env.RELAY_RUNTIME_IAM_USER ?? 'relay-runtime';

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
      v1 of this very policy still carries the admin grant and is supposed to.
      What is in force is what the default version says.
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

async function main(): Promise<void> {
  const iam = new IAMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

  console.log(`[iam] principal: ${PRINCIPAL} — read-only\n`);
  const policies = await collect(iam, PRINCIPAL);

  if (policies.length === 0) {
    console.error(`[iam] ✗ ${PRINCIPAL} has no policies at all — that is broken, not secure.`);
    process.exit(1);
  }

  for (const p of policies) {
    const actions = (p.document.Statement ?? [])
      .flatMap((s) => (Array.isArray(s.Action) ? s.Action : s.Action ? [s.Action] : []))
      .join(', ');
    console.log(`  ${p.source}`);
    console.log(`      ${actions || '(no Action — see NotAction)'}`);
  }
  console.log();

  const verdict = readWall(policies);
  if (!verdict.ok) {
    console.error(`[iam] ✗ ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`[iam] ✓ ${verdict.reason}`);
  console.log('[iam]   the other half is npm run verify:roles — this one cannot see it');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[iam] failed: ${message}`);
  if (/credential|token|AccessDenied|not authorized/i.test(message)) {
    console.error('[iam]   this needs an identity that can READ IAM — run with .env.admin.');
  }
  process.exit(1);
});
