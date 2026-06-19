/**
 * Tests for POST /api/triggers/[id]/cancel
 *
 * Validates: Requirement 5.3
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/triggers', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/release/triggers')>();
  return { ...actual, cancelTrigger: vi.fn() };
});
vi.mock('../../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { cancelTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockCancel = vi.mocked(cancelTrigger);

const ctx = { params: { id: 'rs-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('cancels a reversible GRACE trigger', async () => {
  mockCancel.mockResolvedValueOnce({ state: 'cancelled' } as never);
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(200);
  expect((await res.json()).state).toBe('cancelled');
  expect(mockCancel).toHaveBeenCalledWith('owner-1', 'rs-1', expect.anything());
});

it('409 when the trigger cannot be cancelled (estate / not GRACE)', async () => {
  mockCancel.mockRejectedValueOnce(new TriggerError('cannot cancel', 409));
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(409);
});

it('403 on a cross-owner cancel', async () => {
  mockCancel.mockRejectedValueOnce(new TriggerError('not authorized', 403));
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(403);
});
