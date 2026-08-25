/**
 * Tests for POST /api/access/code — a typed code exchanged for a recipient session.
 *
 * WHY THIS FILE EXISTS. The other public, unauthenticated door into a live
 * release, and the one that reaches vault contents rather than a yes/no
 * question. It read 0% statements and 0% branches on 2026-08-22.
 *
 * 🔴 THE TOKEN CARRIES A VERSION AND THAT IS THE WHOLE RE-ARM STORY.
 * `issueRecipientToken(recipientId, releaseStateId, BigInt(version))` — a JWT
 * whose `version` no longer matches `release_state.version` is rejected
 * downstream, which is how "the owner checked back in" closes every open
 * dashboard. The version must come from the REDEMPTION, and `BigInt` is
 * load-bearing: `tsconfig.json` targets ES2020 specifically for this type, and
 * a version that arrived as a JS number would start losing precision silently
 * rather than failing.
 *
 * The other property worth pinning: `closed` is a 400 with a reason the client
 * renders as a graceful close, not an error. The recipient did nothing wrong —
 * the good outcome happened, and the owner came home.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1, J9-R4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/recipient-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/auth/recipient-code')>();
  return { ...actual, redeemRecipientCode: vi.fn(), recordFailedAttempt: vi.fn(async () => undefined) };
});
vi.mock('../../../../../lib/auth/recipient-token', () => ({ issueRecipientToken: vi.fn() }));
/*
  The last test in this file imports the SIBLING door to prove the two do not
  share a rate-limit bucket. That import pulls the real verifier modules, which
  reach for a DSQL pool the moment a miss is recorded — so they are stubbed here
  as well. Without this the assertion still passed for the wrong reason: it read
  a thrown "DSQL_PRIMARY_ENDPOINT is not set" rather than a status code.
*/
vi.mock('../../../../../lib/auth/verifier-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/auth/verifier-code')>();
  return {
    ...actual,
    redeemVerifierCode: vi.fn(async () => {
      throw new actual.VerifierCodeError('no', 'invalid');
    }),
    recordFailedAttempt: vi.fn(async () => undefined),
  };
});
vi.mock('../../../../../lib/auth/verifier-token', () => ({
  issueVerifierToken: vi.fn(async () => 'verifier-jwt'),
}));

import {
  redeemRecipientCode,
  recordFailedAttempt,
  RecipientCodeError,
} from '../../../../../lib/auth/recipient-code';
import { issueRecipientToken } from '../../../../../lib/auth/recipient-token';
import { _resetRateLimitForTesting } from '../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockRedeem = vi.mocked(redeemRecipientCode);
const mockRecordFail = vi.mocked(recordFailedAttempt);
const mockIssue = vi.mocked(issueRecipientToken);

function makeReq(body: unknown, ip = '198.51.100.9') {
  return {
    method: 'POST',
    headers: new Headers({ 'x-forwarded-for': ip }),
    json: async () => body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTesting();
  mockIssue.mockResolvedValue('recipient-jwt');
});

