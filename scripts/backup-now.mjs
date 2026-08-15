/**
 * scripts/backup-now.mjs — take an on-demand backup and wait for it to finish.
 *
 *   node scripts/backup-now.mjs            # profile defaults to autospecai
 *
 * WHY THIS EXISTS. The Infrastructure Change Policy requires a backup taken
 * BEFORE a change begins, and until now there was no way to take one from this
 * repo — `backup-status.mjs` only reports on what the nightly plan already did.
 * "Take a snapshot first" that nobody has tooling for is a policy people meet by
 * hoping the scheduled job ran recently enough, which is not the same thing.
 *
 * It WAITS rather than firing and returning. A backup job that was accepted is
 * not a backup that exists; the whole point of running one before a change is
 * to know it completed before you start. Exits non-zero if it does not.
 *
 * ⚠️ TWO DOCUMENTED TRAPS, both from docs/backup-restore-runbook.md:
 *
 *   1. The service role ARN really does contain DOUBLE SLASHES
 *      (`role//service-role//AWSBackupDefaultServiceRole`) — its IAM path is
 *      literally `//service-role//`, almost certainly an MSYS path-mangling
 *      accident at creation. Normalising it to the well-formed ARN gets
 *      "IAM Role does not have sufficient permissions", which sends you hunting
 *      for a permission that was never missing. Copied verbatim below.
 *
 *   2. An on-demand backup does NOT run the plan's copy action, so only the
 *      primary vault is populated. A DR vault that looks untouched right after
 *      this is expected, not broken.
 *
 * Feature: relay-h0-mvp
 */

import { readFileSync } from 'fs';
import { credentialsFromProfile, backup } from './aws-sig.mjs';

const PROFILE = process.argv[2] ?? 'autospecai';
const REGION = 'us-east-1';
const VAULT = 'relay-vault';
const ROLE_ARN = 'arn:aws:iam::461293170793:role//service-role//AWSBackupDefaultServiceRole';
const POLL_MS = 15_000;
const TIMEOUT_MS = 15 * 60 * 1000;

function clusterArn() {
  const line = readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DSQL_CLUSTER_ARN='));
  if (!line) throw new Error('DSQL_CLUSTER_ARN is not set in .env.local');
  return line.slice('DSQL_CLUSTER_ARN='.length).replace(/^["']|["']$/g, '').trim();
}

const creds = credentialsFromProfile(PROFILE);
const api = backup(creds, REGION);
const resourceArn = clusterArn();

console.log(`[backup] vault=${VAULT} region=${REGION} profile=${PROFILE}`);
console.log(`[backup] resource=${resourceArn}`);

const start = await api('/backup-jobs', {
  method: 'PUT',
  body: { BackupVaultName: VAULT, ResourceArn: resourceArn, IamRoleArn: ROLE_ARN },
});

if (start.status !== 200) {
  console.error(`[backup] FAILED to start (${start.status}):`, start.text ?? JSON.stringify(start.json));
  process.exit(1);
}

const jobId = start.json?.BackupJobId;
console.log(`[backup] started job ${jobId} — waiting for completion...`);

const deadline = Date.now() + TIMEOUT_MS;
for (;;) {
  await new Promise((r) => setTimeout(r, POLL_MS));

  const job = await api(`/backup-jobs/${jobId}`);
  const state = job.json?.State ?? `(status ${job.status})`;

  if (state === 'COMPLETED') {
    const bytes = job.json?.BackupSizeInBytes;
    console.log(`[backup] ✓ COMPLETED — ${bytes} bytes`);
    console.log(`[backup] recovery point: ${job.json?.RecoveryPointArn}`);
    console.log('[backup] note: on-demand runs populate the PRIMARY vault only.');
    process.exit(0);
  }

  if (['ABORTED', 'FAILED', 'EXPIRED'].includes(state)) {
    console.error(`[backup] ✗ ${state} — ${job.json?.StatusMessage ?? 'no message'}`);
    process.exit(1);
  }

  if (Date.now() > deadline) {
    // Not "probably fine". An unfinished backup is not a backup.
    console.error(`[backup] ✗ still ${state} after ${TIMEOUT_MS / 60000} min — not waiting further.`);
    process.exit(1);
  }

  console.log(`[backup]   ${state}...`);
}
