#!/usr/bin/env bash
# =============================================================================
# provision-dsql.sh
# Provisions a multi-region Aurora DSQL cluster pair for Relay H0.
#
#   Active data regions : us-east-1 (primary) + us-west-2 (secondary)
#   Witness region      : us-east-2  (quorum log only — NO cluster, NO endpoint)
#
# Aurora DSQL multi-region API (verified 2026-06-23 against aws-cli/2.27):
#   1. create-cluster in each active region with --multi-region-properties
#      '{"witnessRegion":"us-east-2"}'  (clusters start PENDING_SETUP)
#   2. update-cluster in each region adding the OTHER region's ARN under
#      "clusters":[...]  -> the pair links and both transition to ACTIVE
#   There is NO `create-multi-region-clusters` operation (the old script called
#   one that does not exist and swallowed the error, leaving two unlinked paid
#   clusters). This version fails loudly and links correctly.
#
# Deletion protection is left OFF during provisioning so a failed link can be
# torn down cheaply; it is enabled at the end once both clusters are ACTIVE.
#
# Requirements: 14.1 (two-region active-active), 17.3 (IAM auth for DSQL).
# Outputs .env.dsql with the endpoints + ARN for go-live.sh / Vercel.
#
# Usage:
#   AWS_PROFILE=wpengine2 ./scripts/provision-dsql.sh
#   (or)  PROFILE=wpengine2 ./scripts/provision-dsql.sh
# =============================================================================
set -euo pipefail

PRIMARY_REGION="us-east-1"
SECONDARY_REGION="us-west-2"
WITNESS_REGION="us-east-2"
PROFILE="${PROFILE:-${AWS_PROFILE:-wpengine2}}"
TAG_KEY="Project"; TAG_VAL="relay-h0-mvp"
OUTPUT_FILE=".env.dsql"
WAIT_TIMEOUT_SECS=900

aws_() { aws --profile "$PROFILE" --output text "$@"; }
say()  { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mHALT: %s\033[0m\n' "$*" >&2; exit 1; }

say "Relay H0 — Aurora DSQL multi-region provisioning"
ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account)
WHO=$(aws_ sts get-caller-identity --query Arn)
echo "profile=$PROFILE  account=$ACCOUNT_ID"
echo "identity=$WHO"
echo "peers: $PRIMARY_REGION + $SECONDARY_REGION   witness: $WITNESS_REGION"

# ---------------------------------------------------------------------------
# 1. Create both clusters (PENDING_SETUP until peered). Idempotent-ish: reuse
#    .env.dsql ids if a prior run got this far.
# ---------------------------------------------------------------------------
say "[1/5] Create primary cluster in $PRIMARY_REGION"
PRIMARY_ARN=$(aws_ dsql create-cluster --region "$PRIMARY_REGION" \
  --no-deletion-protection-enabled \
  --multi-region-properties "{\"witnessRegion\":\"$WITNESS_REGION\"}" \
  --query arn)
PRIMARY_ID="${PRIMARY_ARN##*/}"
echo "primary:   id=$PRIMARY_ID  arn=$PRIMARY_ARN"

say "[2/5] Create secondary cluster in $SECONDARY_REGION"
SECONDARY_ARN=$(aws_ dsql create-cluster --region "$SECONDARY_REGION" \
  --no-deletion-protection-enabled \
  --multi-region-properties "{\"witnessRegion\":\"$WITNESS_REGION\"}" \
  --query arn)
SECONDARY_ID="${SECONDARY_ARN##*/}"
echo "secondary: id=$SECONDARY_ID  arn=$SECONDARY_ARN"

# ---------------------------------------------------------------------------
# 2. Link the pair: each region's cluster lists the OTHER as a peer.
# ---------------------------------------------------------------------------
say "[3/5] Peer the clusters (add each other's ARN)"
aws_ dsql update-cluster --region "$PRIMARY_REGION" --identifier "$PRIMARY_ID" \
  --multi-region-properties "{\"witnessRegion\":\"$WITNESS_REGION\",\"clusters\":[\"$SECONDARY_ARN\"]}" \
  --query status
aws_ dsql update-cluster --region "$SECONDARY_REGION" --identifier "$SECONDARY_ID" \
  --multi-region-properties "{\"witnessRegion\":\"$WITNESS_REGION\",\"clusters\":[\"$PRIMARY_ARN\"]}" \
  --query status

# ---------------------------------------------------------------------------
# 3. Wait for both to reach ACTIVE (poll, don't rely on a waiter that may not
#    exist for the linked transition).
# ---------------------------------------------------------------------------
say "[4/5] Wait for ACTIVE (up to ${WAIT_TIMEOUT_SECS}s)"
wait_active() {
  local region=$1 id=$2 deadline=$(( SECONDS + WAIT_TIMEOUT_SECS )) st
  while (( SECONDS < deadline )); do
    st=$(aws_ dsql get-cluster --region "$region" --identifier "$id" --query status 2>/dev/null || echo "QUERY_ERR")
    printf '   %s/%s : %s\n' "$region" "${id:0:8}" "$st"
    [ "$st" = "ACTIVE" ] && return 0
    case "$st" in FAILED|DELETING) die "$region/$id entered $st";; esac
    sleep 15
  done
  die "$region/$id did not reach ACTIVE within ${WAIT_TIMEOUT_SECS}s"
}
wait_active "$PRIMARY_REGION"   "$PRIMARY_ID"
wait_active "$SECONDARY_REGION" "$SECONDARY_ID"

