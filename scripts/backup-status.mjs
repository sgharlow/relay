/**
 * Is relay's vault actually being backed up, and how stale is the newest copy?
 *
 * WHY THIS EXISTS. A backup plan is an unattended job whose success signal is a
 * side effect — a recovery point appearing in a vault. Nobody notices a side
 * effect that stops happening. This turns "backups are configured" (a claim
 * about intent) into "the newest recovery point is N hours old" (a fact).
 *
 * It earned its keep before it was even written: the plan's resource selection
 * was created pointing at a role ARN that does not exist, so the nightly job
 * would have failed every night while the console showed a healthy plan.
 *
 * Usage:
 *   node scripts/backup-status.mjs [profile]     # default profile: autospecai
 *
 * Exits non-zero if there is no recovery point, or the newest is older than the
 * staleness threshold — so it can be wired to a schedule later.
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { credentialsFromProfile, backup, dsql } from './aws-sig.mjs';

const PROFILE = process.argv[2] || 'autospecai';
// Kept for reference — the account these vaults live in. Underscored
// because nothing reads it; the lint config allows `^_` unused vars.
const _ACCOUNT = '461293170793';
const PRIMARY = { region: 'us-east-1', id: 'frt34buqso4inluojgnj6horuy', vault: 'relay-vault' };
const SECONDARY = { region: 'us-west-2', id: 'fjt34b2el5yoh7pvcm4knbkyvi', vault: 'relay-vault-dr' };

/** Daily schedule + a generous window for a slow job. Alert beyond this. */
const STALE_AFTER_HOURS = 30;

const creds = credentialsFromProfile(PROFILE);
const problems = [];

function hoursAgo(epochSeconds) {
  return (Date.now() / 1000 - epochSeconds) / 3600;
}

console.log('relay backup status\n');

// 1. The clusters are still there and still protected from deletion.
for (const c of [PRIMARY, SECONDARY]) {
  const res = await dsql(creds, c.region)(`/cluster/${c.id}`);
  const j = res.json || {};
  const ok = j.status === 'ACTIVE' && j.deletionProtectionEnabled === true;
  console.log(`cluster ${c.region.padEnd(10)} ${j.status || res.status} · deletionProtection=${j.deletionProtectionEnabled}`);
  if (!ok) problems.push(`cluster ${c.region} is ${j.status} with deletionProtection=${j.deletionProtectionEnabled}`);
}

// 2. Something is actually assigned to a plan. A plan with no selection backs
//    up nothing while looking entirely healthy.
const plans = await backup(creds, PRIMARY.region)('/backup/plans/');
const relayPlans = (plans.json?.BackupPlansList || []).filter((p) => /relay/i.test(p.BackupPlanName));
console.log(`\nbackup plans matching "relay": ${relayPlans.length ? relayPlans.map((p) => p.BackupPlanName).join(', ') : 'NONE'}`);
if (relayPlans.length === 0) problems.push('no backup plan covers relay');

for (const p of relayPlans) {
  const sel = await backup(creds, PRIMARY.region)(`/backup/plans/${p.BackupPlanId}/selections/`);
  const list = sel.json?.BackupSelectionsList || [];
  if (list.length === 0) problems.push(`plan ${p.BackupPlanName} has NO resource selection — it protects nothing`);
  for (const s of list) console.log(`  selection: ${s.SelectionName}`);
}

// 3. The fact that matters: how old is the newest recovery point.
for (const c of [PRIMARY, SECONDARY]) {
  const rp = await backup(creds, c.region)(`/backup-vaults/${c.vault}/recovery-points/`);
  if (rp.status !== 200) {
    console.log(`\n${c.vault} (${c.region}): HTTP ${rp.status}`);
    problems.push(`cannot read vault ${c.vault}`);
    continue;
  }
  const points = (rp.json.RecoveryPoints || []).filter((r) => r.Status === 'COMPLETED');
  if (points.length === 0) {
    console.log(`\n${c.vault} (${c.region}): NO COMPLETED RECOVERY POINTS`);
    problems.push(`vault ${c.vault} holds no completed recovery point`);
    continue;
  }
  points.sort((a, b) => b.CompletionDate - a.CompletionDate);
  const newest = points[0];
  const age = hoursAgo(newest.CompletionDate);
  console.log(`\n${c.vault} (${c.region}): ${points.length} recovery point(s), newest ${age.toFixed(1)}h old, ${newest.BackupSizeInBytes} bytes`);
  if (age > STALE_AFTER_HOURS) {
    problems.push(`newest recovery point in ${c.vault} is ${age.toFixed(1)}h old (threshold ${STALE_AFTER_HOURS}h)`);
  }
}

if (problems.length === 0) {
  console.log('\nOK — relay is backed up and the newest copy is fresh.');
} else {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  •', p);
  console.log('\nRunbook: docs/backup-restore-runbook.md');
  process.exitCode = 1;
}
