/**
 * Tests for POST /api/triggers/[id]/confirm
 *
 * Validates: Requirements 6.3–6.6
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/verifier-token', () => ({ verifyVerifierToken: vi.fn() }));
vi.mock('../../../../../../lib/release/triggers', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/release/triggers')>();
  return { ...actual, submitConfirmation: vi.fn() };
});
vi.mock('../../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));
vi.mock('../../../../../../lib/notify/notifications', () => ({ notifyOwnerReleasePendingGraceById: vi.fn(async () => {}) }));

import { verifyVerifierToken } from '../../../../../../lib/auth/verifier-token';
import { submitConfirmation } from '../../../../../../lib/release/triggers';
import { notifyOwnerReleasePendingGraceById } from '../../../../../../lib/notify/notifications';
import { POST } from './route';

const mockVerify = vi.mocked(verifyVerifierToken);
const mockConfirm = vi.mocked(submitConfirmation);
const mockNotify = vi.mocked(notifyOwnerReleasePendingGraceById);

function makeReq(body: unknown = {}, headers: Record<string, string> = {}) {
  return { json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never;
}
const ctx = { params: { id: 'rs-1' } };

beforeEach(() => vi.clearAllMocks());

it('401 when no verifier token is supplied', async () => {
  const res = await POST(makeReq(), ctx);
  expect(res.status).toBe(401);
});

it('403 on an invalid verifier token', async () => {
  mockVerify.mockImplementationOnce(() => {
    throw new Error('bad');
  });
  const res = await POST(makeReq({}, { authorization: 'Bearer junk' }), ctx);
  expect(res.status).toBe(403);
});

it('403 when the token is scoped to a different release', async () => {
  mockVerify.mockReturnValueOnce({ verifierId: 'v1', releaseStateId: 'OTHER', iat: 0, exp: 9e9 });
  const res = await POST(makeReq({}, { authorization: 'Bearer t' }), ctx);
  expect(res.status).toBe(403);
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('200 and records a confirmation', async () => {
  mockVerify.mockReturnValueOnce({ verifierId: 'v1', releaseStateId: 'rs-1', iat: 0, exp: 9e9 });
  mockConfirm.mockResolvedValueOnce({ status: 'recorded', receivedConfirmations: 1, requiredConfirmations: 2, triggerType: 'emergency' });
  const res = await POST(makeReq({ method: 'app' }, { authorization: 'Bearer t' }), ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'recorded', received: 1, required: 2 });
});

it('notifies the owner on pending_grace', async () => {
  mockVerify.mockReturnValueOnce({ verifierId: 'v1', releaseStateId: 'rs-1', iat: 0, exp: 9e9 });
  mockConfirm.mockResolvedValueOnce({
    status: 'pending_grace',
    receivedConfirmations: 2,
    requiredConfirmations: 2,
    triggerType: 'emergency',
    ownerId: 'owner-1',
  });
  await POST(makeReq({}, { authorization: 'Bearer t' }), ctx);
  expect(mockNotify).toHaveBeenCalledWith('owner-1', 'emergency');
});