describe('POST /api/access/code — redemption', () => {
  it('mints a recipient token scoped to the release and its current version', async () => {
    mockRedeem.mockResolvedValueOnce({
      recipientId: 'r-1',
      releaseStateId: 'rs-1',
      version: 7,
    } as never);

    const res = await POST(makeReq({ code: 'ABCD-1234' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: 'recipient-jwt' });
    expect(mockIssue).toHaveBeenCalledWith('r-1', 'rs-1', 7n);
  });

  /*
    OCC versions are BIGINT. A version past Number.MAX_SAFE_INTEGER handed
    through as a JS number would round — and a rounded version compares EQUAL to
    a neighbouring one, so a token minted before a re-arm could survive it. That
    is the one failure mode where the re-arm silently stops closing dashboards,
    and it would leave no trace. `BigInt(version)` is what prevents it; this is
    the test that notices if it is removed.
  */
  it('carries a large version through without losing precision', async () => {
    const huge = '9007199254740993'; // 2^53 + 1 — not representable as a double
    mockRedeem.mockResolvedValueOnce({
      recipientId: 'r-1',
      releaseStateId: 'rs-1',
      version: huge,
    } as never);

    await POST(makeReq({ code: 'ABCD-1234' }));

    expect(mockIssue).toHaveBeenCalledWith('r-1', 'rs-1', 9007199254740993n);
    expect(String(vi.mocked(mockIssue).mock.calls[0][2])).toBe(huge);
  });
});

describe('POST /api/access/code — refusals', () => {
  it.each([
    ['a missing code', {}],
    ['a null body', null],
    ['a non-string code', { code: 123456 }],
    ['whitespace only', { code: '  ' }],
  ])('refuses %s with 400 before touching the redeemer', async (_label, body) => {
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'BadRequest' });
    expect(mockRedeem).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('charges a miss against the code only when the code is invalid', async () => {
    mockRedeem.mockRejectedValueOnce(new RecipientCodeError('no', 'invalid'));

    const res = await POST(makeReq({ code: 'WRONG' }));

    expect(res.status).toBe(400);
    expect(mockRecordFail).toHaveBeenCalledWith('WRONG');
  });

  /*
    `closed` is the case this route exists to render kindly: the release was
    re-armed because the owner checked back in. It is a 400 carrying a reason,
    NOT a 401 and NOT a lockout — a recipient who arrives after the good outcome
    must not be treated as a guesser, and must not be charged an attempt that
    could lock a code they may legitimately need if the alarm recurs.
  */
  it.each([
    ['expired', 400],
    ['used', 400],
    ['closed', 400],
    ['locked', 429],
  ])('reports %s without charging a further miss', async (reason, status) => {
    mockRedeem.mockRejectedValueOnce(new RecipientCodeError('no', reason as never));

    const res = await POST(makeReq({ code: 'SOMECODE' }));

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: 'RecipientCodeError', reason });
    expect(mockRecordFail).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('does not swallow an error that is not a code refusal', async () => {
    mockRedeem.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    await expect(POST(makeReq({ code: 'ABCD-1234' }))).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('POST /api/access/code — the per-address budget', () => {
  it('refuses the eleventh attempt with 429 and a Retry-After', async () => {
    mockRedeem.mockRejectedValue(new RecipientCodeError('no', 'invalid'));

    for (let i = 0; i < 10; i++) await POST(makeReq({ code: `TRY-${i}` }));

    const res = await POST(makeReq({ code: 'TRY-10' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('buckets by client address, so one guesser does not lock out a real recipient', async () => {
    mockRedeem.mockRejectedValue(new RecipientCodeError('no', 'invalid'));

    for (let i = 0; i < 10; i++) await POST(makeReq({ code: `T${i}` }, '203.0.113.5'));
    expect((await POST(makeReq({ code: 'X' }, '203.0.113.5'))).status).toBe(429);
    expect((await POST(makeReq({ code: 'Y' }, '203.0.113.6'))).status).toBe(400);
  });

  /*
    The two code doors must not share a bucket: the prefixes are `rcode` and
    `vcode`. If they collided, ten wrong recipient codes from a household would
    lock the VERIFIER in that same household out of answering — two different
    people, one emergency, one budget.
  */
  it('does not share its budget with the verifier code door', async () => {
    mockRedeem.mockRejectedValue(new RecipientCodeError('no', 'invalid'));
    for (let i = 0; i < 10; i++) await POST(makeReq({ code: `T${i}` }, '203.0.113.9'));
    expect((await POST(makeReq({ code: 'X' }, '203.0.113.9'))).status).toBe(429);

    const { POST: verifyPost } = await import('../../verify/code/route');
    const res = await verifyPost(makeReq({ code: 'V' }, '203.0.113.9'));
    // 400, not 429: a different prefix, therefore a different bucket. Asserted
    // as the exact status rather than `not 429`, because a route that threw
    // would also satisfy `not 429` while proving nothing.
    expect(res.status).toBe(400);
  });
});
