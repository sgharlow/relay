/**
 * Tests for PUT /api/settings
 *
 * Validates: Requirement 4.1
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/release-list', () => ({ updateCheckinInterval: vi.fn() }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { updateCheckinInterval } from '../../../../lib/release/release-list';
import { ValidationError } from '../../../../lib/validation';
import { PUT } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockUpdate = vi.mocked(updateCheckinInterval);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('persists a valid cadence', async () => {
  mockUpdate.mockResolvedValueOnce(45);
  const res = await PUT(makeReq({ checkin_interval_days: 45 }));
  expect(res.status).toBe(200);
  expect((await res.json()).checkin_interval_days).toBe(45);
  expect(mockUpdate).toHaveBeenCalledWith('owner-1', 45);
});

it('maps an out-of-range value to 400', async () => {
  mockUpdate.mockRejectedValueOnce(new ValidationError('1–365', 'checkin_interval_days'));
  const res = await PUT(makeReq({ checkin_interval_days: 999 }));
  expect(res.status).toBe(400);
});
