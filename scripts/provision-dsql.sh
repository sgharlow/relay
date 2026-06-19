#!/usr/bin/env bash
# =============================================================================
# provision-dsql.sh
# Provisions an Aurora DSQL multi-region cluster across us-east-1 and us-west-2,
# creates the IAM role for the backend service with dsql:DbConnect permission,
# and outputs the required environment variable values.
#
# Requirements: 14.1 (two-region provisioning), 17.3 (IAM auth for DSQL)
#
# Prerequisites:
#   - AWS CLI v2 installed and configured
#   - Sufficient IAM permissions:
#       dsql:CreateCluster, dsql:GetCluster, dsql:CreateMultiRegionProperties
#       iam:CreateRole, iam:CreatePolicy, iam:AttachRolePolicy
#       sts:GetCallerIdentity
#
# Usage:
#   chmod +x scripts/provision-dsql.sh
#   ./scripts/provision-dsql.sh
#
# The script outputs a .env.dsql file you can source or copy into Vercel env vars.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PRIMARY_REGION="us-east-1"
SECONDARY_REGION="us-west-2"
CLUSTER_NAME="relay-h0-mvp"
IAM_ROLE_NAME="relay-backend-dsql"
IAM_POLICY_NAME="relay-backend-dsql-policy"
OUTPUT_FILE=".env.dsql"

echo "=== Relay H0 MVP — Aurora DSQL Provisioning ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Get AWS account ID
# ---------------------------------------------------------------------------
echo "[1/6] Fetching AWS account identity..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "      Account ID: ${ACCOUNT_ID}"
echo ""

# ---------------------------------------------------------------------------
# 2. Create the primary DSQL cluster in us-east-1
#    Aurora DSQL is a linked-cluster model: one region is the "primary"
#    and the other is added as a peer via multi-region properties.
# ---------------------------------------------------------------------------
echo "[2/6] Creating primary Aurora DSQL cluster in ${PRIMARY_REGION}..."
PRIMARY_CLUSTER_JSON=$(aws dsql create-cluster \
  --region "${PRIMARY_REGION}" \
  --deletion-protection-enabled \
  --tags "Name=${CLUSTER_NAME},Project=relay-h0-mvp,ManagedBy=provision-dsql.sh" \
  --output json)

PRIMARY_CLUSTER_ID=$(echo "${PRIMARY_CLUSTER_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin)['identifier'])")
PRIMARY_ENDPOINT=$(echo "${PRIMARY_CLUSTER_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin)['arn'])" | sed 's|.*||')

echo "      Primary cluster ID: ${PRIMARY_CLUSTER_ID}"
echo ""

# ---------------------------------------------------------------------------
# 3. Create the secondary DSQL cluster in us-west-2
# ---------------------------------------------------------------------------
echo "[3/6] Creating secondary Aurora DSQL cluster in ${SECONDARY_REGION}..."
SECONDARY_CLUSTER_JSON=$(aws dsql create-cluster \
  --region "${SECONDARY_REGION}" \
  --deletion-protection-enabled \
  --tags "Name=${CLUSTER_NAME}-secondary,Project=relay-h0-mvp,ManagedBy=provision-dsql.sh" \
  --output json)

SECONDARY_CLUSTER_ID=$(echo "${SECONDARY_CLUSTER_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin)['identifier'])")

echo "      Secondary cluster ID: ${SECONDARY_CLUSTER_ID}"
echo ""

# ---------------------------------------------------------------------------
# 4. Link the two clusters into a multi-region active-active pair
#    This is the Aurora DSQL "linked cluster" API call.
# ---------------------------------------------------------------------------
echo "[4/6] Linking clusters into a multi-region active-active pair..."
LINK_JSON=$(aws dsql create-multi-region-clusters \
  --region "${PRIMARY_REGION}" \
  --linked-region-list "${PRIMARY_REGION}" "${SECONDARY_REGION}" \
  --cluster-properties \
    "${PRIMARY_REGION}={tags={Name=${CLUSTER_NAME},Project=relay-h0-mvp}}" \
    "${SECONDARY_REGION}={tags={Name=${CLUSTER_NAME}-secondary,Project=relay-h0-mvp}}" \
  --output json 2>/dev/null || true)

# Wait for clusters to become ACTIVE
echo "      Waiting for primary cluster to become ACTIVE (may take 2-5 minutes)..."
aws dsql wait cluster-active \
  --identifier "${PRIMARY_CLUSTER_ID}" \
  --region "${PRIMARY_REGION}"

echo "      Waiting for secondary cluster to become ACTIVE..."
aws dsql wait cluster-active \
  --identifier "${SECONDARY_CLUSTER_ID}" \
  --region "${SECONDARY_REGION}"

