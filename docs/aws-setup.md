# AWS Setup — Relay H0 MVP

> ⚠️ **H0-ERA PROVISIONING RECORD. Read this banner before running any of it (2026-08-21).**
>
> The *resource* half is still accurate — the cluster pair, the link, the CMK and the failover
> switch were created exactly this way. **The *identity* half is out of date, and following it
> verbatim re-opens the wall this project spent a sprint closing.** Four corrections, each also
> marked in place at the step it belongs to:
>
> - 🔴 **`infra/iam-policy.json` still grants `dsql:DbConnectAdmin` and `kms:DescribeKey`.** Of the
>   **DSQL** actions, the live `relay-runtime-policy` grants **`dsql:DbConnect` and nothing more**
>   (v2, 2026-08-16 — `docs/least-privilege-cutover.md`), and `npm run verify:iam` exits 1 the
>   moment the admin action comes back, whether by name, by wildcard, or in an inline user policy.
>   Creating a policy from that file today hands the runtime principal the exact grant that check
>   exists to refuse — and the product keeps working, which is why nobody would notice. See §6 and
>   the IAM Policy Reference.
>
>   ⚠️ **Read "and nothing more" with the scope it was measured at.** The 2026-08-16 command in
>   `docs/least-privilege-cutover.md` filters to statements whose `Sid` starts with `Dsql`, so it
>   says nothing at all about the KMS statement — and the runtime **does** still hold
>   `kms:GenerateDataKey` and `kms:Decrypt`, as the IAM Policy Reference table below records. A
>   runtime policy stripped to the DSQL line alone cannot wrap or unwrap a data key: no vault item
>   can be written and Reveal is dead for real people's credentials. (This bullet read
>   *"grants `dsql:DbConnect` and nothing more"* unscoped until 2026-08-21, contradicting this
>   file's own table 200 lines below.)
> - **Production authenticates as an IAM *user*, not as the role step 7 creates.** Vercel holds
>   static access keys for IAM `relay-runtime` and connects with `DSQL_ROLE=relay_app`. Nothing
>   assumes `relay-backend-dsql`, and the Vercel-OIDC note under step 7 is a direction that was
>   never taken.
> - **Step 8 applies one migration.** `db/migrations/` holds the whole set —
>   `ls db/migrations/*.sql | wc -l` for the count — and `db/migrations/migrate.ts` run from
>   `.env.admin` is how they are applied. `001_initial.sql` alone produces a schema the current
>   code cannot run against.
> - **Step 9's variable list is the H0 subset.** `.env.example` is the authority; it carries the
>   rest (`DSQL_ROLE`, `VERIFIER_JWT_SECRET`, the Stripe and Resend variables, `AUTH_SECRET`) and
>   the reason each one exists.
>
> Nothing below is deleted. This is the record of how the AWS resources were built, and a
> re-provision still starts here — it just does not *end* here any more: it ends at
> `docs/least-privilege-cutover.md`, which is what the identity model actually is.

This document describes how to manually provision the AWS resources required by Relay H0 MVP. Run these steps once before starting the application. For automated provisioning, use `scripts/provision-dsql.sh` instead.

---

## Prerequisites

