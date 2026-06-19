# AWS Setup — Relay H0 MVP

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

The full policy document is in `infra/iam-policy.json`. Key permissions:

| Permission | Purpose |
|---|---|
| `dsql:DbConnect` | IAM-authenticated connection to the DSQL cluster |
| `dsql:DbConnectAdmin` | Admin-level connection for migrations |
| `kms:GenerateDataKey` | Create per-item AES-GCM-256 envelope keys |
| `kms:Decrypt` | Unwrap data keys for authorized decryption |
| `kms:Describe Key` | Validate the CMK exists and is enabled |

The Deny statement in the policy (`DenyKmsDecryptForAiRoles`) ensures that any role matching `relay-ai-intake*` cannot call `kms:Decrypt` or `kms:GenerateDataKey`, enforcing the ZK boundary for the Intake Agent (Requirement 11.5).

---

## Failover Testing

To simulate a regional failover for the demo:

1. Set `DSQL_USE_SECONDARY=true` in Vercel environment variables.
2. Trigger a redeployment (or use the Vercel API to update the env var live).
3. All database traffic will route to `DSQL_SECONDARY_ENDPOINT` (us-west-2).
4. Reset to `DSQL_USE_SECONDARY=false` to return to the primary region.

The connection manager in `lib/db/connection.ts` handles the routing automatically.
