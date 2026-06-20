#!/usr/bin/env bash
# =============================================================================
# go-live.sh — one-shot Relay H0 provision → migrate → seed → deploy.
#
# Orchestrates the pieces that already exist (provision-dsql.sh, the migration
# runner, the demo seed) plus KMS + Vercel into a single reviewed pass. Run it
# ONCE you have: OpenAI + Resend keys, AWS creds, and the Vercel CLI logged in.
#
# It is deliberately fail-fast and idempotent-ish: each AWS create is guarded so
# re-running after a mid-way failure skips what already exists. Reads secrets
# from .env.local (generated 2026-06-19).
#
#   chmod +x scripts/go-live.sh && ./scripts/go-live.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PRIMARY_REGION="us-east-1"
SECONDARY_REGION="us-west-2"
KMS_ALIAS="alias/relay-h0-mvp"

say() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mHALT: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. HARD GUARD — runtime DSQL auth must be wired, or the deployed app 500s.
# ---------------------------------------------------------------------------
say "0/8  Pre-flight guards"
grep -q '@aws-sdk/dsql-signer' package.json || die \
"lib/db/connection.ts has NO DSQL auth-token minting and @aws-sdk/dsql-signer is
 NOT installed. The migration can run with a CLI token, but the DEPLOYED APP will
 fail IAM auth on every query. Apply the connection fix first (mirror orbis:
 add @aws-sdk/dsql-signer + an async 'password: () => signer.getDbConnectAdminAuthToken()'
 and user:'admin' to the primary/secondary pools), then re-run. (Claude can do this.)"

[ -f .env.local ] || die ".env.local not found (run the secret-generation step first)."
set -a; source .env.local; set +a
command -v aws >/dev/null   || die "AWS CLI not found."
command -v psql >/dev/null  || die "psql not found."
command -v vercel >/dev/null || die "Vercel CLI not found (npm i -g vercel; vercel login)."
aws sts get-caller-identity >/dev/null || die "AWS creds not configured."
: "${OPENAI_API_KEY:?set OPENAI_API_KEY in .env.local}"
: "${RESEND_API_KEY:?set RESEND_API_KEY in .env.local}"
: "${RESEND_FROM_ADDRESS:?set RESEND_FROM_ADDRESS in .env.local}"
for s in NEXTAUTH_SECRET RECIPIENT_JWT_SECRET VERIFIER_JWT_SECRET CRON_SECRET TOTP_SECRET; do
  [ -n "${!s:-}" ] || die "$s missing in .env.local"
done
echo "guards passed."

# ---------------------------------------------------------------------------
# 1. Provision 2-region Aurora DSQL + IAM role (existing script).
# ---------------------------------------------------------------------------
say "1/8  Provision Aurora DSQL (2-region) + IAM"
if [ -f .env.dsql ]; then echo "(.env.dsql exists — skipping provision)"; else
  bash scripts/provision-dsql.sh
fi
set -a; source .env.dsql; set +a
: "${DSQL_PRIMARY_ENDPOINT:?provision did not yield DSQL_PRIMARY_ENDPOINT}"

# ---------------------------------------------------------------------------
# 2. KMS CMK + alias (envelope-encryption key).
# ---------------------------------------------------------------------------
say "2/8  KMS customer-managed key"
if KEY_ID=$(aws kms describe-key --key-id "$KMS_ALIAS" --region "$PRIMARY_REGION" --query 'KeyMetadata.KeyId' --output text 2>/dev/null); then
  echo "(alias $KMS_ALIAS exists → $KEY_ID)"
else
  KEY_ID=$(aws kms create-key --description "Relay H0 — vault envelope encryption" \
    --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT \
    --tags TagKey=Project,TagValue=relay-h0-mvp --region "$PRIMARY_REGION" \
    --query 'KeyMetadata.KeyId' --output text)
  aws kms create-alias --alias-name "$KMS_ALIAS" --target-key-id "$KEY_ID" --region "$PRIMARY_REGION"
fi
KMS_KEY_ID="$KEY_ID"

# ---------------------------------------------------------------------------
# 3. Merge provisioned values back into .env.local.
# ---------------------------------------------------------------------------
say "3/8  Update .env.local with provisioned endpoints + KMS"
upd() { local k=$1 v=$2; if grep -q "^$k=" .env.local; then
  sed -i.bak "s|^$k=.*|$k=$v|" .env.local; else echo "$k=$v" >> .env.local; fi; }
