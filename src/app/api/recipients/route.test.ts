/**
 * Tests for /api/recipients (collection) and /api/recipients/[id]
 *
 * Validates: Requirements 3.1, 3.6
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/people/recipients', async (io) => {
  const actual = await io<typeof import('../../../../lib/people/recipients')>();
  return { ...actual, listRecipients: vi.fn(), createRecipient: vi.fn(), updateRecipient: vi.fn(), deleteRecipient: vi.fn() };
});

vi.mock('../../../../lib/billing/entitlements', async (io) => {
  const actual = await io<typeof import('../../../../lib/billing/entitlements')>();
  return { ...actual, assertWithinRecipientCap: vi.fn(async () => undefined) };
});

import { getOwnerSession } from '../../../../lib/auth/session';
import { listRecipients, createRecipient, updateRecipient, deleteRecipient } from '../../../../lib/people/recipients';
import { GET, POST } from './route';
import { PUT, DELETE } from './[id]/route';

const mockSession = vi.mocked(getOwnerSession);
const mockList = vi.mocked(listRecipients);
const mockCreate = vi.mocked(createRecipient);
const mockUpdate = vi.mocked(updateRecipient);
const mockDelete = vi.mocked(deleteRecipient);

function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}
const ctx = { params: { id: 'r1' } };
const valid = { name: 'Sam', email: 'sam@example.com', role: 'executor' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('GET 401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await GET();
  expect(res.status).toBe(401);
});

it('GET lists recipients', async () => {
  mockList.mockResolvedValueOnce([{ id: 'r1' } as never]);
  const res = await GET();
  expect((await res.json()).recipients).toEqual([{ id: 'r1' }]);
});

it('POST 400 on invalid role', async () => {
  const res = await POST(makeReq({ ...valid, role: 'boss' }));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 201 on valid recipient', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'r1' } as never);
  const res = await POST(makeReq(valid));
  expect(res.status).toBe(201);
});

it('PUT 404 when recipient is not owned', async () => {
  mockUpdate.mockResolvedValueOnce(null);
  const res = await PUT(makeReq(valid), ctx);
  expect(res.status).toBe(404);
});

it('DELETE cascades and returns deleted', async () => {
  mockDelete.mockResolvedValueOnce(undefined);
  const res = await DELETE(makeReq(), ctx);
  expect(res.status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('owner-1', 'r1');
});

it('POST 402 when the free-tier recipient cap is reached', async () => {
  const { assertWithinRecipientCap, EntitlementError } = await import(
    '../../../../lib/billing/entitlements'
  );
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
  vi.mocked(assertWithinRecipientCap).mockRejectedValueOnce(
    new EntitlementError('The free plan allows 1 recipient.', 1, 'free'),
  );

  const res = await POST(makeReq(valid));

  expect(res.status).toBe(402);
  await expect(res.json()).resolves.toMatchObject({ error: 'EntitlementError', tier: 'free' });
  expect(mockCreate).not.toHaveBeenCalled();
});
