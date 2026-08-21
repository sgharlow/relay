/**
 * The wall reader, tested against the documents that actually exist in the
 * account and against every way a forbidden grant can come back.
 *
 * The fixtures below are VERBATIM copies of the live policies: `relay-runtime-policy`
 * v2 (the default, post-cutover) and v1 (retained as the rollback, and still
 * carrying the admin grant), and `relay-ro-policy` (created 2026-08-21). They are
 * the negative and positive controls this check would otherwise have to plant by
 * hand — and planting it by hand would mean editing a live IAM policy to prove a
 * test works, which is exactly the kind of change the Infrastructure Change
 * Policy exists to refuse.
 *
 * `npm run verify:iam` reads the LIVE policies. This file proves the reader can
 * tell them apart, and that it applies each principal's OWN contract: the same
 * KMS statement is the product working on `relay-runtime` and a breach of the
 * only guarantee `.env.ro` has on `relay-ro`.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import {
  readWall,
  CONTRACTS,
  RUNTIME_CONTRACT,
  LAPTOP_CONTRACT,
  READONLY_CONTRACT,
  type NamedPolicy,
} from './iam-wall';

/** relay-runtime-policy v2 — the live default as of the 2026-08-16 cutover. */
const V2_LIVE: NamedPolicy = {
  source: 'managed relay-runtime-policy v2',
  document: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DsqlConnect',
        Effect: 'Allow',
        Action: ['dsql:DbConnect'],
        Resource: [
          'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy',
          'arn:aws:dsql:us-west-2:461293170793:cluster/fjt34b2el5yoh7pvcm4knbkyvi',
        ],
      },
      {
        Sid: 'KmsEnvelope',
        Effect: 'Allow',
        Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
        Resource: 'arn:aws:kms:us-east-1:461293170793:key/b3af288c-0e0f-46ec-bccd-9b53776ffbb8',
      },
    ],
  },
};

/** relay-runtime-policy v1 — retained as the rollback. This is the state to catch. */
const V1_ROLLBACK: NamedPolicy = {
  source: 'managed relay-runtime-policy v1',
  document: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DsqlConnect',
        Effect: 'Allow',
        Action: ['dsql:DbConnect', 'dsql:DbConnectAdmin'],
        Resource: ['arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy'],
      },
    ],
  },
};

/**
 * relay-ro-policy — created 2026-08-21, verbatim.
 *
 * The whole document. What is NOT in it is the point: no KMS statement, so a
 * leaked `.env.ro` reads metadata and can never unwrap a vault data key.
 */
const RO_LIVE: NamedPolicy = {
  source: 'managed relay-ro-policy v1',
  document: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DsqlConnectNonAdmin',
        Effect: 'Allow',
        Action: ['dsql:DbConnect'],
        Resource: [
          'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy',
          'arn:aws:dsql:us-west-2:461293170793:cluster/fjt34b2el5yoh7pvcm4knbkyvi',
        ],
      },
    ],
  },
};

/** RO_LIVE with one extra statement — the planted violation, built the same way each time. */
function roPlus(sid: string, action: string | string[]): NamedPolicy[] {
  return [
    RO_LIVE,
    { source: 'managed relay-ro-policy v2', document: { Statement: [{ Sid: sid, Effect: 'Allow', Action: action }] } },
  ];
}

