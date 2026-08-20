/**
 * The key wall, proven in both directions.
 *
 * Every rule below was written against a PLANTED fixture — the state AWS would
 * actually return in that failure — because this repository has three recorded
 * cases of a check passing on the very defect it was written for. A wall
 * checker that has only ever been seen to pass has not been seen to work.
 *
 * The two that matter most are the last two: a key policy granting nobody must
 * FAIL, and a correctly-configured key must PASS. A check that is happiest when
 * the product is dead is measuring the wrong thing, and a check that cries wolf
 * on the ordinary correct configuration is one somebody switches off.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 2.4, 17.4
 */

import { describe, it, expect } from 'vitest';
import { readKeyWall, type KeyFacts } from './kms-wall';

const RUNTIME = 'arn:aws:iam::461293170793:user/relay-runtime';

/** A key in the state the product needs. Every test mutates one thing from here. */
function healthy(): KeyFacts {
  return {
    metadata: {
      KeyId: '1234abcd-12ab-34cd-56ef-1234567890ab',
      Enabled: true,
      KeyState: 'Enabled',
      KeyManager: 'CUSTOMER',
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      MultiRegion: false,
    },
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowRuntimeEnvelopeOps',
          Effect: 'Allow',
          Principal: { AWS: RUNTIME },
          Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
          Resource: '*',
        },
      ],
    },
    rotationEnabled: true,
    runtimePrincipal: RUNTIME,
  };
}

describe('the healthy key passes', () => {
  it('reports ok on a key configured the way the product needs', () => {
    const v = readKeyWall(healthy(), true);
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it('still passes when the account root carries the grant, not the user', () => {
    // The ordinary KMS pattern: the key policy delegates to the account and IAM
    // decides. A check that failed here would fail on the correct default.
    const facts = healthy();
    facts.policy!.Statement![0]!.Principal = { AWS: 'arn:aws:iam::461293170793:root' };
    expect(readKeyWall(facts, true).ok).toBe(true);
  });

  it('does NOT accept a root principal from a different account', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Principal = { AWS: 'arn:aws:iam::999999999999:root' };
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('key policy no longer lets');
  });

  it('accepts a wildcard action that confers without naming', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Action = 'kms:*';
    expect(readKeyWall(facts, true).ok).toBe(true);
  });
});

describe('the key is gone, going, or off', () => {
  it('fails when KMS returns no metadata at all', () => {
    const facts = { ...healthy(), metadata: undefined };
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no metadata');
  });

  it('fails, with the date, when a deletion is scheduled', () => {
    const facts = healthy();
    facts.metadata!.KeyState = 'PendingDeletion';
    facts.metadata!.DeletionDate = '2026-09-19T00:00:00.000Z';
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('SCHEDULED FOR DELETION');
    expect(v.failures.join(' ')).toContain('2026-09-19');
  });

  it('fails on a scheduled deletion even while the key still works', () => {
    // The whole reason this check exists: a key pending deletion still decrypts,
    // so the product looks healthy for the entire waiting period and then is
    // unrecoverable. Enabled: true here on purpose.
    const facts = healthy();
    facts.metadata!.DeletionDate = '2026-09-19T00:00:00.000Z';
    expect(readKeyWall(facts, true).ok).toBe(false);
  });

  it('fails when the key is disabled', () => {
    const facts = healthy();
    facts.metadata!.Enabled = false;
    facts.metadata!.KeyState = 'Disabled';
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('Disabled');
  });

  it('fails on any state that is not Enabled', () => {
    for (const state of ['Unavailable', 'Creating', 'PendingImport']) {
      const facts = healthy();
      facts.metadata!.KeyState = state;
      expect(readKeyWall(facts, true).ok, `${state} must not pass`).toBe(false);
    }
  });
});

describe('the policy stopped naming the runtime', () => {
  it('fails when GenerateDataKey is withdrawn', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Action = ['kms:Decrypt'];
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('kms:generatedatakey');
  });

  it('fails when Decrypt is withdrawn — a vault it can write and never read', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Action = ['kms:GenerateDataKey'];
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('kms:decrypt');
  });

  it('does not count a Deny statement as a grant', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Effect = 'Deny';
    expect(readKeyWall(facts, true).ok).toBe(false);
  });

  it('fails when the grant names somebody else entirely', () => {
    const facts = healthy();
    facts.policy!.Statement![0]!.Principal = { AWS: 'arn:aws:iam::461293170793:user/somebody-else' };
    expect(readKeyWall(facts, true).ok).toBe(false);
  });

  it('fails when the policy cannot be read', () => {
    const facts = { ...healthy(), policy: undefined };
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('could not be read');
  });
});

describe('the positive half — a check that is happiest when the product is dead', () => {
  it('FAILS on a key policy that grants nobody anything', () => {
    const facts = healthy();
    facts.policy!.Statement = [];
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('broken, not secure');
  });

  it('FAILS on a policy of nothing but denials', () => {
    const facts = healthy();
    facts.policy!.Statement = [
      { Sid: 'DenyAll', Effect: 'Deny', Principal: '*', Action: '*', Resource: '*' },
    ];
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('broken, not secure');
  });
});

describe('rotation is an intention, and the finding is nobody knowing', () => {
  it('fails when rotation is off and the repo intends it on', () => {
    const facts = { ...healthy(), rotationEnabled: false };
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('rotation is OFF');
  });

  it('fails when rotation is on and the repo intends it off', () => {
    const v = readKeyWall(healthy(), false);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('rotation is ON');
  });

  it('notes rather than fails when rotation cannot be read', () => {
    const facts = { ...healthy(), rotationEnabled: undefined };
    const v = readKeyWall(facts, true);
    expect(v.ok).toBe(true);
    expect(v.notes.join(' ')).toContain('rotation status unreadable');
  });
});

describe('the single-region limitation is reported and does not fail the run', () => {
  it('notes it, because the fix is an infrastructure decision and not this check', () => {
    const v = readKeyWall(healthy(), true);
    expect(v.ok).toBe(true);
    expect(v.notes.join(' ')).toContain('single-Region CMK');
    expect(v.notes.join(' ')).toContain('B3');
  });

  it('says nothing about it for a multi-Region key', () => {
    const facts = healthy();
    facts.metadata!.MultiRegion = true;
    expect(readKeyWall(facts, true).notes.join(' ')).not.toContain('single-Region');
  });
});

describe('several findings are reported together', () => {
  it('does not stop at the first one — an operator fixing one at a time is a slow outage', () => {
    const facts = healthy();
    facts.metadata!.KeyState = 'Disabled';
    facts.metadata!.Enabled = false;
    facts.policy!.Statement![0]!.Action = ['kms:Decrypt'];
    const v = readKeyWall({ ...facts, rotationEnabled: false }, true);
    expect(v.ok).toBe(false);
    expect(v.failures.length).toBeGreaterThanOrEqual(3);
  });
});