# ---------------------------------------------------------------------------
# 4. Tag + enable deletion protection now that the pair is healthy (best-effort
#    tagging; protection guards the demo window — disable before teardown).
# ---------------------------------------------------------------------------
say "[5/5] Tag + enable deletion protection"
aws_ dsql tag-resource --region "$PRIMARY_REGION"   --resource-arn "$PRIMARY_ARN"   --tags "$TAG_KEY=$TAG_VAL" 2>/dev/null || echo "(tag primary skipped)"
aws_ dsql tag-resource --region "$SECONDARY_REGION" --resource-arn "$SECONDARY_ARN" --tags "$TAG_KEY=$TAG_VAL" 2>/dev/null || echo "(tag secondary skipped)"
aws_ dsql update-cluster --region "$PRIMARY_REGION"   --identifier "$PRIMARY_ID"   --deletion-protection-enabled --query status >/dev/null
aws_ dsql update-cluster --region "$SECONDARY_REGION" --identifier "$SECONDARY_ID" --deletion-protection-enabled --query status >/dev/null

# ---------------------------------------------------------------------------
# 5. Endpoints + env output. DSQL endpoint = <cluster-id>.dsql.<region>.on.aws
# ---------------------------------------------------------------------------
PRIMARY_ENDPOINT="${PRIMARY_ID}.dsql.${PRIMARY_REGION}.on.aws"
SECONDARY_ENDPOINT="${SECONDARY_ID}.dsql.${SECONDARY_REGION}.on.aws"

cat > "$OUTPUT_FILE" <<ENVFILE
# Aurora DSQL — auto-generated by provision-dsql.sh ($(date -u +%Y-%m-%dT%H:%M:%SZ))
# Active peers: ${PRIMARY_REGION} + ${SECONDARY_REGION}  |  witness: ${WITNESS_REGION}
DSQL_PRIMARY_ENDPOINT=${PRIMARY_ENDPOINT}
DSQL_SECONDARY_ENDPOINT=${SECONDARY_ENDPOINT}
DSQL_CLUSTER_ARN=${PRIMARY_ARN}
DSQL_SECONDARY_CLUSTER_ARN=${SECONDARY_ARN}
ENVFILE

say "Provisioning complete"
cat "$OUTPUT_FILE"
cat <<NEXT

Next (go-live.sh continues from here): KMS key -> merge .env.local -> migrate ->
seed -> verify both regions -> Vercel deploy.

NOTE: app runtime IAM auth — lib/db/connection.ts must mint DSQL tokens via
@aws-sdk/dsql-signer (see go-live.sh step-0 guard) before the deployed app works.

Teardown when done:
  aws --profile $PROFILE dsql update-cluster --region $PRIMARY_REGION   --identifier $PRIMARY_ID   --no-deletion-protection-enabled
  aws --profile $PROFILE dsql update-cluster --region $SECONDARY_REGION --identifier $SECONDARY_ID --no-deletion-protection-enabled
  aws --profile $PROFILE dsql delete-cluster --region $PRIMARY_REGION   --identifier $PRIMARY_ID
  aws --profile $PROFILE dsql delete-cluster --region $SECONDARY_REGION --identifier $SECONDARY_ID
NEXT
