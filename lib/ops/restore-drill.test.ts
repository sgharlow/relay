/**
 * The drill's judgement, proven before the drill needs it.
 *
 * See `lib/ops/restore-drill.ts`. These pin the refusals — a pre-flight that
 * passes on a state the drill cannot survive is worse than no pre-flight,
 * because it is the thing that persuades you to start.
 *
 * Feature: relay-h0-mvp
 * Requirements: D3.0-D3.4
 */

import { describe, it, expect } from 'vitest';
import {
  preflight,
  decryptMargin,
  scratchEnv,
  formatRto,
  BACKUP_ROLE_ARN,
  STALE_AFTER_HOURS,
  type PreflightInput,
} from './restore-drill';

/** The state measured live on 2026-08-31 — the drill's actual starting point. */
const HEALTHY: PreflightInput = {
  primaryActive: true,
  primaryProtected: true,
  secondaryActive: true,
  secondaryProtected: true,
  points: [
    { vault: 'relay-vault', ageHours: 20.8, bytes: 2246908, count: 23 },
    { vault: 'relay-vault-dr', ageHours: 20.6, bytes: 2246908, count: 22 },
  ],
  kmsHolds: true,
  decryptableRealItems: 1,
};

describe('the restore drill pre-flight', () => {
  it('passes on the state measured live on 2026-08-31', () => {
    expect(preflight(HEALTHY)).toEqual([]);
  });

  it('refuses when the key wall does not hold — a restore without it is not a recovery', () => {
    /*
      🔴 THE CRITERION THE LAST DRILL MISSED. The 2026-08-08 run restored a
      database and never unwrapped an item. A restored cluster is ciphertext
      without the key, so a green restore with a failing CMK proves storage and
      nothing else.
    */
    const f = preflight({ ...HEALTHY, kmsHolds: false });
    expect(f).toHaveLength(1);
    expect(f[0].criterion).toContain('2');
    expect(f[0].detail).toMatch(/PENDING DELETION still decrypts/);
  });

  it('refuses when no real item could be decrypted', () => {
    const f = preflight({ ...HEALTHY, decryptableRealItems: 0 });
    expect(f.map((x) => x.criterion)).toEqual(['3 — one real item']);
  });

  it('refuses when a vault has gone stale, because that is a finding of its own', () => {
    const f = preflight({
      ...HEALTHY,
      points: [{ vault: 'relay-vault', ageHours: STALE_AFTER_HOURS + 0.1, bytes: 1, count: 5 }],
    });
    expect(f).toHaveLength(1);
    expect(f[0].detail).toMatch(/the SCHEDULE has stopped/);
  });

  it('refuses when a production cluster has lost deletion protection', () => {
    /*
      The drill DELETES a cluster on purpose. Doing that beside an unprotected
      production cluster is one mistyped identifier away from the incident it
      exists to rehearse.
    */
    const f = preflight({ ...HEALTHY, secondaryProtected: false });
    expect(f).toHaveLength(1);
    expect(f[0].criterion).toContain('deletion protection');
  });

  it('refuses when there is nothing to restore from', () => {
    const f = preflight({ ...HEALTHY, points: [] });
    expect(f[0].detail).toMatch(/nothing to restore FROM/);
  });

  it('reports one decryptable item as THIN rather than fine', () => {
    // Live state on 2026-08-31 is exactly one. The drill can start, and it has
    // no second attempt — which the operator should know before it begins, not
    // while staring at a failed unwrap.
    expect(decryptMargin(1)).toBe('thin');
    expect(decryptMargin(0)).toBe('none');
    expect(decryptMargin(2)).toBe('ok');
  });
});

describe('the throwaway env', () => {
  const env = scratchEnv({
    scratchEndpoint: 'scratch123.dsql.us-east-1.on.aws',
    fromEnvLocal: {
      KMS_KEY_ID: 'b3af288c',
      DSQL_ROLE: 'relay_dev',
      DSQL_PRIMARY_ENDPOINT: 'PRODUCTION-ENDPOINT-MUST-NOT-SURVIVE',
      AWS_REGION: 'us-east-1',
    },
  });

  it('points at the scratch endpoint and never carries the production one through', () => {
    /*
      🔴 The gate's criterion 3 says, in capitals: never by editing .env.local,
      which points at production and is the only copy. So the production endpoint
      must not survive into the generated file even though it is present in the
      source map this is built from.
    */
    expect(env).toContain('DSQL_PRIMARY_ENDPOINT=scratch123.dsql.us-east-1.on.aws');
    expect(env).not.toContain('PRODUCTION-ENDPOINT-MUST-NOT-SURVIVE');
  });

  it('carries the key and the role, because a restore that cannot decrypt proves nothing', () => {
    expect(env).toContain('KMS_KEY_ID=b3af288c');
    expect(env).toContain('DSQL_ROLE=relay_dev');
  });

  it('pins the secondary off, so a failover cannot silently read production', () => {
    // DSQL_USE_SECONDARY=true against a blank secondary is better than against
    // the real one; blank plus false is the only state that cannot reach prod.
    expect(env).toContain('DSQL_SECONDARY_ENDPOINT=\n');
    expect(env).toContain('DSQL_USE_SECONDARY=false');
  });

  it('says what it is in its own first line', () => {
    expect(env.split('\n')[0]).toMatch(/THROWAWAY/);
  });
});

describe('the recorded facts', () => {
  it('keeps the backup role ARN with its double slashes intact', () => {
    /*
      🔴 TRAP 2. The IAM path is literally `//service-role//`. Pass the
      well-formed ARN and AWS Backup answers "IAM Role does not have sufficient
      permissions", which sends you hunting for a permission that is already
      granted. A well-meaning tidy-up of this string costs an hour on the day.
    */
    expect(BACKUP_ROLE_ARN).toContain('role//service-role//');
    expect(BACKUP_ROLE_ARN).not.toContain('role/service-role/AWSBackup');
  });

  it('formats an observed RTO, and refuses an impossible one', () => {
    expect(formatRto(0, 8 * 60000 + 30000)).toBe('8m 30s');
    expect(formatRto(1000, 0)).toMatch(/INVALID/);
  });
});
