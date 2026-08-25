/**
 * Tests for POST /api/verify/code — a typed code exchanged for a verifier session.
 *
 * WHY THIS FILE EXISTS. This is one of the two PUBLIC, UNAUTHENTICATED doors
 * into a live release (the other is /api/access/code), and on 2026-08-22 it read
 * 0% statements and 0% branches: the handler's own defences — the per-IP budget,
 * the per-code lockout, the refusal to mint on any failure — had never been
 * executed by the suite. `lib/auth/verifier-code.ts` was covered; the door was
 * not. Its header names four defences and this file is the first thing that
 * checks the door applies them in the order it claims.
 *
 * The ordering IS the property. The limiter is consulted before the body is
 * read, and `recordFailedAttempt` is called only for `invalid` — so a guesser
 * who has already tripped the per-code lockout cannot keep charging attempts
 * into it, and a merely-expired code does not accumulate a lockout against the
 * verifier who was slow to open their email.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/verifier-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/auth/verifier-code')>();
  return { ...actual, redeemVerifierCode: vi.fn(), recordFailedAttempt: vi.fn(async () => undefined) };
});
vi.mock('../../../../../lib/auth/verifier-token', () => ({ issueVerifierToken: vi.fn() }));

import {
  redeemVerifierCode,
  recordFailedAttempt,
  VerifierCodeError,
} from '../../../../../lib/auth/verifier-code';
import { issueVerifierToken } from '../../../../../lib/auth/verifier-token';
import { _resetRateLimitForTesting } from '../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockRedeem = vi.mocked(redeemVerifierCode);
const mockRecordFail = vi.mocked(recordFailedAttempt);
const mockIssue = vi.mocked(issueVerifierToken);

function makeReq(body: unknown, ip = '198.51.100.7') {
  return {
    method: 'POST',
    headers: new Headers({ 'x-forwarded-for': ip }),
    json: async () => body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTesting();
  mockIssue.mockResolvedValue('verifier-jwt');
});

describe('POST /api/verify/code — redemption', () => {
  it('mints a verifier token scoped to the release the code names', async () => {
    mockRedeem.mockResolvedValueOnce({ verifierId: 'v-1', releaseStateId: 'rs-1' } as never);

    const res = await POST(makeReq({ code: 'ABCD-1234' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: 'verifier-jwt' });
    // The pair comes from the redemption, never from the request — a token
    // scoped by anything the caller supplied would let a valid code answer for
    // a release it was not issued against.
    expect(mockIssue).toHaveBeenCalledWith('v-1', 'rs-1');
  });

  it('passes the code through as typed, so the redeemer owns any normalising', async () => {
    mockRedeem.mockResolvedValueOnce({ verifierId: 'v-1', releaseStateId: 'rs-1' } as never);
    await POST(makeReq({ code: ' abcd-1234 ' }));
    expect(mockRedeem).toHaveBeenCalledWith(' abcd-1234 ');
  });
});

describe('POST /api/verify/code — refusals', () => {
  it.each([
    ['a missing code', {}],
    ['a null body', null],
    ['a non-string code', { code: 123456 }],
    ['whitespace only', { code: '   ' }],
  ])('refuses %s with 400 before touching the redeemer', async (_label, body) => {
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'BadRequest' });
    expect(mockRedeem).not.toHaveBeenCalled();
    expect(mockRecordFail).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('reports an invalid code as 400 and charges the miss against the code itself', async () => {
    mockRedeem.mockRejectedValueOnce(new VerifierCodeError('That code is not right.', 'invalid'));

    const res = await POST(makeReq({ code: 'WRONG' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ reason: 'invalid' });
    // Per-code, so an attacker rotating source addresses against ONE known code
    // still runs into a lockout. The per-IP budget alone would not stop that.
    expect(mockRecordFail).toHaveBeenCalledWith('WRONG');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  /*
    Only `invalid` is charged. A verifier who opens their email a day late, or
    who clicks the same link twice, is not a guesser — accumulating lockout
    against them would silence a real verifier at the moment their answer is
    needed, which is the failure this product can least afford.
  */
  it.each([
    ['expired', 400],
    ['used', 400],
    ['locked', 429],
  ])('reports %s without charging a further miss', async (reason, status) => {
    mockRedeem.mockRejectedValueOnce(new VerifierCodeError('no', reason as never));

    const res = await POST(makeReq({ code: 'SOMECODE' }));

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: 'VerifierCodeError', reason });
    expect(mockRecordFail).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('does not swallow an error that is not a code refusal', async () => {
    mockRedeem.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    // An outage must not be reported to a verifier as a bad code: they would
    // retype it until the per-code lockout closed the door on a valid one.
    await expect(POST(makeReq({ code: 'ABCD-1234' }))).rejects.toThrow(/ECONNREFUSED/);
    expect(mockRecordFail).not.toHaveBeenCalled();
  });
});

describe('POST /api/verify/code — the per-address budget', () => {
  it('refuses the eleventh attempt in the window with 429 and a Retry-After', async () => {
    mockRedeem.mockRejectedValue(new VerifierCodeError('no', 'invalid'));

    for (let i = 0; i < 10; i++) {
      expect((await POST(makeReq({ code: `TRY-${i}` }))).status).toBe(400);
    }

    const res = await POST(makeReq({ code: 'TRY-10' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    await expect(res.json()).resolves.toMatchObject({ error: 'RateLimited' });
  });

  it('spends the budget before the body is read, so a malformed post is not free', async () => {
    for (let i = 0; i < 10; i++) await POST(makeReq({}));
    const res = await POST(makeReq({ code: 'ABCD-1234' }));
    expect(res.status).toBe(429);
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('buckets by client address, so one guesser does not lock out every verifier', async () => {
    mockRedeem.mockRejectedValue(new VerifierCodeError('no', 'invalid'));

    for (let i = 0; i < 10; i++) await POST(makeReq({ code: `TRY-${i}` }, '203.0.113.1'));
    expect((await POST(makeReq({ code: 'X' }, '203.0.113.1'))).status).toBe(429);

    // A different verifier, mid-emergency, must still be able to answer.
    expect((await POST(makeReq({ code: 'Y' }, '203.0.113.2'))).status).toBe(400);
  });

  /*
    `clientKey` falls back to a SHARED `unknown` bucket when no forwarding
    header is present — deliberately conservative, per its own header. Pinned
    here because the tempting "fix" is to let an unidentifiable client through
    unbounded, which turns the budget off for exactly the caller most likely to
    be stripping headers.
  */
  it('limits unidentifiable clients together rather than exempting them', async () => {
    mockRedeem.mockRejectedValue(new VerifierCodeError('no', 'invalid'));
    const anon = () =>
      ({ method: 'POST', headers: new Headers(), json: async () => ({ code: 'Z' }) }) as never;

    for (let i = 0; i < 10; i++) await POST(anon());
    expect((await POST(anon())).status).toBe(429);
  });
});