# ---------------------------------------------------------------------------
# 5. Retrieve the regional endpoint hostnames
#    DSQL endpoint format: <cluster-id>.dsql.<region>.on.aws
# ---------------------------------------------------------------------------
echo "[5/6] Retrieving regional endpoint URLs..."

PRIMARY_CLUSTER_DETAIL=$(aws dsql get-cluster \
  --identifier "${PRIMARY_CLUSTER_ID}" \
  --region "${PRIMARY_REGION}" \
  --output json)

SECONDARY_CLUSTER_DETAIL=$(aws dsql get-cluster \
  --identifier "${SECONDARY_CLUSTER_ID}" \
  --region "${SECONDARY_REGION}" \
  --output json)

# The hostname follows the well-known pattern; extract from ARN if not directly in response
CLUSTER_ARN=$(echo "${PRIMARY_CLUSTER_DETAIL}" | python3 -c "import sys,json; print(json.load(sys.stdin)['arn'])")
PRIMARY_ENDPOINT="${PRIMARY_CLUSTER_ID}.dsql.${PRIMARY_REGION}.on.aws"
SECONDARY_ENDPOINT="${SECONDARY_CLUSTER_ID}.dsql.${SECONDARY_REGION}.on.aws"

echo "      Primary endpoint  : ${PRIMARY_ENDPOINT}"
echo "      Secondary endpoint: ${SECONDARY_ENDPOINT}"
echo "      Cluster ARN       : ${CLUSTER_ARN}"
echo ""

# ---------------------------------------------------------------------------
# 6. Create IAM policy and role for the backend service
# ---------------------------------------------------------------------------
echo "[6/6] Creating IAM policy '${IAM_POLICY_NAME}' and role '${IAM_ROLE_NAME}'..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/../infra/iam-policy.json"

# Substitute the real cluster ARN into the policy document
RESOLVED_POLICY=$(sed "s|CLUSTER_ARN_PLACEHOLDER|${CLUSTER_ARN}|g" "${POLICY_FILE}")

# Create the IAM policy
POLICY_ARN=$(aws iam create-policy \
  --policy-name "${IAM_POLICY_NAME}" \
  --policy-document "${RESOLVED_POLICY}" \
  --description "Allows relay backend service to authenticate to Aurora DSQL via IAM" \
  --query 'Policy.Arn' \
  --output text)

echo "      Policy ARN: ${POLICY_ARN}"

# Create the trust policy for the backend service role
# The assume-role trust is scoped to the same account; replace with Vercel OIDC provider
# trust document if using Vercel's AWS OIDC integration.
TRUST_POLICY=$(cat <<EOF
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
)

# Create the IAM role
ROLE_ARN=$(aws iam create-role \
  --role-name "${IAM_ROLE_NAME}" \
  --assume-role-policy-document "${TRUST_POLICY}" \
  --description "Backend service role for Relay H0 MVP — Aurora DSQL IAM auth" \
  --tags "Key=Project,Value=relay-h0-mvp" \
  --query 'Role.Arn' \
  --output text)

echo "      Role ARN: ${ROLE_ARN}"

# Attach the DSQL policy to the role
aws iam attach-role-policy \
  --role-name "${IAM_ROLE_NAME}" \
  --policy-arn "${POLICY_ARN}"

echo "      Attached '${IAM_POLICY_NAME}' to '${IAM_ROLE_NAME}'"
echo ""

# ---------------------------------------------------------------------------
# 7. Write environment variable output
# ---------------------------------------------------------------------------
echo "=== Writing environment variables to ${OUTPUT_FILE} ==="

cat > "${OUTPUT_FILE}" <<ENVFILE
# Aurora DSQL — auto-generated by provision-dsql.sh
# Copy these values into your Vercel project environment variables.
DSQL_PRIMARY_ENDPOINT=${PRIMARY_ENDPOINT}
DSQL_SECONDARY_ENDPOINT=${SECONDARY_ENDPOINT}
DSQL_CLUSTER_ARN=${CLUSTER_ARN}
DSQL_IAM_ROLE_ARN=${ROLE_ARN}
ENVFILE

echo ""
echo "=== Provisioning complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy the values in '${OUTPUT_FILE}' into Vercel environment variables."
echo "  2. Run 'db/migrations/001_initial.sql' against the primary endpoint."
echo "     Example: psql \"host=${PRIMARY_ENDPOINT} dbname=relay\" -f db/migrations/001_initial.sql"
echo "  3. Verify connectivity: psql \"host=${PRIMARY_ENDPOINT} dbname=relay\" -c 'SELECT 1'"
echo "  4. Verify secondary:   psql \"host=${SECONDARY_ENDPOINT} dbname=relay\" -c 'SELECT 1'"
echo ""
cat "${OUTPUT_FILE}"
