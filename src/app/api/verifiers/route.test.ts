/**
 * Tests for /api/verifiers (collection) and /api/verifiers/[id]
 *
 * Validates: Requirements 3.2, 3.7
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/people/verifiers', async (io) => {
  const actual = await io<typeof import('../../../../lib/people/verifiers')>();
  return { ...actual, listVerifiers: vi.fn(), createVerifier: vi.fn(), updateVerifier: vi.fn(), deleteVerifier: vi.fn() };
});

import { getOwnerSession } from '../../../../lib/auth/session';
import { createVerifier, deleteVerifier } from '../../../../lib/people/verifiers';
import { POST } from './route';
import { DELETE } from './[id]/route';

const mockSession = vi.mocked(getOwnerSession);
const mockCreate = vi.mocked(createVerifier);
const mockDelete = vi.mocked(deleteVerifier);

function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('POST 400 on a bad email', async () => {
  const res = await POST(makeReq({ name: 'Dr Lee', email: 'not-an-email' }));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 201 on a valid verifier', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'v1' } as never);
  const res = await POST(makeReq({ name: 'Dr Lee', email: 'lee@example.com' }));
  expect(res.status).toBe(201);
});

it('DELETE removes confirmations + verifier', async () => {
  mockDelete.mockResolvedValueOnce(undefined);
  const res = await DELETE(makeReq(), { params: { id: 'v1' } });
  expect(res.status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('owner-1', 'v1');
});
