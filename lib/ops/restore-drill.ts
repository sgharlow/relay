/**
 * The restore drill, as something checkable rather than a page to re-read.
 *
 * `gates.d3-restore-drill` is due 2026-11-08 and is an OBLIGATION, not a bet —
 * its own `kill:` says so: *"it does not get killed; it gets done or it goes past
 * due, loudly"*. Its four criteria are precise, and three of them can be settled
 * before anybody spends a penny. This module holds that judgement so the drill
 * begins from verified ground instead of from an evening of runbook archaeology.
 *
 * 🔴 WHY THE LAST DRILL DOES NOT COUNT, in the gate's own words: the 2026-08-08
 * run "restored a database and never unwrapped an item, so it proved a database
 * restore rather than a recovery". A restored cluster is ciphertext without the
 * key. That is the whole reason criterion 3 exists and why it is the one that
 * cannot be skipped for time on the day.
 *
 * ⚠️ WHAT IS AND IS NOT PROVEN HERE, said plainly because this file is about a
 * procedure that has to work when it matters:
 *
 *   `preflight`  — live-proven. Every check runs read-only against real AWS and
 *                  the real cluster, and was run on 2026-08-31.
 *   `plan`       — built. It PRINTS the spend phases with their ARNs and traps;
 *                  it does not perform them. Nothing here has created or deleted
 *                  a cluster, and no test can prove that path without spending.
 *
 * A harness that pretended to automate the restore would be worse than a
 * checklist: it would be untested automation on the one procedure whose failure
 * mode is "the data is gone and the tool for getting it back has a bug".
 *
 * Feature: relay-h0-mvp
 * Requirements: D3.0-D3.4
 */

/** The two production clusters, as `scripts/backup-status.mjs` names them. */
export const CLUSTERS = {
  primary: { region: 'us-east-1', id: 'frt34buqso4inluojgnj6horuy', vault: 'relay-vault' },
  secondary: { region: 'us-west-2', id: 'fjt34b2el5yoh7pvcm4knbkyvi', vault: 'relay-vault-dr' },
} as const;

/**
 * 🔴 TRAP 2 FROM THE RUNBOOK, kept here because it is the one that costs an hour.
 *
 * The IAM path is literally `//service-role//`. Pass the well-formed ARN and AWS
 * Backup answers *"IAM Role does not have sufficient permissions"* — which sends
 * you hunting through policy documents for a permission that is already granted.
 * The role does not exist at the path you typed. Copy this verbatim.
 */
export const BACKUP_ROLE_ARN =
  'arn:aws:iam::461293170793:role//service-role//AWSBackupDefaultServiceRole';

/** Backups older than this are stale enough that the drill should not start. */
export const STALE_AFTER_HOURS = 30;

export interface RecoveryPoint {
  vault: string;
  ageHours: number;
  bytes: number;
  count: number;
}

export interface PreflightInput {
  primaryActive: boolean;
  primaryProtected: boolean;
  secondaryActive: boolean;
  secondaryProtected: boolean;
  points: RecoveryPoint[];
  kmsHolds: boolean;
  decryptableRealItems: number;
}

export interface Finding {
  criterion: string;
  detail: string;
}

/**
 * Can the drill start, and would it prove anything if it did?
 *
 * Returns findings rather than throwing: the caller decides whether a finding is
 * a refusal (it is) or something to print and continue past (it is not).
 */
