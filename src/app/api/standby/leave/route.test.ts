/**
 * Tests for POST /api/standby/leave — resign from a circle, or reject an invitation.
 *
 * WHY THIS FILE EXISTS. 0% statements and 0% branches on 2026-08-22, on the
 * route that implements J4-R13 — a standby account is a free user with rights,
 * and leaving is the most basic of them.
 *
 * 🔴 THE PROPERTY THE HANDLER CANNOT STATE FOR ITSELF: the caller's own user id
 * is the ONLY identity that reaches `resignFromCircle`. Its guard IS its
 * authorization — `WHERE id = $1 AND claimed_user_id = $2` means you can only
 * unbind a row currently bound to you — so a route that passed anything from the
 * body as `userId` would let one standby contact resign another out of a
 * stranger's circle. This is the same shape as the account takeover closed on
 * 2026-08-21, where `existingUserId` was declared as a *credential* and read
 * from the request. Identity comes from the session; a test says so.
 *
 * The second property is a product one and easy to lose in a refactor:
 * `rejected` and `resigned` are recorded DISTINCTLY. "I do not know this person"
 * may mean an invitation reached the wrong inbox — a different thing for an
 * owner to learn than "I am stepping down" — and the handler's mapping is a
 * ternary that defaults to `resigned`, so anything unrecognised must land there
 * rather than being passed on.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/people/resign', () => ({ resignFromCircle: vi.fn() }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { resignFromCircle } from '../../../../../lib/people/resign';
import { ValidationError } from '../../../../../lib/validation';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockResign = vi.mocked(resignFromCircle);

const CALLER = 'standby-user-1';

function makeReq(body: unknown) {
  return { method: 'POST', headers: new Headers(), json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: CALLER } as never);
  mockResign.mockResolvedValue({ ownerId: 'the-owner' } as never);
});

describe('POST /api/standby/leave — identity comes from the session', () => {
  it('resigns as the signed-in user, never as anybody the body names', async () => {
    const res = await POST(
      makeReq({
        personId: 'recipient-9',
        personType: 'recipient',
        // Every plausible spelling an attacker would try. None may be read.
        userId: 'somebody-else',
        claimed_user_id: 'somebody-else',
        existingUserId: 'somebody-else',
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ left: true });
    expect(mockResign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CALLER, personId: 'recipient-9', personType: 'recipient' }),
    );
  });

  it('refuses an unauthenticated caller before unbinding anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq({ personId: 'r-1', personType: 'recipient' }));
    expect(res.status).toBe(401);
    expect(mockResign).not.toHaveBeenCalled();
  });

  /*
    The module refuses with a ValidationError when the row is not bound to this
    caller — that is the authorization firing, and it must surface as a 400
    carrying its field rather than as a 500. A 500 here would read as an outage
    to a person who is simply not entitled to leave that row.
  */
  it('surfaces "not yours to leave" as a 400, not a 500', async () => {
    mockResign.mockRejectedValueOnce(
      new ValidationError('That standby role is not yours to leave.', 'personId'),
    );

    const res = await POST(makeReq({ personId: 'not-mine', personType: 'verifier' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'ValidationError',
      field: 'personId',
    });
  });
});

describe('POST /api/standby/leave — which of the two it was', () => {
  it('records an explicit rejection as `rejected`', async () => {
    await POST(makeReq({ personId: 'r-1', personType: 'recipient', reason: 'rejected' }));
    expect(mockResign).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rejected' }));
  });

  it.each([
    ['no reason', undefined],
    ['an explicit resignation', 'resigned'],
    ['an unrecognised reason', 'because-i-said-so'],
    ['a non-string reason', 42],
  ])('records %s as `resigned`', async (_label, reason) => {
    await POST(makeReq({ personId: 'r-1', personType: 'recipient', reason }));
    expect(mockResign).toHaveBeenCalledWith(expect.objectContaining({ reason: 'resigned' }));
  });
});

describe('POST /api/standby/leave — refusals', () => {
  it.each([
    ['a missing personId', { personType: 'recipient' }],
    ['a non-string personId', { personId: 7, personType: 'recipient' }],
    ['a missing personType', { personId: 'r-1' }],
    ['an unknown personType', { personId: 'r-1', personType: 'executor' }],
    ['a null body', null],
  ])('refuses %s with 400 and unbinds nothing', async (_label, body) => {
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'ValidationError',
      field: 'personId',
    });
    expect(mockResign).not.toHaveBeenCalled();
  });

  it('accepts both person types and only those two', async () => {
    for (const personType of ['recipient', 'verifier']) {
      mockResign.mockClear();
      expect((await POST(makeReq({ personId: 'p-1', personType }))).status).toBe(200);
      expect(mockResign).toHaveBeenCalledWith(expect.objectContaining({ personType }));
    }
  });
});
