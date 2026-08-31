/**
 * The D3 restore drill — pre-flight now, spend later.
 *
 * `gates.d3-restore-drill` (due 2026-11-08) has four criteria. Three of them can
 * be settled read-only, before anybody creates a cluster, and this settles them.
 * The fourth — restoring to a scratch cluster — costs money and is an
 * infrastructure action, so it is PRINTED with its ARNs and traps rather than
 * performed.
 *
 *   npm run drill:preflight     # read-only. 0 = ready · 1 = a finding · 2 = could not look
 *   npm run drill:plan          # prints the spend phases and writes the throwaway env template
 *
 * 🔴 WHY THE 2026-08-08 DRILL DOES NOT COUNT, in the gate's own words: it
 * "restored a database and never unwrapped an item, so it proved a database
 * restore rather than a recovery". A restored cluster is ciphertext without the
 * key. Criterion 3 is the whole point and is the one that gets skipped for time.
 *
 * ⚠️ LADDER, stated so a green run is not read as wider than it is.
 * `preflight` is live-proven — every check below ran read-only against real AWS
 * and the real cluster on 2026-08-31. `plan` is `built`: it prints and writes,
 * and NOTHING here has ever created or deleted a cluster. That is deliberate.
 * Untested automation on the one procedure whose failure mode is "the data is
 * gone and the tool for getting it back has a bug" is worse than a checklist.
 *
 * Feature: relay-h0-mvp
 * Requirements: D3.0-D3.4
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { query } from '../lib/db/connection';
import {
  CLUSTERS,
  BACKUP_ROLE_ARN,
  preflight,
  decryptMargin,
  scratchEnv,
  type RecoveryPoint,
} from '../lib/ops/restore-drill';
/*
  aws-sig is plain ESM JS shared with the .mjs scripts — ONE signer, not two.
  Its inferred return is `{status, json}` with `json` widened to `{}`, so the
  shapes this script actually reads are declared below rather than asserted at
  each use. Declaring them here means a change in the AWS response shape shows up
  as a type error in one place instead of as `undefined` at runtime.
*/
import { credentialsFromProfile, backup, dsql } from './aws-sig.mjs';

interface AwsResponse<T> {
  status: number;
  json?: T;
}
type Caller<T> = (path: string, opts?: Record<string, unknown>) => Promise<AwsResponse<T>>;

interface DsqlCluster {
  status?: string;
  deletionProtectionEnabled?: boolean;
}
interface BackupRecoveryPoints {
  RecoveryPoints?: { CreationDate?: number; BackupSizeInBytes?: number }[];
}

const PROFILE = process.env.AWS_PROFILE ?? 'autospecai';
const MODE = process.argv.includes('plan') ? 'plan' : 'preflight';
const SCRATCH_ENV_PATH = '.drill-scratch/.env.scratch';

function cannotLook(msg: string): never {
  console.error(`\n  COULD NOT LOOK: ${msg}`);
  process.exit(2);
}

interface ClusterState {
  active: boolean;
  protected: boolean;
  status: string;
}

async function clusterState(region: string, id: string): Promise<ClusterState> {
  const api = dsql(credentialsFromProfile(PROFILE), region) as Caller<DsqlCluster>;
  const r = await api(`/cluster/${id}`);
  const status = String(r.json?.status ?? 'UNKNOWN');
  return {
    active: status === 'ACTIVE',
    protected: r.json?.deletionProtectionEnabled === true,
    status,
  };
}

async function recoveryPoints(region: string, vault: string): Promise<RecoveryPoint> {
  const api = backup(credentialsFromProfile(PROFILE), region) as Caller<BackupRecoveryPoints>;
  const r = await api(`/backup-vaults/${vault}/recovery-points`);
  const pts = r.json?.RecoveryPoints ?? [];
  if (pts.length === 0) return { vault, ageHours: Infinity, bytes: 0, count: 0 };
  const newest = pts.reduce((a, b) => ((a.CreationDate ?? 0) > (b.CreationDate ?? 0) ? a : b));
  return {
    vault,
    ageHours: (Date.now() / 1000 - (newest.CreationDate ?? 0)) / 3600,
    bytes: Number(newest.BackupSizeInBytes ?? 0),
    count: pts.length,
  };
}

