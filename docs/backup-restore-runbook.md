# Backup and restore — relay

> Established 2026-08-08. **Before this date relay had no backups of any kind.**
> Not thin ones — none. Both DSQL clusters were unprotected, and the only thing
> being backed up anywhere in AWS account `461293170793` was an unrelated EC2
> instance belonging to learningai.

## Why this was missed for so long

Aurora DSQL backups are **opt-in**. Unlike RDS and provisioned Aurora, which
take automated backups by default, DSQL protects nothing until an AWS Backup
plan and resource assignment exist ([AWS docs](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html)).

The architecture actively disguised the gap. Relay runs multi-Region
active-active across us-east-1 and us-west-2 with a witness in us-east-2, which
reads like redundancy and *is* redundancy — against a Region failing. But both
Regions are one logical cluster. A `DELETE` replicates to the peer in
milliseconds. It defended against the one failure mode that was never very
likely and none of the ones that actually destroy data: a bad migration, a bug
in a cascade delete, application-level corruption, or a compromised credential.
`deletionProtectionEnabled: true` protects the *cluster*, not the rows in it.

## What exists now

| Thing | Value |
|---|---|
| Plan | `relay-dsql-daily` (`128cc2a6-c44f-4d17-927e-0a637c910306`) |
| Schedule | daily, `cron(0 5 * * ? *)` — 05:00 UTC |
| Retention | 35 days |
| Primary vault | `relay-vault` (us-east-1) |
| DR vault | `relay-vault-dr` (us-west-2), populated by the rule's copy action |
| Selection | `relay-dsql-clusters` — names the cluster ARN explicitly |
| Protected | `arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy` |

The selection names the ARN rather than matching a tag. A tag-based rule
silently protects nothing the moment the tag is dropped, and this is the one
thing that must not fail quietly.

**RPO: up to 24 hours.** Backups are full, not incremental, and DSQL supports
whole-cluster granularity only — there is no table-level or point-in-time
restore here.

**RTO: minutes to restore, plus a redeploy.** Measured 2026-08-08: the backup
job took ~2.5 min for 494 KB; the restore took ~3 min. The redeploy is the part
people forget — see step 4 below.

## Three traps, all of which cost time on the day this was built

1. **The AWS CLI does not work on the Windows workstation.** Norton intercepts
   TLS and the CLI (Python) fails certificate verification against every AWS
   endpoint. Do not "fix" this by disabling certificate validation on the tooling
   that administers the customer database. `scripts/aws-sig.mjs` signs the same
   requests from Node, whose TLS stack is unaffected.

2. **The backup role's ARN contains DOUBLE SLASHES.**
   `arn:aws:iam::461293170793:role//service-role//AWSBackupDefaultServiceRole` —
   its IAM path is literally `//service-role//`, almost certainly MSYS path
   mangling at creation time (see the portfolio note on MSYS breaking IAM). Pass
   the well-formed ARN and AWS Backup answers **"IAM Role does not have
   sufficient permissions"**, which sends you hunting through policy documents
   for a permission that is already there. The role does not exist at the path
   you typed. **Copy the ARN above verbatim.**

3. **On-demand backups do NOT run the plan's copy action.** Starting a backup by
   hand populates the primary vault only; the DR copy happens on the scheduled
   run, or from an explicit copy job. A DR vault that looks empty right after a
   manual backup is expected, not broken.

## Checking it is working

```bash
node scripts/backup-status.mjs          # profile defaults to autospecai
```

Reports cluster health, that a plan with a real selection exists, and — the fact
that actually matters — how old the newest completed recovery point is in each
vault. Exits non-zero if there is no recovery point or the newest is over 30h
old, so it can be put on a schedule.

This is deliberately a check for the ABSENCE of a signal. A backup plan is an
unattended job whose success is a side effect, and nobody notices a side effect
that stops happening. It earned that framing immediately: the plan's first
selection was created pointing at the malformed role ARN, so the nightly job
would have failed every night while the console showed a healthy plan.

## Restoring

**AWS Backup always restores to a NEW cluster. It never overwrites the source**,
so a restore is safe to perform even while production is running.

1. **Find the recovery point.**
   ```bash
   node scripts/backup-status.mjs     # lists count and age per vault
   ```

