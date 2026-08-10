/**
 * Tests for the owner-route guard.
 *
 * `requireOwner` catches whatever `getOwnerSession` throws and hands it back to
 * the caller, who checks `isResponse` and returns it. That works for the 401
 * NextResponse it is designed to throw — but the catch is untyped, so ANY other
 * failure (a thrown TypeError, a session backend outage) came back as a
 * non-Response, `isResponse` said false, and the route carried on with
 * `ownerId: undefined`.
 *
 * That is fail-OPEN on an authentication guard. The queries downstream would
 * mostly return nothing for an undefined owner, so it is a fragility rather
 * than a live hole — but the failure direction is the wrong one, and it is
 * three lines to make it structurally impossible.
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../auth/session', () => ({ getOwnerSession: vi.fn() }));

import { getOwnerSession } from '../auth/session';
import { requireOwner, isResponse } from './owner-route';

const mockSession = vi.mocked(getOwnerSession);

beforeEach(() => vi.clearAllMocks());

describe('requireOwner', () => {
  it('returns the owner id for a valid session', async () => {
    mockSession.mockResolvedValue({ ownerId: 'owner-1' } as never);
    const out = await requireOwner();
    expect(isResponse(out)).toBe(false);
    expect(out).toMatchObject({ ownerId: 'owner-1' });
  });

  it('passes through the 401 it is designed to throw', async () => {
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const out = await requireOwner();
    expect(isResponse(out)).toBe(true);
    expect((out as NextResponse).status).toBe(401);
  });

  it('denies rather than proceeding when the session layer throws something else', async () => {
    // The important one. An unexpected failure must not become an
    // unauthenticated request carrying `ownerId: undefined`.
    mockSession.mockRejectedValue(new TypeError('cannot destructure'));
    const out = await requireOwner();
    expect(isResponse(out)).toBe(true);
    expect((out as NextResponse).status).toBe(401);
  });
});
