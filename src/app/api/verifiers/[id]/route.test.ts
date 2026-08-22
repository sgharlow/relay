/**
 * Tests for /api/verifiers/[id] (PUT, DELETE).
 *
 * WHY THIS FILE EXISTS. It read 26% statements and 12.5% branches on 2026-08-22
 * — the lowest of any route that had *any* cover at all, and the covered part
 * was incidental. DELETE here is not a tidy-up: `deleteVerifier` withdraws the
 * person's outstanding ATTESTATIONS and removes their confirmations (Req 3.7)
 * before the row goes, because a quorum counted from confirmations belonging to
 * a verifier who is no longer in the circle is a release opened by a ghost. The
 * route is where the owner id that scopes all of that is supplied.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.2, 3.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/people/verifiers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/people/verifiers')>();
  return { ...actual, updateVerifier: vi.fn(), deleteVerifier: vi.fn(async () => undefined) };
});

import { getOwnerSession } from '../../../../../lib/auth/session';
import { updateVerifier, deleteVerifier } from '../../../../../lib/people/verifiers';
import { PUT, DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockUpdate = vi.mocked(updateVerifier);
const mockDelete = vi.mocked(deleteVerifier);

const OWNER = 'owner-1';
const VERIFIER = 'verifier-2';
const ctx = { params: Promise.resolve({ id: VERIFIER }) };

function makeReq(body: unknown) {
  return { method: 'PUT', headers: new Headers(), json: async () => body } as never;
}

const VALID = { name: 'Dr Amara Okoye', email: 'amara@example.org' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockUpdate.mockResolvedValue({ id: VERIFIER, ...VALID } as never);
});

describe('PUT /api/verifiers/[id]', () => {
  it('updates scoped to the signed-in owner', async () => {
    const res = await PUT(makeReq(VALID), ctx);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(OWNER, VERIFIER, expect.objectContaining(VALID));
  });

  it('answers 404 when the scoped update matches nothing', async () => {
    mockUpdate.mockResolvedValueOnce(null);
    const res = await PUT(makeReq(VALID), ctx);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'NotFound' });
  });

  it.each([
    ['an invalid email', { name: 'A', email: 'nope' }],
    ['a missing name', { email: 'amara@example.org' }],
    ['a null body', null],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const res = await PUT(makeReq(body), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  /*
    A verifier's name is interpolated into mail Relay sends from its own domain
    — `cleanPersonName` exists for that reason (`ratified.outbound-mail-bounds`:
    the name lands in the message body, and the owner's display name in the
    SUBJECT). A newline here is a header-injection attempt; the route must reach
    the cleaner, not carry the raw value through.
  */
  it('passes the name through the cleaner rather than storing it raw', async () => {
    await PUT(makeReq({ name: 'Amara\nBcc: attacker@example.net', email: 'a@example.org' }), ctx);

    const passed = mockUpdate.mock.calls[0][2] as { name: string };
    expect(passed.name).not.toContain('\n');
  });

  it('refuses an unauthenticated caller before reading the body', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await PUT(makeReq(VALID), ctx);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/verifiers/[id]', () => {
  it('deletes scoped to the signed-in owner', async () => {
    const res = await DELETE({} as never, ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    // Without the owner id the module would withdraw attestations and remove
    // confirmations belonging to somebody else's verifier.
    expect(mockDelete).toHaveBeenCalledWith(OWNER, VERIFIER);
  });

  it('refuses an unauthenticated caller without withdrawing anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await DELETE({} as never, ctx);
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
