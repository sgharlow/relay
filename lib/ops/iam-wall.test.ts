/**
 * The wall reader, tested against the documents that actually exist in the
 * account and against the three ways the admin grant can come back.
 *
 * The two fixtures below are VERBATIM copies of `relay-runtime-policy` v2 (the
 * live default, post-cutover) and v1 (retained as the rollback, and still
 * carrying the admin grant). They are the negative and positive control this
 * check would otherwise have to plant by hand — and planting it by hand would
 * mean editing a live IAM policy to prove a test works, which is exactly the
 * kind of change the Infrastructure Change Policy exists to refuse.
 *
 * `npm run verify:iam` reads the LIVE policy. This file proves the reader can
 * tell the two apart.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { readWall, type NamedPolicy } from './iam-wall';

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

describe('the IAM half of the least-privilege wall', () => {
  it('passes on the policy that is actually live', () => {
    const v = readWall([V2_LIVE]);
    expect(v.ok, v.reason).toBe(true);
    expect(v.adminGrants).toEqual([]);
    expect(v.connectGranted).toBe(true);
  });

  it('fails on v1 — the rollback version, which still carries the admin grant', () => {
    const v = readWall([V1_ROLLBACK]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/ADMIN token/);
    expect(v.adminGrants[0]).toContain('dsql:dbconnectadmin');
  });

  /*
    The three ways it comes back. A check that only matched the literal string
    would pass on two of them, which would make it the fourth check in this repo
    to pass on the very defect it was written for.
  */
  it('catches a service wildcard, which confers admin without naming it', () => {
    const v = readWall([
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'dsql:*' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.adminGrants[0]).toContain('dsql:*');
  });

  it('catches a bare star', () => {
    const v = readWall([
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: ['*'] }] } },
    ]);
    expect(v.ok).toBe(false);
  });

  it('catches an INLINE policy, which is a different API call and easy to miss', () => {
    const v = readWall([
      V2_LIVE,
      {
        source: 'inline dsql-extra',
        document: { Statement: [{ Sid: 'Oops', Effect: 'Allow', Action: 'dsql:DbConnectAdmin' }] },
      },
    ]);
    expect(v.ok).toBe(false);
    expect(v.adminGrants[0]).toContain('inline dsql-extra');
  });

  it('catches NotAction, the way an allow-list check is defeated without naming the action', () => {
    const v = readWall([
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', NotAction: 's3:*' }] } },
    ]);
    expect(v.ok).toBe(false);
    expect(v.adminGrants[0]).toMatch(/NotAction/);
  });

  it('ignores a Deny — this reads what is GRANTED', () => {
    const v = readWall([
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
    const v = readWall([{ source: 'managed x', document: { Statement: [] } }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/broken one/);
  });

  it('is case-insensitive, because IAM is', () => {
    const v = readWall([
      { source: 'managed x', document: { Statement: [{ Effect: 'Allow', Action: 'DSQL:DBCONNECTADMIN' }] } },
    ]);
    expect(v.ok).toBe(false);
  });
});
