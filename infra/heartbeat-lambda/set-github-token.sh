#!/usr/bin/env bash
# Store the heartbeat's GitHub token from the CLIPBOARD into Secrets Manager, so the token is never
# typed, echoed, or kept in shell history. Copy the token on GitHub's page, then run:
#   bash infra/heartbeat-lambda/set-github-token.sh
# Refuses anything that is not a fine-grained token, and clears the clipboard afterwards.
set -euo pipefail
SECRET_ID=relay/heartbeat/github-pat
AWSP="--profile ${AWS_PROFILE:-autospecai} --region us-east-1"

tok=$(powershell.exe -NoProfile -Command Get-Clipboard | tr -d '\r\n')
if [[ ! "$tok" =~ ^github_pat_[A-Za-z0-9_]{50,}$ ]]; then
  echo "refused: the clipboard does not hold a fine-grained GitHub token (github_pat_...)."
  echo "Copy the token on GitHub's page, then run this again without copying anything else."
  exit 1
fi

if aws secretsmanager describe-secret --secret-id "$SECRET_ID" $AWSP >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$tok" $AWSP --query VersionId --output text >/dev/null
else
  aws secretsmanager create-secret --name "$SECRET_ID" --secret-string "$tok" $AWSP --query ARN --output text >/dev/null
fi
powershell.exe -NoProfile -Command "Set-Clipboard -Value ' '"
echo "stored: fine-grained token, ${#tok} chars, in $SECRET_ID (clipboard cleared)"
