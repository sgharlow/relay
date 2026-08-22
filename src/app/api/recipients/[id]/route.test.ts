/**
 * Tests for /api/recipients/[id] (PUT, DELETE).
 *
 * WHY THIS FILE EXISTS. 0% statements and 0% branches on 2026-08-22 — and this
 * is the door onto the cascade that `lib/people/recipients.ts` describes as the
 * fix for J4-R15: deleting a recipient removes their POLICIES first, because
 * removing only the rules would leave the generating policy behind and the next
 * materialisation would recreate grants for a person who no longer exists. That
 * cascade is tested at the module. What was untested is that the route reaches
 * it with the owner id attached.
 *
 * The 404-vs-403 shape here differs from /api/vault/items/[id] ON PURPOSE and
 * the difference is worth pinning rather than tidying. A vault item answers 403
 * for both not-found and cross-owner, because item ids are the thing an attacker
 * would enumerate (Requirement 1.8). A recipient row is created by the owner
 * from a form and named in their own roster; the update returns null when the
 * scoped UPDATE matches nothing, and the route says 404. What matters is that
 * `updateRecipient` is never called without the owner id, which is what makes
 * "matched nothing" mean "not yours OR not there" rather than "not there".
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1, 3.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/people/recipients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/people/recipients')>();
  return { ...actual, updateRecipient: vi.fn(), deleteRecipient: vi.fn(async () => undefined) };
});

import { getOwnerSession } from '../../../../../lib/auth/session';
import { updateRecipient, deleteRecipient } from '../../../../../lib/people/recipients';
import { PUT, DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockUpdate = vi.mocked(updateRecipient);
const mockDelete = vi.mocked(deleteRecipient);

const OWNER = 'owner-1';
const RECIPIENT = 'recipient-3';
const ctx = { params: Promise.resolve({ id: RECIPIENT }) };

function makeReq(body: unknown) {
  return { method: 'PUT', headers: new Headers(), json: async () => body } as never;
}

const VALID = {
  name: 'Sarah Chen',
  email: 'sarah@example.org',
  relationship: 'daughter',
  role: 'caregiver',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockUpdate.mockResolvedValue({ id: RECIPIENT, ...VALID } as never);
});

describe('PUT /api/recipients/[id]', () => {
  it('updates scoped to the signed-in owner and returns the updated row', async () => {
    const res = await PUT(makeReq(VALID), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: RECIPIENT });
    expect(mockUpdate).toHaveBeenCalledWith(OWNER, RECIPIENT, expect.objectContaining(VALID));
  });

  it('validates before it writes, and names the field it refused', async () => {
    const res = await PUT(makeReq({ ...VALID, email: 'not-an-email' }), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'ValidationError' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 when the scoped update matches nothing', async () => {
    mockUpdate.mockResolvedValueOnce(null);
    const res = await PUT(makeReq(VALID), ctx);
    expect(res.status).toBe(404);
  });

  it('refuses an unauthenticated caller before reading the body', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await PUT(makeReq(VALID), ctx);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses a null body rather than throwing (readJson normalises it)', async () => {
    const res = await PUT(makeReq(null), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/recipients/[id]', () => {
  it('deletes scoped to the signed-in owner', async () => {
    const res = await DELETE({} as never, ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    // The module cascades policies before rules (J4-R15); the route's job is to
    // hand it the owner, without which the cascade would run on somebody else's
    // recipient.
    expect(mockDelete).toHaveBeenCalledWith(OWNER, RECIPIENT);
  });

  it('refuses an unauthenticated caller without cascading anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await DELETE({} as never, ctx);
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
