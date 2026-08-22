/**
 * Tests for /api/people/[id]/confirm (POST, DELETE).
 *
 * WHY THIS FILE EXISTS. 0% statements and 0% branches on 2026-08-22, on what the
 * handler's own header calls "the entire assurance model: one boolean, set out
 * of band". The owner reads a phrase to the person over a channel Relay does not
 * control; POST is *"I spoke to them, it matched"* and DELETE is *"it did not"*.
 * That second half exists because a control which detects an interception and
 * then offers nobody a way to act on it is decoration (sprint plan N14).
 *
 * Both verbs take the person id from the PATH and the person type from the BODY,
 * and both must carry the session's owner id into the scoped UPDATE — the same
 * DSQL-has-no-RLS argument as the rest of this directory. The type is validated
 * by a shared helper that THROWS, and both verbs must map that throw to a 400
 * rather than a 500: a mistyped personType arriving as a server error would read
 * to the owner as "Relay is broken" at the exact moment they are trying to tell
 * it that something is wrong.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../../lib/people/fingerprint', () => ({
  confirmPerson: vi.fn(async () => undefined),
  unconfirmPerson: vi.fn(async () => undefined),
}));

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { confirmPerson, unconfirmPerson } from '../../../../../../lib/people/fingerprint';
import { IntegrityError } from '../../../../../../lib/db/integrity';
import { ValidationError } from '../../../../../../lib/validation';
import { POST, DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockConfirm = vi.mocked(confirmPerson);
const mockUnconfirm = vi.mocked(unconfirmPerson);

const OWNER = 'owner-1';
const PERSON = 'person-4';
const ctx = { params: Promise.resolve({ id: PERSON }) };

function makeReq(body: unknown, method = 'POST') {
  return { method, headers: new Headers(), json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
});

describe('POST /api/people/[id]/confirm — the phrase matched', () => {
  it.each(['recipient', 'verifier'])('confirms a %s scoped to the signed-in owner', async (personType) => {
    mockConfirm.mockClear();
    const res = await POST(makeReq({ personType }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ confirmed: true });
    expect(mockConfirm).toHaveBeenCalledWith({ ownerId: OWNER, personId: PERSON, personType });
  });

  it.each([
    ['an unknown personType', { personType: 'neighbour' }],
    ['a missing personType', {}],
    ['a null body', null],
    ['a non-string personType', { personType: 1 }],
  ])('refuses %s with 400 rather than 500, and confirms nothing', async (_label, body) => {
    const res = await POST(makeReq(body), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'ValidationError',
      field: 'personType',
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before confirming anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq({ personType: 'verifier' }), ctx);
    expect(res.status).toBe(401);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('surfaces a cross-owner person as 403', async () => {
    mockConfirm.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'not yours'));
    const res = await POST(makeReq({ personType: 'verifier' }), ctx);
    expect(res.status).toBe(403);
  });

  it('maps a domain refusal to 400 rather than a 500', async () => {
    mockConfirm.mockRejectedValueOnce(
      new ValidationError('That person has not claimed their account yet.', 'personId'),
    );
    const res = await POST(makeReq({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/people/[id]/confirm — it did not match', () => {
  /*
    🔴 THE REASON IS THE POINT. `unconfirmPerson` takes 'mismatch' or
    'reclaimed', and this route must always send 'mismatch': the owner has just
    said the phrase they read did not come back. 'reclaimed' is the other path —
    a person re-claiming their own row — and the two look identical in the
    person's state while meaning opposite things about whether an interception
    happened. Passing the caller's word through here, or defaulting, would erase
    the only signal the assurance model produces.
  */
  it('records a mismatch, never a reclaim, and always for the signed-in owner', async () => {
    const res = await DELETE(makeReq({ personType: 'verifier' }, 'DELETE'), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ confirmed: false });
    expect(mockUnconfirm).toHaveBeenCalledWith({
      ownerId: OWNER,
      personId: PERSON,
      personType: 'verifier',
      reason: 'mismatch',
    });
  });

  it('ignores a reason supplied in the body', async () => {
    await DELETE(makeReq({ personType: 'verifier', reason: 'reclaimed' }, 'DELETE'), ctx);
    expect(mockUnconfirm).toHaveBeenCalledWith(expect.objectContaining({ reason: 'mismatch' }));
  });

  it.each([
    ['an unknown personType', { personType: 'neighbour' }],
    ['a null body', null],
  ])('refuses %s with 400 and unconfirms nothing', async (_label, body) => {
    const res = await DELETE(makeReq(body, 'DELETE'), ctx);

    expect(res.status).toBe(400);
    expect(mockUnconfirm).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await DELETE(makeReq({ personType: 'verifier' }, 'DELETE'), ctx);
    expect(res.status).toBe(401);
    expect(mockUnconfirm).not.toHaveBeenCalled();
  });
});
