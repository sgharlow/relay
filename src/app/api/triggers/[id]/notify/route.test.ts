/**
 * Tests for POST /api/triggers/[id]/notify
 *
 * Validates: Requirements 7.1, 15.2
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/triggers', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/release/triggers')>();
  return { ...actual, resendReleaseNotifications: vi.fn() };
});

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { resendReleaseNotifications, TriggerError } from '../../../../../../lib/release/triggers';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockResend = vi.mocked(resendReleaseNotifications);
const ctx = { params: { id: 'rs-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(401);
});

it('returns the notified count', async () => {
  mockResend.mockResolvedValueOnce(3);
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(200);
  expect((await res.json()).notified).toBe(3);
  expect(mockResend).toHaveBeenCalledWith('owner-1', 'rs-1');
});

it('maps 409 (not released) from the TriggerError', async () => {
  mockResend.mockRejectedValueOnce(new TriggerError('Release is not active', 409));
  const res = await POST({} as never, ctx);
  expect(res.status).toBe(409);
});
