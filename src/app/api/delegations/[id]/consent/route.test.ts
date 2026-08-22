/**
 * Tests for POST /api/delegations/[id]/consent.
 *
 * WHY THIS FILE EXISTS. The handler carries a fixed SECURITY DEFECT in a
 * comment and nothing tested that the fix is still there. Its own words:
 *
 *   🔴 Security review 2026-08-12: this route authenticated a user and then
 *   passed the path id through unscoped, so any signed-in user could activate
 *   anybody's pending delegation. The owner is now part of the WHERE clause
 *   rather than an assumption.
 *
 * That is the whole class this repo keeps meeting — *authenticated* mistaken for
 * *authorised*. The remedy was one argument threaded into `recordConsent`, and
 * one argument is exactly what a refactor drops. The route read 0% statements
 * and 0% branches on 2026-08-22, so the fix had no cover at the layer where it
 * was made; `lib/people/delegation.ts` scoping its query is necessary and not
 * sufficient, because the route is where the scope is SUPPLIED.
 *
 * The other property here is J3-R2: delegation NEVER activates without recorded
 * consent, and consent is obtainable by link, in person or on paper (J3-R3) — so
 * the method list is a closed enum and a parent without a smartphone is not
 * locked out of their own arrangement.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R2, J3-R3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../../lib/people/delegation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/people/delegation')>();
  return { ...actual, recordConsent: vi.fn() };
});

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { recordConsent, CONSENT_METHODS } from '../../../../../../lib/people/delegation';
import { IntegrityError } from '../../../../../../lib/db/integrity';
import { ValidationError } from '../../../../../../lib/validation';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockRecord = vi.mocked(recordConsent);

const OWNER = 'owner-1';
const DELEGATION = 'delegation-9';

function makeReq(body: unknown) {
  return { method: 'POST', headers: new Headers(), json: async () => body } as never;
}
const ctx = { params: Promise.resolve({ id: DELEGATION }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockRecord.mockResolvedValue({ id: DELEGATION, status: 'active' } as never);
});

describe('POST /api/delegations/[id]/consent — the owner is part of the scope', () => {
  /*
    🔴 THE REGRESSION TEST FOR THE 2026-08-12 FINDING. The path id alone is a
    caller-supplied identifier; without `ownerId` travelling with it, any signed-
    in user could name somebody else's pending delegation and activate it. Drop
    the `ownerId:` line from the handler and only this goes red.
  */
  it('passes the signed-in owner alongside the path id, never the path id alone', async () => {
    await POST(makeReq({ method: CONSENT_METHODS[0] }), ctx);

    expect(mockRecord).toHaveBeenCalledWith(
      DELEGATION,
      expect.objectContaining({ ownerId: OWNER }),
    );
  });

  it('takes the owner from the session and not from anything in the body', async () => {
    await POST(makeReq({ method: CONSENT_METHODS[0], ownerId: 'somebody-else' }), ctx);

    const passed = mockRecord.mock.calls[0][1] as { ownerId: string };
    expect(passed.ownerId).toBe(OWNER);
  });

  it('surfaces a scope miss as 403 rather than pretending it succeeded', async () => {
    mockRecord.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'not yours'));

    const res = await POST(makeReq({ method: CONSENT_METHODS[0] }), ctx);
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated caller before recording anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq({ method: CONSENT_METHODS[0] }), ctx);
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('POST /api/delegations/[id]/consent — how consent may be given (J3-R3)', () => {
  it('accepts every method the domain declares', async () => {
    // Iterated from CONSENT_METHODS rather than listed, so adding a method to
    // the enum cannot leave this test silently covering the old set. J3-R3 is
    // the reason the list is plural at all: a parent without a smartphone must
    // still be able to consent, in person or on paper.
    expect(CONSENT_METHODS.length).toBeGreaterThan(1);

    for (const method of CONSENT_METHODS) {
      mockRecord.mockClear();
      const res = await POST(makeReq({ method }), ctx);
      expect(res.status).toBe(200);
      expect(mockRecord).toHaveBeenCalledWith(DELEGATION, expect.objectContaining({ method }));
    }
  });

  it.each([
    ['an unknown method', { method: 'telepathy' }],
    ['a non-string method', { method: 42 }],
    ['no method at all', {}],
    ['a null body', null],
  ])('refuses %s with 400 and records no consent', async (_label, body) => {
    const res = await POST(makeReq(body), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'ValidationError', field: 'method' });
    // J3-R2: delegation NEVER activates without consent. A refusal that still
    // wrote a row would activate one on a method nobody agreed to.
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('carries an evidence reference through, and normalises a non-string to null', async () => {
    await POST(makeReq({ method: CONSENT_METHODS[0], evidenceRef: 'scan-2026-08-22.pdf' }), ctx);
    expect(mockRecord).toHaveBeenCalledWith(
      DELEGATION,
      expect.objectContaining({ evidenceRef: 'scan-2026-08-22.pdf' }),
    );

    mockRecord.mockClear();
    await POST(makeReq({ method: CONSENT_METHODS[0], evidenceRef: { not: 'a string' } }), ctx);
    expect(mockRecord).toHaveBeenCalledWith(
      DELEGATION,
      expect.objectContaining({ evidenceRef: null }),
    );
  });

  it('maps a domain refusal to 400 rather than a 500', async () => {
    mockRecord.mockRejectedValueOnce(
      new ValidationError('That delegation is not awaiting consent.', 'status'),
    );
    const res = await POST(makeReq({ method: CONSENT_METHODS[0] }), ctx);
    expect(res.status).toBe(400);
  });
});