/** Reuse `verify:kms` rather than re-implementing the key wall in a second place. */
function kmsHolds(): boolean {
  try {
    execFileSync('npx', ['tsx', '--env-file=.env.admin', 'scripts/verify-kms.ts'], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}

/** Criterion 3's precondition: a REAL item, not a demo one, that could be unwrapped. */
async function decryptableRealItems(): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM vault_items v
       JOIN users u ON u.id = v.owner_id
      WHERE COALESCE(u.is_demo_account, false) = false
        AND u.email NOT LIKE '%.test'
        AND u.email NOT LIKE '%.invalid'
        AND u.email NOT LIKE '%.localhost'
        AND v.ciphertext IS NOT NULL
        AND v.wrapped_data_key IS NOT NULL`,
  );
  return Number(r.rows[0].n);
}

function readEnvLocal(): Record<string, string> {
  if (!existsSync('.env.local')) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function printPlan(): void {
  console.log('\n  THE SPEND PHASES — printed, not performed\n');
  console.log('  🔴 Three traps, carried from docs/backup-restore-runbook.md:\n');
  console.log('    1. The AWS CLI does not work on this workstation. Norton intercepts TLS and the');
  console.log('       CLI (Python) fails certificate verification against every AWS endpoint. Do NOT');
  console.log('       disable certificate validation on the tooling that administers the customer');
  console.log('       database. scripts/aws-sig.mjs signs from Node, whose TLS stack is unaffected.\n');
  console.log('    2. The backup role ARN contains DOUBLE SLASHES. Copy it verbatim:');
  console.log(`         ${BACKUP_ROLE_ARN}`);
  console.log('       Pass the well-formed ARN and AWS Backup answers "IAM Role does not have');
  console.log('       sufficient permissions" — a permission that is already granted. The role does');
  console.log('       not exist at the path you typed.\n');
  console.log('    3. An on-demand backup does NOT run the plan\'s copy action. A DR vault that looks');
  console.log('       empty right after a manual backup is expected, not broken.\n');
  console.log('  Phase 1 — a fresh backup (cheap, non-destructive):');
  console.log('      node scripts/backup-now.mjs\n');
  console.log('  Phase 2 — restore to a SCRATCH cluster  ⚠️ THIS IS THE SPEND. Steve approves.');
  console.log('      Runbook steps 1-5. Start the clock HERE — criterion 4 wants the RTO');
  console.log('      actually OBSERVED, not estimated.\n');
  console.log('  Phase 3 — one REAL item through the product\'s own reveal path:');
  console.log(`      The throwaway env is written to ${SCRATCH_ENV_PATH} by this command.`);
  console.log('      Fill in DSQL_PRIMARY_ENDPOINT with the scratch endpoint, then:');
  console.log(`      npx next build && npx next start -p 3117   # with --env-file=${SCRATCH_ENV_PATH}`);
  console.log('      🔴 NEVER edit .env.local. It points at production and is the only copy.\n');
  console.log('  Phase 4 — stop the clock, tear down, re-confirm:');
  console.log('      Record the observed RTO · delete the scratch cluster · re-run');
  console.log('      `npm run drill:preflight` and confirm both production clusters are still');
  console.log('      ACTIVE with deletion protection on.\n');
  console.log('  Then: record `met:` on gates.d3-restore-drill with the observed RTO.\n');
}

async function main(): Promise<number> {
  console.log(`  D3 restore drill — ${MODE} (profile ${PROFILE})\n`);

  let primary: ClusterState;
  let secondary: ClusterState;
  let points: RecoveryPoint[];
  try {
    // Four reads, one round trip. Destructured explicitly rather than with a
    // rest element: the tuple is heterogeneous, and `as never` to force it was
    // how the first version of this hid a real type error from itself.
    const [p, sec, rpPrimary, rpSecondary] = await Promise.all([
      clusterState(CLUSTERS.primary.region, CLUSTERS.primary.id),
      clusterState(CLUSTERS.secondary.region, CLUSTERS.secondary.id),
      recoveryPoints(CLUSTERS.primary.region, CLUSTERS.primary.vault),
      recoveryPoints(CLUSTERS.secondary.region, CLUSTERS.secondary.vault),
    ]);
    primary = p;
    secondary = sec;
    points = [rpPrimary, rpSecondary];
  } catch (err) {
    cannotLook(
      `AWS read failed: ${String(err)}\n    Profile "${PROFILE}" must exist in ~/.aws/credentials. ` +
        'Note trap 1: the AWS CLI is broken on this workstation, but this script signs from Node.',
    );
  }

  let items: number;
  try {
    items = await decryptableRealItems();
  } catch (err) {
    cannotLook(`database read failed: ${String(err)}. Run with --env-file=.env.ro.`);
  }

  const kms = kmsHolds();

  console.log(`    ${CLUSTERS.primary.region}   ${primary!.status} · deletionProtection=${primary!.protected}`);
  console.log(`    ${CLUSTERS.secondary.region}   ${secondary!.status} · deletionProtection=${secondary!.protected}`);
  for (const p of points!) {
    console.log(
      `    ${p.vault.padEnd(16)} ${p.count} recovery point(s), newest ${p.ageHours.toFixed(1)}h old, ${p.bytes} bytes`,
    );
  }
  console.log(`    verify:kms       ${kms ? 'holds' : 'DOES NOT HOLD'}`);
  console.log(`    real decryptable items  ${items!}  (margin: ${decryptMargin(items!)})`);

  const findings = preflight({
    primaryActive: primary!.active,
    primaryProtected: primary!.protected,
    secondaryActive: secondary!.active,
    secondaryProtected: secondary!.protected,
    points: points!,
    kmsHolds: kms,
    decryptableRealItems: items!,
  });

  if (findings.length > 0) {
    console.error('\n  NOT READY — the drill would not prove what it is for:\n');
    for (const f of findings) console.error(`    criterion ${f.criterion}\n      ${f.detail}\n`);
    return 1;
  }

  console.log('\n  READY — criteria 2 and 3 are satisfied and criterion 4\'s end state already holds.');
  if (decryptMargin(items!) === 'thin') {
    console.log(
      '\n  ⚠️ ONE decryptable real item, so the drill has NO SECOND ATTEMPT. If that item fails to\n' +
        '     unwrap from the scratch endpoint there is nothing to distinguish "the restore lost it"\n' +
        '     from "this item was always broken". Worth knowing before starting, not during.',
    );
  }

  if (MODE === 'plan') {
    mkdirSync('.drill-scratch', { recursive: true });
    writeFileSync(
      SCRATCH_ENV_PATH,
      scratchEnv({ scratchEndpoint: '<FILL IN: the scratch cluster endpoint>', fromEnvLocal: readEnvLocal() }),
    );
    console.log(`\n  wrote ${SCRATCH_ENV_PATH} (gitignored; the production endpoint is NOT in it)`);
    printPlan();
  } else {
    console.log('\n  Run `npm run drill:plan` for the spend phases, their ARNs and the three traps.');
  }
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`\n  COULD NOT LOOK: ${String(e)}`);
    process.exit(2);
  },
);
