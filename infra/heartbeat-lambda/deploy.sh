#!/usr/bin/env bash
# Create-or-update the cloud heartbeat (B12.i): S3 state bucket, SNS alert topic,
# IAM roles, the Lambda, and the 15-minute EventBridge schedule. Safe to re-run.
#
#   AWS_PROFILE=autospecai bash infra/heartbeat-lambda/deploy.sh
#
# Needs, made by hand once (the token never passes through this script):
#   secret  relay/heartbeat/github-pat   fine-grained PAT, sgharlow/relay only, Actions read+write
# The alert address must confirm the SNS subscription email before any alert arrives.
#
# Rollback: `bash infra/heartbeat-lambda/deploy.sh --disable` turns the schedule off
# (re-enable the VICTUS tasks relay-heartbeat + relay-canary-dispatch if they were removed).
set -euo pipefail
cd "$(dirname "$0")"

REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[ "$ACCOUNT" = "461293170793" ] || { echo "refusing: account $ACCOUNT is not relay's 461293170793"; exit 1; }

FN=relay-heartbeat
BUCKET=relay-heartbeat-state-$ACCOUNT
TOPIC_NAME=relay-heartbeat-alerts
ALERT_EMAIL=${ALERT_EMAIL:-sgharlow@gmail.com}
SECRET_ID=relay/heartbeat/github-pat
LAMBDA_ROLE=relay-heartbeat-lambda
SCHED_ROLE=relay-heartbeat-scheduler
SCHEDULE=relay-heartbeat-15min
AWSR="--region $REGION"

if [ "${1:-}" = "--disable" ]; then
  aws scheduler update-schedule $AWSR --name $SCHEDULE --state DISABLED \
    --schedule-expression "cron(0/15 * * * ? *)" --flexible-time-window Mode=OFF \
    --target "$(aws scheduler get-schedule $AWSR --name $SCHEDULE --query Target --output json)"
  echo "schedule $SCHEDULE DISABLED"; exit 0
fi

echo "== bundle"
npm ci --silent
npm run --silent typecheck
npm run --silent build
python -c "import zipfile; z=zipfile.ZipFile('dist/heartbeat.zip','w',zipfile.ZIP_DEFLATED); z.write('dist/index.mjs','index.mjs'); z.close()"

echo "== state bucket $BUCKET"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" $AWSR >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "== alert topic"
TOPIC_ARN=$(aws sns create-topic $AWSR --name $TOPIC_NAME --query TopicArn --output text)
if ! aws sns list-subscriptions-by-topic $AWSR --topic-arn "$TOPIC_ARN" --query 'Subscriptions[].Endpoint' --output text | grep -qx "$ALERT_EMAIL"; then
  aws sns subscribe $AWSR --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
  echo "   subscription email sent to $ALERT_EMAIL — it must be CONFIRMED before alerts arrive"
fi

echo "== lambda role"
if ! aws iam get-role --role-name $LAMBDA_ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $LAMBDA_ROLE --assume-role-policy-document file://trust-lambda.json >/dev/null
  aws iam attach-role-policy --role-name $LAMBDA_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
fi
sed -e "s|__BUCKET__|$BUCKET|g" -e "s|__TOPIC__|$TOPIC_ARN|g" \
    -e "s|__SECRET__|arn:aws:secretsmanager:$REGION:$ACCOUNT:secret:$SECRET_ID-*|g" policy-lambda.json > dist/policy-lambda.json
aws iam put-role-policy --role-name $LAMBDA_ROLE --policy-name heartbeat --policy-document file://dist/policy-lambda.json
LAMBDA_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$LAMBDA_ROLE

ENVV="Variables={STATE_BUCKET=$BUCKET,ALERT_TOPIC_ARN=$TOPIC_ARN,GITHUB_TOKEN_SECRET_ID=$SECRET_ID,CANARY_BASE_URL=https://relaystandby.com,HEARTBEAT_REPO=sgharlow/relay}"
echo "== function $FN"
if aws lambda get-function $AWSR --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code $AWSR --function-name $FN --zip-file fileb://dist/heartbeat.zip --query CodeSha256 --output text
  aws lambda wait function-updated-v2 $AWSR --function-name $FN
  aws lambda update-function-configuration $AWSR --function-name $FN --environment "$ENVV" --timeout 300 --memory-size 256 >/dev/null
else
  # A just-created role can take a few seconds to become assumable by Lambda.
  for i in 1 2 3 4 5 6; do
    aws lambda create-function $AWSR --function-name $FN --runtime nodejs22.x --handler index.handler \
      --role "$LAMBDA_ROLE_ARN" --zip-file fileb://dist/heartbeat.zip --timeout 300 --memory-size 256 \
      --environment "$ENVV" --query CodeSha256 --output text && break
    echo "   role not assumable yet, retry $i"; sleep 10
  done
fi
aws lambda wait function-active-v2 $AWSR --function-name $FN
aws lambda wait function-updated-v2 $AWSR --function-name $FN
# A retried async invoke would dispatch the workflows twice.
aws lambda put-function-event-invoke-config $AWSR --function-name $FN --maximum-retry-attempts 0 >/dev/null
aws logs create-log-group $AWSR --log-group-name /aws/lambda/$FN 2>/dev/null || true
aws logs put-retention-policy $AWSR --log-group-name /aws/lambda/$FN --retention-in-days 30
FN_ARN=$(aws lambda get-function $AWSR --function-name $FN --query Configuration.FunctionArn --output text)

echo "== scheduler role + schedule"
if ! aws iam get-role --role-name $SCHED_ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $SCHED_ROLE --assume-role-policy-document file://trust-scheduler.json >/dev/null
  sleep 10
fi
sed -e "s|__FUNCTION__|$FN_ARN|g" policy-scheduler.json > dist/policy-scheduler.json
aws iam put-role-policy --role-name $SCHED_ROLE --policy-name invoke --policy-document file://dist/policy-scheduler.json
TARGET="{\"Arn\":\"$FN_ARN\",\"RoleArn\":\"arn:aws:iam::$ACCOUNT:role/$SCHED_ROLE\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0}}"
if aws scheduler get-schedule $AWSR --name $SCHEDULE >/dev/null 2>&1; then
  aws scheduler update-schedule $AWSR --name $SCHEDULE --schedule-expression "cron(0/15 * * * ? *)" \
    --schedule-expression-timezone UTC --flexible-time-window Mode=OFF --state ENABLED --target "$TARGET" >/dev/null
else
  aws scheduler create-schedule $AWSR --name $SCHEDULE --schedule-expression "cron(0/15 * * * ? *)" \
    --schedule-expression-timezone UTC --flexible-time-window Mode=OFF --state ENABLED --target "$TARGET" >/dev/null
fi
echo "done: $FN every 15 min (UTC :00/:15/:30/:45), alerts -> $TOPIC_ARN"