upd DSQL_PRIMARY_ENDPOINT   "$DSQL_PRIMARY_ENDPOINT"
upd DSQL_SECONDARY_ENDPOINT "$DSQL_SECONDARY_ENDPOINT"
upd DSQL_CLUSTER_ARN        "$DSQL_CLUSTER_ARN"
upd KMS_KEY_ID              "$KMS_KEY_ID"
rm -f .env.local.bak

# ---------------------------------------------------------------------------
# 4. Apply migration 001 (token-authed psql via migrate.ts).
# ---------------------------------------------------------------------------
say "4/8  Migrate schema (001_initial.sql)"
TOKEN=$(aws dsql generate-db-connect-admin-auth-token --hostname "$DSQL_PRIMARY_ENDPOINT" --region "$PRIMARY_REGION" --expires-in 3600)
DSQL_USER=admin DSQL_DATABASE=postgres DSQL_PASSWORD="$TOKEN" \
  npx tsx db/migrations/migrate.ts

# ---------------------------------------------------------------------------
# 5. Seed demo data (uses lib/db/connection.ts — needs the guard at step 0).
# ---------------------------------------------------------------------------
say "5/8  Seed demo data"
npx tsx db/seeds/demo-seed.ts

# ---------------------------------------------------------------------------
# 6. Verify connectivity (both regions).
# ---------------------------------------------------------------------------
say "6/8  Verify DSQL connectivity"
PGPASSWORD="$TOKEN" psql "host=$DSQL_PRIMARY_ENDPOINT port=5432 dbname=postgres user=admin sslmode=require" \
  -c "SELECT current_database(), (SELECT count(*) FROM users) AS users;"
TOKEN_W=$(aws dsql generate-db-connect-admin-auth-token --hostname "$DSQL_SECONDARY_ENDPOINT" --region "$SECONDARY_REGION" --expires-in 900)
PGPASSWORD="$TOKEN_W" psql "host=$DSQL_SECONDARY_ENDPOINT port=5432 dbname=postgres user=admin sslmode=require" \
  -c "SELECT 'secondary-ok' AS region;"

# ---------------------------------------------------------------------------
# 7. Push env to Vercel + deploy.
# ---------------------------------------------------------------------------
say "7/8  Vercel deploy"
vercel link --yes >/dev/null 2>&1 || true
push() { printf '%s' "$2" | vercel env add "$1" production --force >/dev/null 2>&1 || true; }
for k in DSQL_PRIMARY_ENDPOINT DSQL_SECONDARY_ENDPOINT DSQL_CLUSTER_ARN KMS_KEY_ID \
         NEXTAUTH_SECRET RECIPIENT_JWT_SECRET VERIFIER_JWT_SECRET CRON_SECRET TOTP_SECRET \
         OPENAI_API_KEY RESEND_API_KEY RESEND_FROM_ADDRESS; do push "$k" "${!k}"; done
echo "(Set DSQL_USE_SECONDARY=false and AWS auth — prefer Vercel's AWS OIDC for the role, see infra/iam-policy.json.)"
DEPLOY_URL=$(vercel deploy --prod --yes)
echo "deployed: $DEPLOY_URL"
push NEXTAUTH_URL "$DEPLOY_URL"; vercel deploy --prod --yes >/dev/null  # redeploy so NEXTAUTH_URL takes

# ---------------------------------------------------------------------------
# 8. Next steps.
# ---------------------------------------------------------------------------
say "8/8  DONE — manual finish"
cat <<NEXT
Live: $DEPLOY_URL
Now (you):
  1. Add TOTP_SECRET to your authenticator app (value is in .env.local).
  2. Run the dogfood: docs/e2e-verification.md (sign-in → crypto round-trip →
     release spine → recipient decrypt → audit). Risk A should just work.
  3. Multi-region failover demo: set DSQL_USE_SECONDARY=true in Vercel, redeploy,
     confirm reads still serve; reset to false.
  4. Capture the Aurora DSQL console storage screenshot; record the demo video.
  5. Devpost: paste specs/Relay_Devpost_Submission.md; verify links incognito.
Teardown when done (deletion-protected — disable first):
  aws dsql update-cluster --identifier <id> --no-deletion-protection-enabled --region $PRIMARY_REGION
  aws dsql delete-cluster --identifier <id> --region $PRIMARY_REGION   (×2 regions)
  aws kms schedule-key-deletion --key-id $KMS_KEY_ID --pending-window-in-days 7 --region $PRIMARY_REGION
NEXT