describe('the IAM half of the least-privilege wall — relay-runtime', () => {
  it('passes on the policy that is actually live', () => {
    const v = readWall(RUNTIME_CONTRACT, [V2_LIVE]);
    expect(v.ok, v.reason).toBe(true);
    expect(v.violations).toEqual([]);
    expect(v.missing).toEqual([]);
    expect(v.user).toBe('relay-runtime');
  });

  it('fails on v1 — the rollback version, which still carries the admin grant', () => {
    const v = readWall(RUNTIME_CONTRACT, [V1_ROLLBACK]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/ADMIN token/);
    expect(v.violations[0]).toContain('dsql:dbconnectadmin');
  });

  /*
    The three ways it comes back. A check that only matched the literal string
    would pass on two of them, which would make it the fourth check in this repo
    to pass on the very defect it was written for.
  */
  it('catches a service wildcard, which confers admin without naming it', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'dsql:*' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('dsql:*');
  });

  it('catches a bare star', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: ['*'] }] } },
    ]);
    expect(v.ok).toBe(false);
  });

  it('catches an INLINE policy, which is a different API call and easy to miss', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      V2_LIVE,
      {
        source: 'inline dsql-extra',
        document: { Statement: [{ Sid: 'Oops', Effect: 'Allow', Action: 'dsql:DbConnectAdmin' }] },
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('inline dsql-extra');
  });

  it('catches NotAction, the way an allow-list check is defeated without naming the action', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 's3:*' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toMatch(/NotAction/);
  });

  it('ignores a Deny — this reads what is GRANTED', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      V2_LIVE,
      {
        source: 'managed guardrail',
        document: { Statement: [{ Effect: 'Deny', Action: 'dsql:DbConnectAdmin' }] },
      },
    ]);
    expect(v.ok, v.reason).toBe(true);
  });

  it('refuses to call an empty policy secure — that is broken, not safe', () => {
    // A wall check that is happiest when the site cannot reach its database is
    // measuring something adjacent to the question.
    const v = readWall(RUNTIME_CONTRACT, [{ source: 'managed x', document: { Statement: [] } }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/broken one/);
    expect(v.missing).toEqual(['dsql:dbconnect']);
  });

  it('is case-insensitive, because IAM is', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'DSQL:DBCONNECTADMIN' }] } },
    ]);
    expect(v.ok).toBe(false);
  });

  it('does not forbid the KMS grant the live site legitimately needs', () => {
    // The envelope statement in V2_LIVE is the product working. Only relay-ro is
    // held to an absence of KMS, and a check that confused the two would be
    // reporting the encryption as the defect.
    const v = readWall(RUNTIME_CONTRACT, [V2_LIVE]);
    expect(v.ok, v.reason).toBe(true);
  });
});

describe('the IAM half of the least-privilege wall — relay-ro, whose whole guarantee is an absence', () => {
  it('passes on relay-ro-policy as it actually exists', () => {
    const v = readWall(READONLY_CONTRACT, [RO_LIVE]);
    expect(v.ok, v.reason).toBe(true);
    expect(v.violations).toEqual([]);
    expect(v.user).toBe('relay-ro');
    expect(v.reason).toMatch(/kms:\* \(the whole service\)/);
  });

  /*
    🔴 THE ASSERTION THAT DID NOT EXIST BEFORE 2026-08-21, and the reason this
    check had to grow a per-principal contract rather than a wider constant.
  */
  it('fails the moment relay-ro is given kms:Decrypt', () => {
    const v = readWall(READONLY_CONTRACT, roPlus('Oops', 'kms:Decrypt'));
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('reaches the kms: service');
    expect(v.reason).toMatch(/PLACEABLE SOMEWHERE LESS TRUSTED/);
  });

  it('fails on kms:DescribeKey too — which decrypts NOTHING, and is the whole reason the rule is a service and not an action', () => {
    // A rule written as "does not confer kms:Decrypt" passes this document. The
    // claim printed in .env.example and docs/secret-rotation-runbook.md is "no
    // KMS", and this is the case that tells the two apart.
    const v = readWall(READONLY_CONTRACT, roPlus('Harmless', 'kms:DescribeKey'));
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('kms:describekey');
  });

  it('catches a KMS service wildcard', () => {
    const v = readWall(READONLY_CONTRACT, roPlus('Wide', 'kms:*'));
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('kms:*'))).toBe(true);
  });

  it('catches a bare star, which is both violations at once', () => {
    const v = readWall(READONLY_CONTRACT, roPlus('Everything', '*'));
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('kms: service'))).toBe(true);
    expect(v.violations.some((x) => x.includes('"*"') && !x.includes('kms'))).toBe(true);
  });

  it('catches KMS arriving on an INLINE policy', () => {
    const v = readWall(READONLY_CONTRACT, [
      RO_LIVE,
      { source: 'inline ro-extra', document: { Statement: [{ Effect: 'Allow', Action: ['kms:Decrypt'] }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('inline ro-extra');
  });

  it('catches a NotAction that excludes only kms:Decrypt — it still allows the rest of KMS', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 'kms:Decrypt' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('the whole kms: service'))).toBe(true);
  });

  it('does NOT report the service on a NotAction that excludes the whole of KMS — but still catches the admin grant it hands over', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 'kms:*' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('kms: service'))).toBe(false);
    expect(v.violations.some((x) => x.includes('dsql:dbconnectadmin'))).toBe(true);
  });

  it('is case-insensitive about the service too', () => {
    const v = readWall(READONLY_CONTRACT, roPlus('Shouting', 'KMS:DECRYPT'));
    expect(v.ok).toBe(false);
  });

  it('refuses to call a relay-ro with no connect grant secure — the instruments stop', () => {
    const v = readWall(READONLY_CONTRACT, [{ source: 'managed relay-ro-policy v9', document: { Statement: [] } }]);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['dsql:dbconnect']);
    expect(v.reason).toMatch(/verify:schema/);
  });
});