2. **Start the restore.** Single-Region, deletion protection ON for anything you
   intend to keep (use `false` only for a throwaway verification cluster):
   ```js
   PUT /restore-jobs
   {
     "RecoveryPointArn": "<from step 1>",
     "IamRoleArn": "arn:aws:iam::461293170793:role//service-role//AWSBackupDefaultServiceRole",
     "ResourceType": "DSQL",
     "Metadata": { "regionalConfig": "[{\"region\":\"us-east-1\",\"isDeletionProtectionEnabled\":true}]" }
   }
   ```
   Poll `GET /restore-jobs/{id}` until `COMPLETED`; it returns
   `CreatedResourceArn`, the new cluster.

3. **Verify before cutting over.** Row counts against the old cluster if it is
   still readable, and specifically that `vault_items` rows still carry both
   `ciphertext` and `wrapped_data_key` — matching row counts prove nothing about
   whether the encrypted payloads survived.

4. **Repoint the application. This is the step that is easy to forget.** The
   restored cluster has a NEW endpoint, so a successful restore changes nothing
   until:
   - `DSQL_PRIMARY_ENDPOINT` is updated in Vercel production, and
   - the app is redeployed so the running instance picks it up.

   Until both happen the app is still talking to the old cluster.

5. **Re-establish multi-Region** if the restore was single-Region. A restored
   single-Region cluster has no peer and no witness; relay's failover story
   assumes both. Multi-Region restore is possible directly — it needs an
   identical copy of the recovery point in the peer Region (which the DR vault
   provides) plus `witnessRegion` and `peerRegion` metadata. See the
   [AWS restore guide](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-auroradsql.html).

## Proven, not assumed (2026-08-08)

The whole path was executed end to end, not reasoned about:

- On-demand backup of the production cluster → **COMPLETED**, 494,356 bytes.
- Restore to a scratch cluster (`kvt7sotysmekbsesjnbns2i53e`) → **COMPLETED**.
- **Every table matched production exactly**: users 2, vault_items 31,
  recipients 2, access_rules 4, release_state 2, audit_log 15, subscriptions 1,
  caregiver_leads 0.
- The paying subscriber's row survived intact, `stripe_customer_id` included.
- All 31 vault items retained both `ciphertext` and `wrapped_data_key` — the
  crypto came back, not just the row count.
- Scratch cluster deleted; both production clusters confirmed `ACTIVE` with
  deletion protection still on, before and after.
- Cross-Region copy to `relay-vault-dr` → **COMPLETED**, identical 494,356 bytes.

## Alerting

Two layers, because they catch different failures. Both publish to the existing
`NotifyMe` SNS topic in us-east-1, which already had a **confirmed** email
subscription — so no new credential was created and nothing needs confirming.

**1. Job failure → vault notifications.** `relay-vault` notifies on
`BACKUP_JOB_FAILED`, `COPY_JOB_FAILED` and `RESTORE_JOB_FAILED`. Catches the
common case: a permission change, a broken role, a copy that cannot reach the DR
Region.

⚠️ **The topic policy did not permit `backup.amazonaws.com` to publish.** AWS
accepted the notification configuration with a 200 anyway, and it would have
delivered precisely nothing. The grant was **appended** to the existing policy —
that topic already serves other alerting, and replacing it would have silently
broken whatever else publishes there.

**2. Backups going quiet → CloudWatch alarm `relay-backup-absent`.** Ten
consecutive 3-hour windows with no completed backup job — 30 hours, matching the
threshold in `backup-status.mjs`. `TreatMissingData: breaching`, because the
failure being watched for IS the metric going quiet; treating absence as healthy
would defeat the whole alarm. This is the layer that catches a plan that stops
scheduling, which produces no failure event at all.

**Both were proven to reach a human**, not merely configured: the alarm was
forced into `ALARM` deliberately and then reset to `OK`. Given that the SNS
policy gap above meant "configured" and "delivers" were demonstrably different
things here, firing it once was the only honest verification.

## Still open

- The first **scheduled** run has not happened yet (05:00 UTC). Everything above
  was proven with on-demand jobs. Confirm the schedule fires before trusting it —
  and note the alarm will not have enough history to evaluate until it does.
- `backup-status.mjs` still has to be run by hand. The two alerts above cover
  failure and silence; the script remains the way to answer "how stale is it
  right now?" on demand.