export function preflight(i: PreflightInput): Finding[] {
  const out: Finding[] = [];

  if (!i.primaryActive || !i.secondaryActive) {
    out.push({
      criterion: '4 — production clusters',
      detail:
        `primary ACTIVE=${i.primaryActive}, secondary ACTIVE=${i.secondaryActive}. Criterion 4 ` +
        'ends by confirming both are still ACTIVE; starting from a state that already fails it ' +
        'means the drill cannot distinguish its own damage from what it inherited.',
    });
  }

  if (!i.primaryProtected || !i.secondaryProtected) {
    out.push({
      criterion: '4 — deletion protection',
      detail:
        `primary protected=${i.primaryProtected}, secondary protected=${i.secondaryProtected}. ` +
        'The drill deletes a cluster by design. Doing that beside an unprotected production ' +
        'cluster is one mistyped identifier away from the incident this drill exists to rehearse.',
    });
  }

  if (i.points.length === 0) {
    out.push({
      criterion: '1 — a backup to restore',
      detail: 'no recovery points found in either vault. There is nothing to restore FROM.',
    });
  }
  for (const p of i.points) {
    if (p.count === 0) {
      out.push({ criterion: '1 — a backup to restore', detail: `${p.vault} holds no recovery points` });
      continue;
    }
    if (p.ageHours > STALE_AFTER_HOURS) {
      out.push({
        criterion: '1 — a backup to restore',
        detail:
          `${p.vault}'s newest recovery point is ${p.ageHours.toFixed(1)}h old (stale after ` +
          `${STALE_AFTER_HOURS}h). The drill takes a fresh backup first, but a stale vault means ` +
          'the SCHEDULE has stopped, which is a finding of its own and should not be discovered ' +
          'halfway through a restore.',
      });
    }
  }

  if (!i.kmsHolds) {
    out.push({
      criterion: '2 — the key',
      detail:
        '`npm run verify:kms` does not hold. A restored cluster is ciphertext without the key, so ' +
        'this criterion is not paperwork — it is the difference between a recovery and a database ' +
        'restore. ⚠️ A key PENDING DELETION still decrypts, which is why this is checked rather ' +
        'than assumed from the product working.',
    });
  }

  if (i.decryptableRealItems < 1) {
    out.push({
      criterion: '3 — one real item',
      detail:
        'no non-demo, non-disposable vault item has BOTH ciphertext and a wrapped data key. ' +
        'Criterion 3 needs one real item through the product\'s own reveal path; a demo item ' +
        'would prove the reveal screen and not the recovery.',
    });
  }

  return out;
}

/**
 * ⚠️ Margin, not a criterion — but the number the drill's value depends on.
 *
 * With exactly one decryptable real item, the drill has no second attempt: if
 * that item fails to unwrap from the scratch endpoint there is nothing to
 * distinguish "the restore lost it" from "this item was always broken".
 */
export function decryptMargin(count: number): 'none' | 'thin' | 'ok' {
  if (count < 1) return 'none';
  return count === 1 ? 'thin' : 'ok';
}

/**
 * The throwaway env file contents for criterion 3.
 *
 * 🔴 IT MUST NEVER BE `.env.local`. That file points at PRODUCTION and is the
 * only copy — the gate's own criterion says so in capitals. This returns a
 * complete file so the drill never edits an existing one.
 */
export function scratchEnv(params: {
  scratchEndpoint: string;
  fromEnvLocal: Record<string, string>;
}): string {
  const carry = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'KMS_KEY_ID',
    'DSQL_ROLE',
    'NEXTAUTH_SECRET',
    'NEXTAUTH_URL',
    'RECIPIENT_JWT_SECRET',
    'VERIFIER_JWT_SECRET',
  ];
  const lines = [
    '# THROWAWAY — generated by `npm run drill:plan` for the D3 restore drill.',
    '# It points at a SCRATCH cluster. Delete it when the drill ends.',
    '# It is NOT .env.local and must never be copied over it.',
    `DSQL_PRIMARY_ENDPOINT=${params.scratchEndpoint}`,
    'DSQL_SECONDARY_ENDPOINT=',
    'DSQL_USE_SECONDARY=false',
  ];
  for (const k of carry) {
    const v = params.fromEnvLocal[k];
    if (v !== undefined) lines.push(`${k}=${v}`);
  }
  return lines.join('\n') + '\n';
}

/** RTO is the OBSERVED elapsed time, never an estimate — criterion 4 says so. */
export function formatRto(startedAt: number, decryptedAt: number): string {
  const ms = decryptedAt - startedAt;
  if (ms < 0) return 'INVALID (decrypt recorded before restore started)';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