describe('the contract is per-principal, which is the point of the change', () => {
  /*
    🔴 THE SHARPEST PROOF THAT THIS IS NOT ONE GLOBAL RULE SET. The identical
    document — relay-runtime-policy v2, with its envelope statement — is the
    product working on one principal and the end of .env.ro's only guarantee on
    another. A checker hardcoded to a single principal cannot express that, and
    for five days it did not: relay-ro was audited by nothing at the IAM layer.
  */
  it('reads the SAME policy as healthy for relay-runtime and as a breach for relay-ro', () => {
    expect(readWall(RUNTIME_CONTRACT, [V2_LIVE]).ok).toBe(true);

    const asReadOnly = readWall(READONLY_CONTRACT, [V2_LIVE]);
    expect(asReadOnly.ok).toBe(false);
    expect(asReadOnly.violations.some((x) => x.includes('kms: service'))).toBe(true);
  });

  it('audits all three principals, and names relay-ro among them', () => {
    // The script iterates CONTRACTS and audits nothing else, so an identity
    // missing from this list is an unwatched wall — the exact hole this closed.
    expect(CONTRACTS.map((c) => c.user)).toEqual(['relay-runtime', 'relay-dev', 'relay-ro']);
  });

  it('every contract asserts both halves — something required and the admin action forbidden', () => {
    // The meta-check. A contract with an empty `forbids` would pass every test
    // above by never asserting anything, which is how a check goes blind.
    for (const c of CONTRACTS) {
      expect(c.requires.length, `${c.user} requires nothing`).toBeGreaterThan(0);
      expect(
        c.forbids.map((f) => f.action.toLowerCase()),
        `${c.user} does not forbid the admin token`,
      ).toContain('dsql:dbconnectadmin');
      for (const f of c.forbids) expect(f.consequence.length).toBeGreaterThan(40);
      expect(c.requiresConsequence.length).toBeGreaterThan(40);
    }
  });

  it('only relay-ro is held to an absence of KMS, and it is held to it', () => {
    expect(READONLY_CONTRACT.forbidsServices?.map((f) => f.service)).toEqual(['kms']);
    expect(RUNTIME_CONTRACT.forbidsServices ?? []).toEqual([]);
    // relay-dev holds KMS too. It is not asserted, and the contract says why
    // rather than leaving the omission to look like coverage.
    expect(LAPTOP_CONTRACT.forbidsServices ?? []).toEqual([]);
    expect(LAPTOP_CONTRACT.notes?.join(' ')).toMatch(/NOT ASSERTED/);
  });

  it('passes relay-dev on the shape docs/least-privilege-cutover.md recorded for it', () => {
    // Verified 2026-08-16: relay-dev → ["dsql:DbConnect"]. The KMS grant it also
    // holds is not in that record and is not asserted here.
    const v = readWall(LAPTOP_CONTRACT, [
      { source: 'managed relay-dev-policy v1', document: { Statement: [{ Effect: 'Allow', Action: ['dsql:DbConnect'] }] } },
    ]);
    expect(v.ok, v.reason).toBe(true);
  });

  it('survives the shapes IAM actually returns for an empty or odd document', () => {
    // `decode()` in verify-iam.ts returns `{}` for a policy with no document at
    // all, and a statement may carry neither Action nor NotAction. Neither is a
    // grant; both must read as "nothing here", not as a crash and not as a pass.
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed empty', document: {} },
      { source: 'managed odd', document: { Statement: [{ Sid: 'NoVerbs' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual([]);
    expect(v.missing).toEqual(['dsql:dbconnect']);
  });

  it('treats a statement with no Effect as Allow, because IAM does', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Action: ['dsql:DbConnect', 'kms:Decrypt'] }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('kms: service'))).toBe(true);
  });

  it('catches the admin grant on relay-dev as well — a laptop superuser is still a superuser', () => {
    const v = readWall(LAPTOP_CONTRACT, [
      { source: 'managed relay-dev-policy v2', document: { Statement: [{ Effect: 'Allow', Action: ['dsql:DbConnect', 'dsql:DbConnectAdmin'] }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/ADMIN token/);
  });
});
