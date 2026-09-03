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
  readTrust,
  CONTRACTS,
  KMS_WALL_CI_CONTRACT,
  READONLY_CI_CONTRACT,
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

/**
 * RO_LIVE with one extra statement — the planted violation, built the same way each time.
 *
 * ⚠️ The planted statement carries a REAL Resource ARN (2026-08-29). It used to
 * carry none, which IAM rejects on an identity policy — so every planted
 * violation was a shape the account cannot produce, and the resource-scope rule
 * added in B16.3 flagged all of them. A fixture that cannot exist tests the
 * checker against fiction; worse, it would have hidden the new rule behind
 * failures that looked like the rule being wrong.
 */
function roPlus(sid: string, action: string | string[]): NamedPolicy[] {
  return [
    RO_LIVE,
    {
      source: 'managed relay-ro-policy v2',
      document: { Statement: [{ Sid: sid, Effect: 'Allow', Action: action, Resource: 'arn:aws:kms:us-east-1:461293170793:key/b3af288c-0e0f-46ec-bccd-9b53776ffbb8' }] },
    },
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
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'dsql:*', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('dsql:*');
  });

  it('catches a bare star', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: ['*'], Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
  });

  it('catches an INLINE policy, which is a different API call and easy to miss', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      V2_LIVE,
      {
        source: 'inline dsql-extra',
        document: { Statement: [{ Sid: 'Oops', Effect: 'Allow', Action: 'dsql:DbConnectAdmin', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] },
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('inline dsql-extra');
  });

  it('catches NotAction, the way an allow-list check is defeated without naming the action', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 's3:*', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
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
    // All three, since B16.6: the KMS half is required, not merely unforbidden.
    expect(v.missing).toEqual(['dsql:dbconnect', 'kms:generatedatakey', 'kms:decrypt']);
  });

  it('is case-insensitive, because IAM is', () => {
    const v = readWall(RUNTIME_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'DSQL:DBCONNECTADMIN', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
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
      { source: 'inline ro-extra', document: { Statement: [{ Effect: 'Allow', Action: ['kms:Decrypt'], Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toContain('inline ro-extra');
  });

  it('catches a NotAction that excludes only kms:Decrypt — it still allows the rest of KMS', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 'kms:Decrypt', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('the whole kms: service'))).toBe(true);
  });

  it('does NOT report the service on a NotAction that excludes the whole of KMS — but still catches the admin grant it hands over', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 'kms:*', Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
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

  it('audits every principal, including the OIDC ROLE that nothing watched until B16.4', () => {
    // The script iterates CONTRACTS and audits nothing else, so an identity
    // missing from this list is an unwatched wall — the exact hole this closed,
    // twice now: relay-ro on 2026-08-21 and relay-kms-wall-ci on 2026-08-29.
    expect(CONTRACTS.map((c) => c.user)).toEqual([
      'relay-runtime',
      'relay-dev',
      'relay-ro',
      'relay-kms-wall-ci',
      'relay-ro-ci',
    ]);
    // A role is reached by satisfying a trust policy, not with a key, so the
    // kind is what decides which API calls collect it. Getting it wrong audits
    // the role's permissions against a user that does not exist.
    expect(CONTRACTS.filter((c) => c.kind === 'role').map((c) => c.user)).toEqual([
      'relay-kms-wall-ci',
      'relay-ro-ci',
    ]);
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

  it('the two read-only identities are held to an absence of KMS, and nothing else is', () => {
    /*
      🆕 2026-09-02 (D21). This case read "only relay-ro" until `relay-ro-ci`
      arrived, and the sentence had to change rather than the rule: the CI role
      is the SAME read-only identity reached from a runner instead of a laptop,
      so it inherits the one property that makes that identity placeable at all.
      Two principals asserting the absence is the rule spreading to where it
      belongs; a THIRD arriving here unnoticed would be the rule spreading to
      somewhere it breaks the product, which is why this is an exact list.
    */
    expect(
      CONTRACTS.filter((c) => (c.forbidsServices ?? []).some((f) => f.service === 'kms')).map(
        (c) => c.user,
      ),
    ).toEqual(['relay-ro', 'relay-ro-ci']);
    expect(READONLY_CONTRACT.forbidsServices?.map((f) => f.service)).toEqual(['kms']);
    expect(READONLY_CI_CONTRACT.forbidsServices?.map((f) => f.service)).toEqual(['kms']);
    expect(RUNTIME_CONTRACT.forbidsServices ?? []).toEqual([]);
    // relay-dev holds KMS too. It is not asserted, and the contract says why
    // rather than leaving the omission to look like coverage.
    expect(LAPTOP_CONTRACT.forbidsServices ?? []).toEqual([]);
    // B16.2 (2026-08-29): relay-dev's KMS grant is now REQUIRED, pinned from the
    // first live read. The note that said it was deliberately unasserted is gone
    // because the reason it gave — "the ACTION LIST was never written down" — no
    // longer holds. The role is the only principal that forbids KMS by ACTION.
    expect(LAPTOP_CONTRACT.requires).toContain('kms:GenerateDataKey');
    expect(LAPTOP_CONTRACT.requires).toContain('kms:Decrypt');
    expect(LAPTOP_CONTRACT.notes ?? []).toEqual([]);
  });

  it('passes relay-dev on the shape the account actually returned on 2026-08-29', () => {
    // Was: the shape docs/least-privilege-cutover.md recorded on 2026-08-16,
    // ["dsql:DbConnect"] alone, with the KMS grant unasserted. B16.1 read the
    // live policy and B16.2 pinned it, so the fixture is now relay-dev-policy v1
    // verbatim — a fixture that lags the account is how a green check stops
    // describing the account.
    const v = readWall(LAPTOP_CONTRACT, [
      {
        source: 'managed relay-dev-policy v1',
        document: {
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
      },
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
    // No violations is the assertion that matters here. A statement with neither
    // Action nor NotAction grants nothing, so the B16.3 resource rule must NOT
    // fire on its missing Resource — it did in the first draft, which is what
    // this case caught.
    expect(v.violations).toEqual([]);
    expect(v.missing).toEqual(['dsql:dbconnect', 'kms:generatedatakey', 'kms:decrypt']);
  });

  it('treats a statement with no Effect as Allow, because IAM does', () => {
    const v = readWall(READONLY_CONTRACT, [
      { source: 'managed x', document: { Statement: [{ Action: ['dsql:DbConnect', 'kms:Decrypt'], Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.includes('kms: service'))).toBe(true);
  });

  it('catches the admin grant on relay-dev as well — a laptop superuser is still a superuser', () => {
    const v = readWall(LAPTOP_CONTRACT, [
      { source: 'managed relay-dev-policy v2', document: { Statement: [{ Effect: 'Allow', Action: ['dsql:DbConnect', 'dsql:DbConnectAdmin'], Resource: 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/ADMIN token/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   B16.3 — RESOURCE SCOPING. The blind spot this file's header described in
   words and left open, closed on 2026-08-29 once a live read showed every
   policy in this account names its target ARNs.
   ──────────────────────────────────────────────────────────────────────────── */
describe('resource scoping — a grant widened to "*" keeps the same action list', () => {
  const WIDENED: NamedPolicy = {
    source: 'managed relay-runtime-policy v3',
    document: {
      Statement: [
        { Sid: 'DsqlConnect', Effect: 'Allow', Action: ['dsql:DbConnect'], Resource: '*' },
        {
          Sid: 'KmsEnvelope',
          Effect: 'Allow',
          Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
          Resource: 'arn:aws:kms:us-east-1:461293170793:key/b3af288c-0e0f-46ec-bccd-9b53776ffbb8',
        },
      ],
    },
  };

  it('catches Resource "*" even though every ACTION is exactly what the contract requires', () => {
    // This is the whole point. An actions-only verdict passes this document —
    // the action list is byte-identical to the live one. What changed is that
    // dsql:DbConnect now reaches every cluster in the account, including any
    // created after this was last reviewed.
    const v = readWall(RUNTIME_CONTRACT, [WIDENED]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain('Resource "*"');
    expect(v.missing).toEqual([]);
  });

  it('catches an Allow that names no Resource at all', () => {
    const v = readWall(READONLY_CONTRACT, [
      {
        source: 'inline oops',
        document: { Statement: [{ Sid: 'NoScope', Effect: 'Allow', Action: 'dsql:DbConnect' }] },
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain('no Resource at all');
  });

  it('passes the live documents, which is what makes the rule pinned rather than guessed', () => {
    expect(readWall(RUNTIME_CONTRACT, [V2_LIVE]).ok).toBe(true);
    expect(readWall(READONLY_CONTRACT, [RO_LIVE]).ok).toBe(true);
  });

  it('every contract carries the scope rule — one that opted out would be silently unscoped', () => {
    for (const c of CONTRACTS) {
      expect(c.resourceScope?.mustNotBeWildcard, `${c.user} has no resourceScope`).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   B16.4 — THE TRUST HALF. For a role assumed from a PUBLIC repository, who may
   BECOME it matters at least as much as what it may do, and an actions-only
   audit sees none of it.
   ──────────────────────────────────────────────────────────────────────────── */
describe('the trust policy of relay-kms-wall-ci', () => {
  const SUB = 'token.actions.githubusercontent.com:sub';
  const OIDC = 'arn:aws:iam::461293170793:oidc-provider/token.actions.githubusercontent.com';

  /** The live document, read from the account on 2026-08-29. */
  const LIVE_TRUST = {
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: OIDC },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            [SUB]: 'repo:sgharlow/relay:ref:refs/heads/master',
          },
        },
      },
    ],
  };

  it('passes the trust policy the account actually has', () => {
    const t = readTrust(KMS_WALL_CI_CONTRACT, LIVE_TRUST);
    expect(t.ok, t.reason).toBe(true);
  });

  it('catches the widening that matters — StringLike on any ref of the repo', () => {
    // repo:sgharlow/relay:* lets EVERY pull request against a public repo assume
    // this role. The permissions read exactly as clean as they did before.
    const t = readTrust(KMS_WALL_CI_CONTRACT, {
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: OIDC },
          Condition: { StringLike: { [SUB]: 'repo:sgharlow/relay:*' } },
        },
      ],
    });
    expect(t.ok).toBe(false);
    expect(t.violations.join(' ')).toContain('StringLike');
  });

  it('catches a StringLike that CONTAINS the pinned subject — the operator is the wildcard', () => {
    // The value looks right. ref:refs/heads/* matches every branch, so a check
    // comparing only the string would pass this.
    const t = readTrust(KMS_WALL_CI_CONTRACT, {
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: OIDC },
          Condition: { StringLike: { [SUB]: 'repo:sgharlow/relay:ref:refs/heads/*' } },
        },
      ],
    });
    expect(t.ok).toBe(false);
  });

  it('catches a trust policy with no sub condition at all — that is any repo on GitHub', () => {
    const t = readTrust(KMS_WALL_CI_CONTRACT, {
      Statement: [{ Effect: 'Allow', Principal: { Federated: OIDC } }],
    });
    expect(t.ok).toBe(false);
    expect(t.violations.join(' ')).toContain('not pinned at all');
  });

  it('catches an account-root Allow sitting beside the federated one', () => {
    // sts:AssumeRole from an IAM principal is a completely different door, and
    // the OIDC pin says nothing whatever about it.
    const t = readTrust(KMS_WALL_CI_CONTRACT, {
      Statement: [
        ...LIVE_TRUST.Statement,
        { Sid: 'Backdoor', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::461293170793:root' } },
      ],
    });
    expect(t.ok).toBe(false);
    expect(t.violations.join(' ')).toContain('non-federated');
  });

  it('refuses to call a role nobody can assume "secure" — that is a dead watch', () => {
    const t = readTrust(KMS_WALL_CI_CONTRACT, { Statement: [] });
    expect(t.ok).toBe(false);
    expect(t.reason).toContain('broken watch');
  });

  it('forbids the two KMS actions that USE the key, not the service — it must READ it', () => {
    // relay-ro's shape (forbid the whole service) would fail this role on its
    // first run for doing its job. That distinction is why this is a contract.
    expect(KMS_WALL_CI_CONTRACT.forbidsServices ?? []).toEqual([]);
    const forbidden = KMS_WALL_CI_CONTRACT.forbids.map((f) => f.action);
    expect(forbidden).toContain('kms:Decrypt');
    expect(forbidden).toContain('kms:GenerateDataKey');
    expect(KMS_WALL_CI_CONTRACT.requires).toContain('kms:DescribeKey');
  });

  it('catches kms:Decrypt arriving on the CI role', () => {
    const v = readWall(KMS_WALL_CI_CONTRACT, [
      {
        source: 'inline read-key-metadata-only',
        document: {
          Statement: [
            {
              Sid: 'Meta',
              Effect: 'Allow',
              Action: [
                'kms:DescribeKey',
                'kms:GetKeyPolicy',
                'kms:GetKeyRotationStatus',
                'kms:Decrypt',
              ],
              Resource:
                'arn:aws:kms:us-east-1:461293170793:key/b3af288c-0e0f-46ec-bccd-9b53776ffbb8',
            },
          ],
        },
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain('kms:decrypt');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   D21 — THE RUNNER'S DATABASE IDENTITY. `relay-ro-ci` is the read-only identity
   reached from GitHub Actions instead of from a laptop: one connect grant, the
   whole KMS service forbidden, and a trust policy pinned to the master ref.

   ⚠️ THESE FIXTURES ARE THE PROPOSED DOCUMENTS, NOT LIVE ONES — the role does
   not exist yet (docs/d21-runner-db-oidc-proposal.md; the controller creates it
   under /safe-execute). Every other fixture in this file is a verbatim copy of
   something the account returned, and the difference matters: this proves the
   READER, and only a run of `npm run verify:iam` against the real role proves
   the ACCOUNT. Said here rather than discovered later.
   ──────────────────────────────────────────────────────────────────────────── */
describe('the IAM half of the least-privilege wall — relay-ro-ci, the runner', () => {
  const PRIMARY = 'arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy';
  const CMK = 'arn:aws:kms:us-east-1:461293170793:key/b3af288c-0e0f-46ec-bccd-9b53776ffbb8';

  /** The permission policy this proposal asks the controller to attach. */
  const HEALTHY: NamedPolicy = {
    source: 'inline relay-ro-ci-connect',
    document: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DsqlConnectNonAdmin',
          Effect: 'Allow',
          Action: ['dsql:DbConnect'],
          Resource: [PRIMARY],
        },
      ],
    },
  };

  /** HEALTHY plus one planted statement, on a Resource IAM would actually accept. */
  function plus(sid: string, action: string | string[], resource: string): NamedPolicy[] {
    return [
      HEALTHY,
      {
        source: 'inline planted',
        document: { Statement: [{ Sid: sid, Effect: 'Allow', Action: action, Resource: resource }] },
      },
    ];
  }

  it('passes the policy the proposal asks for', () => {
    const v = readWall(READONLY_CI_CONTRACT, [HEALTHY]);
    expect(v.ok, v.reason).toBe(true);
    expect(v.violations).toEqual([]);
    expect(v.missing).toEqual([]);
    expect(v.user).toBe('relay-ro-ci');
  });

  it('fails on kms:DescribeKey — which decrypts NOTHING, and is exactly why the rule is a service', () => {
    /*
      The sharpest difference between the two OIDC roles in this file.
      `relay-kms-wall-ci` REQUIRES kms:DescribeKey to do its job; this role
      holding it would end the sentence the whole read-only identity rests on.
      The same action, two roles, opposite verdicts — which is what a contract
      per principal is for.
    */
    const v = readWall(READONLY_CI_CONTRACT, plus('Meta', 'kms:DescribeKey', CMK));
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain('kms: service');
    expect(readWall(KMS_WALL_CI_CONTRACT, [HEALTHY]).ok).toBe(false); // and not interchangeable
  });

  it('fails on dsql:DbConnectAdmin — a runner that can obtain DDL over every table', () => {
    const v = readWall(READONLY_CI_CONTRACT, plus('Admin', 'dsql:DbConnectAdmin', PRIMARY));
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toContain('dsql:dbconnectadmin');
    expect(v.reason).toContain('DSQL ADMIN token');
  });

  it('catches a service wildcard, which confers admin without naming it', () => {
    const v = readWall(READONLY_CI_CONTRACT, plus('Wild', 'dsql:*', PRIMARY));
    expect(v.ok).toBe(false);
  });

  it('refuses to call a role with no connect grant secure — CI stops, it does not get safer', () => {
    const v = readWall(READONLY_CI_CONTRACT, [
      { source: 'inline empty', document: { Statement: [] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['dsql:dbconnect']);
  });
});

describe('the trust policy of relay-ro-ci — the half that decides who may BECOME it', () => {
  const SUB = 'token.actions.githubusercontent.com:sub';
  const OIDC = 'arn:aws:iam::461293170793:oidc-provider/token.actions.githubusercontent.com';

  const PROPOSED = {
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: OIDC },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            [SUB]: 'repo:sgharlow/relay:ref:refs/heads/master',
          },
        },
      },
    ],
  };

  // ⚠️ Cited docs/iam-wall-oidc-role-proposal.md §4 until the review on
  // 2026-09-02. That document proposes a DIFFERENT role — an OIDC identity for
  // verify:iam — and pointing a reader at it for this role's trust policy sends
  // them to a document that will not mention relay-ro-ci. The two proposals are
  // near-identical in shape, which is exactly why the wrong one is easy to name.
  it('passes the trust policy docs/d21-runner-db-oidc-proposal.md §7 step 1 specifies', () => {
    const t = readTrust(READONLY_CI_CONTRACT, PROPOSED);
    expect(t.ok, t.reason).toBe(true);
  });

  it('catches the widening that would hand production PII to any fork', () => {
    /*
      sgharlow/relay is PUBLIC. `repo:sgharlow/relay:*` lets a stranger's pull
      request assume a role that holds SELECT on every table — emails, display
      names and vault item titles. The ACTION list would read exactly as clean
      as it does above, which is why the trust half is audited separately.
    */
    const t = readTrust(READONLY_CI_CONTRACT, {
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: OIDC },
          Condition: { StringLike: { [SUB]: 'repo:sgharlow/relay:*' } },
        },
      ],
    });
    expect(t.ok).toBe(false);
    expect(t.violations.join(' ')).toContain('StringLike');
  });

  it('pins the master ref, the same subject the workflow can actually present', () => {
    // A pull_request run presents a different sub, so it CANNOT assume this
    // role — which is a design constraint the workflow has to respect rather
    // than a defect. .github/workflows/a11y.yml audits owner mode on master
    // pushes and dispatches only, and says so.
    expect(READONLY_CI_CONTRACT.trust?.subject).toBe('repo:sgharlow/relay:ref:refs/heads/master');
    expect(READONLY_CI_CONTRACT.trust?.provider).toBe('token.actions.githubusercontent.com');
  });
});