- **AWS CLI v2** — [install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **AWS account** with the following permissions:
  - `dsql:CreateCluster`, `dsql:GetCluster`, `dsql:CreateMultiRegionProperties`
  - `iam:CreateRole`, `iam:CreatePolicy`, `iam:AttachRolePolicy`
  - `kms:CreateKey`, `kms:CreateAlias`, `kms:PutKeyPolicy`
  - `sts:GetCallerIdentity`
- **psql** client for running the DDL migration

---

## Step 1 — Create the Aurora DSQL Primary Cluster (us-east-1)

Aurora DSQL is a serverless, multi-region active-active PostgreSQL-compatible database. No instance type selection is required.

```bash
aws dsql create-cluster \
  --region us-east-1 \
  --deletion-protection-enabled \
  --tags Name=relay-h0-mvp,Project=relay-h0-mvp
```

**Save the output** — you need `identifier` and `arn`:

```json
{
  "identifier": "<PRIMARY_CLUSTER_ID>",
  "arn": "arn:aws:dsql:us-east-1:<ACCOUNT_ID>:cluster/<PRIMARY_CLUSTER_ID>",
  "status": "CREATING"
}
```

Wait for the cluster to become `ACTIVE`:

```bash
aws dsql wait cluster-active \
  --identifier <PRIMARY_CLUSTER_ID> \
  --region us-east-1
```

---

## Step 2 — Create the Aurora DSQL Secondary Cluster (us-west-2)

```bash
aws dsql create-cluster \
  --region us-west-2 \
  --deletion-protection-enabled \
  --tags Name=relay-h0-mvp-secondary,Project=relay-h0-mvp
```

Save the `identifier` as `<SECONDARY_CLUSTER_ID>`. Wait for `ACTIVE`:

```bash
aws dsql wait cluster-active \
  --identifier <SECONDARY_CLUSTER_ID> \
  --region us-west-2
```

---

## Step 3 — Link the Clusters (Multi-Region Active-Active)

This creates the active-active replication link between the two regional clusters. Both endpoints will accept reads and writes with strong consistency.

```bash
aws dsql create-multi-region-clusters \
  --region us-east-1 \
  --linked-region-list us-east-1 us-west-2
```

After linking, both clusters share the same logical dataset. Writes committed to either endpoint are immediately visible from the other.

---

## Step 4 — Record the Endpoint URLs

DSQL endpoint hostnames follow this pattern:

```
<cluster-id>.dsql.<region>.on.aws
```

Construct your endpoints:

| Variable | Value |
|---|---|
| `DSQL_PRIMARY_ENDPOINT` | `<PRIMARY_CLUSTER_ID>.dsql.us-east-1.on.aws` |
| `DSQL_SECONDARY_ENDPOINT` | `<SECONDARY_CLUSTER_ID>.dsql.us-west-2.on.aws` |
| `DSQL_CLUSTER_ARN` | `arn:aws:dsql:us-east-1:<ACCOUNT_ID>:cluster/<PRIMARY_CLUSTER_ID>` |

Add these to your `.env.local` and to Vercel project environment variables.

---

## Step 5 — Create the KMS Customer Managed Key

The CMK is used for envelope encryption: the backend calls `GenerateDataKey` to produce per-item AES-GCM-256 data keys, and `Decrypt` to unwrap them for authorized recipients.

```bash
KMS_KEY_ID=$(aws kms create-key \
  --description "Relay H0 MVP — vault item envelope encryption" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --tags TagKey=Project,TagValue=relay-h0-mvp \
  --region us-east-1 \
  --query 'KeyMetadata.KeyId' \
  --output text)

# Create a human-readable alias
aws kms create-alias \
  --alias-name alias/relay-h0-mvp \
  --target-key-id "${KMS_KEY_ID}" \
  --region us-east-1

echo "KMS_KEY_ID=${KMS_KEY_ID}"
```

Add `KMS_KEY_ID` to `.env.local` and Vercel.

---

## Step 6 — Create the IAM Policy

> 🔴 **DO NOT CREATE THE RUNTIME POLICY FROM THIS FILE AS IT STANDS (noted 2026-08-21).**
> `infra/iam-policy.json` is the H0 document and grants `dsql:DbConnectAdmin` alongside
> `dsql:DbConnect`, plus `kms:DescribeKey`. Production holds neither:
>
> - `dsql:DbConnectAdmin` was stripped from `relay-runtime-policy` on 2026-08-16 (v2; **v1 is
>   retained as the rollback and still carries the grant**, which is why `verify:iam` can be
>   proven to fail against real data). While that action is present, an operator who unsets
>   `DSQL_ROLE` is silently a superuser again, and so is anyone holding the key.
> - `kms:DescribeKey` is deliberately absent from the application's identity — that is why
>   `npm run verify:kms` needs `.env.admin` rather than the runtime credential.
>
> Until the file is brought to the v2 shape, use this document only for the *admin* provisioning
> identity, which legitimately needs the wider grant, and provision the **runtime** principal to
> the shape below.
>
> 🔴 **Do not lift the runtime policy out of `docs/least-privilege-cutover.md`.** That document
> holds no policy document — the line `"Action": ["dsql:DbConnect"]` there is a *fragment*,
> explicitly scoped to "the `DsqlConnect` statement, dropping `dsql:DbConnectAdmin`, keeping both
> cluster ARNs". Provisioning from it literally produces a runtime principal with `dsql:DbConnect`
> and **no KMS grants at all**, so every `kms:GenerateDataKey` and `kms:Decrypt` is denied: no
> vault item can be written and Reveal fails for real people's credentials. (This block said
> exactly that until 2026-08-21 — written to prevent a provisioning mistake, and prescribing a
> worse one.)
>
> **The whole v2 runtime shape, stated here rather than pointed at:**
>
> | Sid | Action | Notes |
> |---|---|---|
> | `DsqlConnect` | `dsql:DbConnect` | both cluster ARNs (us-east-1 primary + us-west-2 secondary); **no** `dsql:DbConnectAdmin`. Keep the `Sid` starting with `Dsql` — see the warning under the table |
> | `AllowKmsEnvelopeEncryption` | `kms:GenerateDataKey`, `kms:Decrypt` | **no `kms:DescribeKey`** — `scripts/verify-kms.ts` is why: it reads KMS metadata and therefore needs `.env.admin` |
> | `DenyKmsDecryptForAiRoles` | Deny `kms:Decrypt`, `kms:GenerateDataKey` | kept **verbatim** from `infra/iam-policy.json` — but **inert, and not protection today**: its `aws:PrincipalArn` condition matches a role nothing assumes. See the note under the IAM Policy Reference |
>
> ⚠️ **A renamed `Sid` makes the cutover doc's audit return `[]`, which reads as reassuring.** That
> query filters on `starts_with(Sid, 'Dsql')`. The live statement must therefore be named
> `Dsql…` — `infra/iam-policy.json` calls it **`AllowDsqlDbConnect`**, which would not match, and
> the query would print an empty list rather than an error. An operator scanning for
> `dsql:DbConnectAdmin` and seeing nothing would conclude the wall was intact. Use the unfiltered
> command below when the answer matters.
>
> ⚠️ **`npm run verify:iam` will not catch a missing KMS statement.** It reads the DSQL actions and
> nothing else — `grep -ci kms scripts/verify-iam.ts` returns `0` — so a runtime policy with the
> KMS statement deleted passes it. The check that a KMS grant is intact is a **real wrap and
> unwrap**: create a vault item and reveal it. Green from `verify:iam` here is a green light on the
> half of the policy that was not the problem.
>
> Before trusting either half, read the live document **unfiltered** (the `Dsql`-scoped query in
> `docs/least-privilege-cutover.md` is what produced the unscoped "and nothing more" claim this
> block used to repeat). Export `AWS_CA_BUNDLE` first, as that file's command does:
>
> ```bash
> ARN=arn:aws:iam::461293170793:policy/relay-runtime-policy
> aws iam get-policy-version --profile autospecai --policy-arn "$ARN" \
>   --version-id "$(aws iam get-policy --profile autospecai --policy-arn "$ARN" \
>       --query 'Policy.DefaultVersionId' --output text)" \
>   --query 'PolicyVersion.Document.Statement[].{Sid:Sid,Effect:Effect,Action:Action}' --output json
> ```
>
> The DSQL half of the table above carries a dated measurement (2026-08-16, in the cutover doc).
> The KMS half is the *design intent* recorded in `scripts/verify-kms.ts` and in the IAM Policy
> Reference table below; the 2026-08-16 command could not have measured it. Run the command above
> if you need it live rather than `wired`.

