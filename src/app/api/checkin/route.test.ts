/**
 * Tests for PUT /api/checkin
 *
 * Validates: Requirements 4.2, 4.5
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/heartbeat', () => ({ processCheckin: vi.fn() }));
vi.mock('../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { processCheckin } from '../../../../lib/release/heartbeat';
import { PUT } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockCheckin = vi.mocked(processCheckin);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await PUT();
  expect(res.status).toBe(401);
  expect(mockCheckin).not.toHaveBeenCalled();
});

it('200 with the reset list when nothing is blocked', async () => {
  mockCheckin.mockResolvedValueOnce({ reset: ['emergency'], blocked: [] });
  const res = await PUT();
  expect(res.status).toBe(200);
  expect((await res.json())).toEqual({ checkedIn: true, reset: ['emergency'] });
});

it('409 when an estate trigger cannot be reversed (Req 4.5)', async () => {
  mockCheckin.mockResolvedValueOnce({ reset: [], blocked: ['estate'] });
  const res = await PUT();
  expect(res.status).toBe(409);
  const json = await res.json();
  expect(json.error).toBe('IrreversibleRelease');
  expect(json.blocked).toEqual(['estate']);
});
