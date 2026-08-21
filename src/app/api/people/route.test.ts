/**
 * Tests for POST /api/people — the single add-a-person entry (J4-R1).
 *
 * The circle screen used to post to `/api/recipients` OR `/api/verifiers`, which
 * is why naming one human as both took two submissions and produced two rows.
 * This route takes the person once and materialises whichever rows are missing.
 *
 * Validates: Requirements J4-R1, 3.1, 3.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/people/add-person', async (io) => {
  const actual = await io<typeof import('../../../../lib/people/add-person')>();
  return { ...actual, addPerson: vi.fn() };
});
vi.mock('../../../../lib/people/invite', () => ({
  inviteOnCreateBestEffort: vi.fn(async () => undefined),
}));

import { getOwnerSession } from '../../../../lib/auth/session';
import { addPerson } from '../../../../lib/people/add-person';
import { inviteOnCreateBestEffort } from '../../../../lib/people/invite';
import { EntitlementError } from '../../../../lib/billing/entitlements';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockAdd = vi.mocked(addPerson);
const mockInvite = vi.mocked(inviteOnCreateBestEffort);

function makeReq(body?: unknown) {
  return { method: 'POST', json: async () => body } as never;
}

const both = {
  name: 'Sam',
  email: 'sam@example.com',
  role: 'recipient',
  roles: { recipient: true, verifier: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false } as never);
  mockAdd.mockResolvedValue({
    name: 'Sam',
    email: 'sam@example.com',
    recipient: { id: 'r-new', created: true },
    verifier: { id: 'v-new', created: true },
    createdAnything: true,
  });
});

describe('POST /api/people', () => {
  it('401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const res = await POST(makeReq(both));
    expect(res.status).toBe(401);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('201, and adds the person exactly once for both hats', async () => {
    const res = await POST(makeReq(both));

    expect(res.status).toBe(201);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0]).toBe('owner-1');
    expect(mockAdd.mock.calls[0][1].roles).toEqual({ recipient: true, verifier: true });
    expect(await res.json()).toMatchObject({ createdAnything: true });
  });

  it('400 when no role was chosen — that submission would do nothing', async () => {
    const res = await POST(makeReq({ ...both, roles: { recipient: false, verifier: false } }));

    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('402 when a plan ceiling refuses it, like its two siblings do', async () => {
    mockAdd.mockRejectedValueOnce(new EntitlementError('The free plan allows 3', 3, 'free'));

    const res = await POST(makeReq(both));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'EntitlementError', limit: 3 });
  });
});

describe('the invitation follows the ROW, not the submission', () => {
  it('introduces each newly created row', async () => {
    await POST(makeReq(both));

    expect(mockInvite.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['r-new', 'recipient'],
      ['v-new', 'verifier'],
    ]);
  });

  /*
    🔴 THE HALF THAT WOULD HAVE BEEN A NEW DEFECT. Adding the second hat to
    somebody already in the circle must not re-introduce them: the existing row
    may already be claimed and confirmed, and `inviteAndNotify` mints a FRESH
    30-day claim token every time it is called. Sending one to a person who has
    already accepted hands a live credential to an address for a slot that is
    already bound, and tells them to accept something they accepted months ago.
  */
  it('never re-introduces a row that already existed', async () => {
    mockAdd.mockResolvedValueOnce({
      name: 'Sam',
      email: 'sam@example.com',
      recipient: { id: 'r-existing', created: false },
      verifier: { id: 'v-new', created: true },
      createdAnything: true,
    });

    await POST(makeReq(both));

    expect(mockInvite).toHaveBeenCalledTimes(1);
    expect(mockInvite.mock.calls[0][1]).toBe('v-new');
  });

  it('sends nothing at all when the submission created nothing', async () => {
    mockAdd.mockResolvedValueOnce({
      name: 'Sam',
      email: 'sam@example.com',
      recipient: { id: 'r-existing', created: false },
      verifier: { id: 'v-existing', created: false },
      createdAnything: false,
    });

    const res = await POST(makeReq(both));

    expect(mockInvite).not.toHaveBeenCalled();
    // 200, not 201: nothing was created, and the status line must not say it was.
    expect(res.status).toBe(200);
  });
});