The policy document is at `infra/iam-policy.json`. Before creating it, substitute the real cluster ARN:

```bash
CLUSTER_ARN="arn:aws:dsql:us-east-1:<ACCOUNT_ID>:cluster/<PRIMARY_CLUSTER_ID>"

sed "s|CLUSTER_ARN_PLACEHOLDER|${CLUSTER_ARN}|g" infra/iam-policy.json > /tmp/relay-policy-resolved.json

POLICY_ARN=$(aws iam create-policy \
  --policy-name relay-backend-dsql-policy \
  --policy-document file:///tmp/relay-policy-resolved.json \
  --description "Allows relay backend service to authenticate to Aurora DSQL via IAM" \
  --query 'Policy.Arn' \
  --output text)

echo "POLICY_ARN=${POLICY_ARN}"
```

---

## Step 7 — Create the IAM Role for the Backend Service

> ⚠️ **This is not the identity production uses (noted 2026-08-21).** relaystandby.com runs on
> Vercel with static access keys for the IAM **user** `relay-runtime`, and connects to DSQL as the
> database role `relay_app` (`DSQL_ROLE`, set in Vercel Production scope). Nothing calls
> `sts:AssumeRole`, no Lambda exists, and the OIDC note below was never taken up. The role in this
> step is kept as the H0 record and because a future move to OIDC would rebuild something like it
> — but a policy attached to it today protects nothing that is running.
>
> The rotation procedure for the keys production actually holds is
> `docs/secret-rotation-runbook.md` §5; who may do what once connected is
> `docs/least-privilege-cutover.md`, re-measurable with `npm run verify:roles` and
> `npm run verify:iam`.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/relay-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBackendServiceAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Sid": "AllowSameAccountAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::${ACCOUNT_ID}:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "relay-h0-mvp-backend"
        }
      }
    }
  ]
}
EOF

