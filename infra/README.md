# `infra/iam-policy.json` — what each statement actually does

This file is a **template**, not a mirror of the live policy. It carries
`CLUSTER_ARN_PLACEHOLDER` and is applied by hand (`docs/aws-setup.md`). Two of
its three statements no longer say what a reader would assume, and neither
divergence is visible from inside the JSON, because IAM policy documents cannot
carry comments. That is the whole reason this file exists.

`lib/ops/zk-boundary.test.ts` asserts every `Sid` below is still explained here,
so a statement cannot be added to the policy without an account of it.

## `AllowDsqlDbConnect`

⚠️ **This template still grants `dsql:DbConnectAdmin`, and production does not
have it any more.** The least-privilege cutover on 2026-08-16 stripped that
action from `relay-runtime-policy` (v2 live; v1 retained as the rollback) so the
live site cannot obtain database admin by permission rather than by
configuration. `npm run verify:iam` re-measures that wall against the live
policy, including wildcards and inline user policies.

**So re-applying this file to the runtime principal would undo that cutover** —
silently, in one `create-policy-version`, with the application continuing to work
exactly as before. Migrations do not need it: they run as the sysadmin identity
(`.env.admin` → IAM `autospecai` → DB role `admin`), which is a different
principal by design.

Removing the action from this template is the obvious fix and it is deliberately
NOT taken here. Editing a security artifact that is applied by hand to a live
account, without being able to read that account's current policy back, is the
class of change the Infrastructure Change Policy exists for. Recorded 2026-08-21;
**Steve's call**, and `verify:iam` is what stands guard in the meantime.

## `AllowKmsEnvelopeEncryption`

The runtime's envelope-encryption grant: `GenerateDataKey`, `Decrypt`,
`DescribeKey`, conditioned on the `Project=relay-h0-mvp` resource tag.

⚠️ Note `kms:DescribeKey` here. `npm run verify:kms` runs under `.env.admin`
precisely *because* the application is not meant to hold key-administration
reads; if the runtime keeps `DescribeKey`, that separation is weaker than the
runbook's description of it. Not a live exposure — `DescribeKey` reveals key
metadata, not key material — but worth deciding rather than inheriting.

## `DenyKmsDecryptForAiRoles`

🔴 **THIS STATEMENT MATCHES NO PRINCIPAL THAT EXISTS, AND THE DOCS SAY IT
ENFORCES THE ZERO-KNOWLEDGE BOUNDARY.**

It denies `kms:Decrypt` and `kms:GenerateDataKey` to any principal whose ARN
matches `arn:aws:iam::*:role/relay-ai-intake*`. Nothing in this repo assumes any
role: `grep -rn "AssumeRole\|fromTemporaryCredentials\|STSClient" lib src scripts`
returns nothing. The intake agent is `runIntake()`, called **in process** from
`src/app/api/import/route.ts` and `src/app/api/ai/intake/route.ts`, under the
single runtime principal. The condition can therefore never be true, and the
statement can never deny anything.

**Where the boundary actually is:** `lib/ai/metadata-query.ts` — a SELECT
projection that returns non-secret columns only, described in its own header as
"the ONLY data accessor permitted inside AI route handlers". That is a
convention, not a permission, and `zk-boundary.test.ts` gives it the structural
half it was missing: no SQL anywhere under `lib/ai/` may name `ciphertext`,
`wrapped_data_key` or `kms_key_id`.

**Requirement 11.5 / 17.4 name two mechanisms and only the second one is real.**
Saying so is obliged; building the first is not. Running the intake path under a
separate assumed role is new capability, held behind demand like any other — and
the docs that claim it already works are the defect to fix:

- `docs/aws-setup.md` ("ensures that any role matching `relay-ai-intake*` cannot
  call `kms:Decrypt` … enforcing the ZK boundary for the Intake Agent")
- `docs/SUBMISSION-RUNBOOK.md`

The statement is **kept** rather than deleted. It costs nothing, it is correct
the day a separate role appears, and deleting it would remove the only written
trace of an intended design. It must simply stop being counted as protection
that exists today.