ROLE_ARN=$(aws iam create-role \
  --role-name relay-backend-dsql \
  --assume-role-policy-document file:///tmp/relay-trust-policy.json \
  --description "Backend service role for Relay H0 MVP — Aurora DSQL IAM auth" \
  --tags Key=Project,Value=relay-h0-mvp \
  --query 'Role.Arn' \
  --output text)

# Attach the DSQL policy
aws iam attach-role-policy \
  --role-name relay-backend-dsql \
  --policy-arn "${POLICY_ARN}"

echo "ROLE_ARN=${ROLE_ARN}"
```

> **Vercel deployment note:** When deploying to Vercel, use [Vercel's AWS OIDC integration](https://vercel.com/docs/integrations/external-services/aws) to have Vercel assume this role without storing long-lived AWS credentials as env vars.

---

## Step 8 — Apply the DDL Migration

> ⚠️ **`001_initial.sql` is the first of a set, not the schema (noted 2026-08-21).** The `psql`
> invocation below applies exactly one file, which was the whole schema in H0 and has not been
> since. Derive the real count with `ls db/migrations/*.sql | wc -l`; apply them in order with
> the runner, which mints its own IAM token and reads the endpoint from the environment:
>
> ```bash
> npx tsx --env-file=.env.admin db/migrations/migrate.ts 001_initial.sql   # then 002, 003, …
> ```
>
> **Migrations are a sysadmin act**, which is what `.env.admin` means: it names the `autospecai`
> principal, not the runtime one. `migrate.ts` tracks nothing and applies one named file, so what
> has reached which cluster is not recorded anywhere — `npm run verify:schema` is the check that
> answers it, in **both** regions, tables *and* columns. Run it after every migration: a file whose
> entire content is `ADD COLUMN` used to pass a table-name comparison while being wholly unapplied.

Connect to the primary DSQL endpoint using `psql`. Aurora DSQL uses IAM token authentication instead of a password:

```bash
# Generate a short-lived auth token (valid 15 minutes)
AUTH_TOKEN=$(aws dsql generate-db-connect-admin-auth-token \
  --hostname <PRIMARY_CLUSTER_ID>.dsql.us-east-1.on.aws \
  --region us-east-1 \
  --expires-in 900)

psql "host=<PRIMARY_CLUSTER_ID>.dsql.us-east-1.on.aws \
      dbname=relay \
      user=admin \
      password=${AUTH_TOKEN} \
      sslmode=require" \
  -f db/migrations/001_initial.sql
```

Verify connectivity to both regions:

```bash
# Primary
psql "host=<PRIMARY_CLUSTER_ID>.dsql.us-east-1.on.aws dbname=relay user=admin password=${AUTH_TOKEN} sslmode=require" \
  -c "SELECT current_database(), now();"

# Secondary (generate a new token for us-west-2)
AUTH_TOKEN_WEST=$(aws dsql generate-db-connect-admin-auth-token \
  --hostname <SECONDARY_CLUSTER_ID>.dsql.us-west-2.on.aws \
  --region us-west-2 \
  --expires-in 900)

psql "host=<SECONDARY_CLUSTER_ID>.dsql.us-west-2.on.aws dbname=relay user=admin password=${AUTH_TOKEN_WEST} sslmode=require" \
  -c "SELECT current_database(), now();"
```

---

## Step 9 — Populate Environment Variables

> ⚠️ **This list is the H0 subset and is no longer sufficient (noted 2026-08-21).** `.env.example`
> is the authority — it is the file the rotation guard derives its obligations from
> (`lib/ops/secrets-have-a-rotation-procedure.test.ts` fails when a secret-shaped variable there
> has no procedure), and it carries what this block predates: `DSQL_ROLE` (which identity the app
> connects as — unset still means `admin`), `VERIFIER_JWT_SECRET`, `AUTH_SECRET`, the Stripe
> variables (live since 2026-08-08), the Resend variables, and `DEV_MAIL_ALLOWLIST`, which is what
> stops a local server mailing a real person from the production sending domain.
>
> Copy `.env.example` → `.env.local` and fill it in; read the block above each variable before
> setting it. Several of them say what a wrong value costs, and two of those costs reach a family
> in an emergency.

After completing all steps above, your `.env.local` should contain:

```
DSQL_PRIMARY_ENDPOINT=<PRIMARY_CLUSTER_ID>.dsql.us-east-1.on.aws
DSQL_SECONDARY_ENDPOINT=<SECONDARY_CLUSTER_ID>.dsql.us-west-2.on.aws
DSQL_CLUSTER_ARN=arn:aws:dsql:us-east-1:<ACCOUNT_ID>:cluster/<PRIMARY_CLUSTER_ID>
KMS_KEY_ID=<KMS_KEY_UUID_OR_ALIAS>
NEXTAUTH_SECRET=<openssl rand -base64 32>
RECIPIENT_JWT_SECRET=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -hex 32>
```

Copy the same values into the Vercel project's environment variables panel (Settings → Environment Variables).

---

## IAM Policy Reference

The full policy document is in `infra/iam-policy.json`. Key permissions — **and which principal
actually holds each one today (2026-08-21)**, because the file and production have diverged:

| Permission | Purpose | Runtime (`relay-runtime`) | Admin (`autospecai`) |
|---|---|---|---|
| `dsql:DbConnect` | IAM-authenticated connection to the DSQL cluster | ✅ the only DSQL action it holds | ✅ |
| `dsql:DbConnectAdmin` | Admin-level connection for migrations | 🔴 **stripped 2026-08-16 (v2)** — `verify:iam` fails if it returns | ✅ this is how migrations run |
| `kms:GenerateDataKey` | Create per-item AES-GCM-256 envelope keys | ✅ | ✅ |
| `kms:Decrypt` | Unwrap data keys for authorized decryption | ✅ | ✅ |
| `kms:DescribeKey` | Validate the CMK exists and is enabled | 🔴 **deliberately not held** — which is why `npm run verify:kms` needs `.env.admin` | ✅ |

> Was: this table listed all five as "the policy", with `dsql:DbConnectAdmin` described as the
> runtime's route to migrations and `kms:Describe Key` (sic) as a runtime validation. Both were
> true in H0 and neither is true now. The right-hand columns are the correction; the left two are
> left as written because `infra/iam-policy.json` still says exactly that, and a reader comparing
> the two should find the discrepancy explained rather than tidied away.

### The `DenyKmsDecryptForAiRoles` statement is **inert** — it is not the ZK boundary

> **Was:** *"The Deny statement in the policy (`DenyKmsDecryptForAiRoles`) ensures that any role
> matching `relay-ai-intake*` cannot call `kms:Decrypt` or `kms:GenerateDataKey`, enforcing the ZK
> boundary for the Intake Agent (Requirement 11.5)."* **It does not, and it never has.** Corrected
> 2026-08-21 — `infra/README.md` names this file, quoting that sentence, as one of two documents
> that had to be fixed. It was still standing when the next reader came looking.

The statement's condition is `aws:PrincipalArn` `ArnLike` `…:role/relay-ai-intake*`. **Nothing in
this repository ever assumes a role** — no `AssumeRole`, no `fromTemporaryCredentials`, no
`STSClient`. `runIntake()` runs in process under the single runtime principal, called from two
route handlers, so the condition can never match and the Deny can never fire.

Requirement 11.5 names two mechanisms and **only the second one is real**: the query-layer
projection in `lib/ai/metadata-query.ts`. `lib/ops/zk-boundary.test.ts` is what enforces it — no
SQL anywhere under `lib/ai/` may name `ciphertext`, `wrapped_data_key` or `kms_key_id` — because a
projection module being careful is a convention, and four of the six modules there import `query`
directly.

**Keep the statement.** It costs nothing, it becomes correct the day a separate intake role exists,
and deleting it would erase the only written trace of the intended design. Running intake under its
own principal is new capability held behind demand, not work outstanding. What was obliged was that
this file stop counting it as protection that exists today. `infra/README.md` holds the full
account.

---

## Failover Testing

To simulate a regional failover for the demo:

1. Set `DSQL_USE_SECONDARY=true` in Vercel environment variables.
2. Trigger a redeployment (or use the Vercel API to update the env var live).
3. All database traffic will route to `DSQL_SECONDARY_ENDPOINT` (us-west-2).
4. Reset to `DSQL_USE_SECONDARY=false` to return to the primary region.

The connection manager in `lib/db/connection.ts` handles the routing automatically.

> 🔴 **THE SWITCH MOVES THE DATA AND NOT THE KEY.** `lib/kms/kms-client.ts` builds one `KMSClient`
> from `AWS_REGION` against one single-Region CMK, so a failover reaches the us-west-2 database and
> then asks a **us-east-1** key to unwrap what it finds there. A regional KMS impairment in
> us-east-1 therefore makes every vault unreadable from *both* regions — and the confusing part on
> the day is that the site is up and the dashboard renders, because only Reveal fails. Known and
> accepted: `PROJECT.yaml → deferred → the-failover-does-not-carry-the-ability-to-decrypt` (B3).
> The fix is a multi-Region CMK, which is an infrastructure change to a working system and needs
> the 5-gate policy and Steve's explicit request — `docs/kms-region-proposal.md`.
