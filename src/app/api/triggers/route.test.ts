/**
 * Tests for GET /api/triggers and PUT /api/triggers/[id]/config
 *
 * Validates: Requirements 4.1, 5.1, 6.1, 9.1
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/release-list', () => ({
  listReleaseStates: vi.fn(),
  getCheckinInterval: vi.fn(),
  getVerifierCount: vi.fn(),
}));
vi.mock('../../../../lib/release/provisioning', () => ({ setRequiredConfirmations: vi.fn() }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { listReleaseStates, getCheckinInterval, getVerifierCount } from '../../../../lib/release/release-list';
import { setRequiredConfirmations } from '../../../../lib/release/provisioning';
import { ValidationError } from '../../../../lib/validation';
import { GET } from './route';
import { PUT } from './[id]/config/route';

const mockSession = vi.mocked(getOwnerSession);
const mockList = vi.mocked(listReleaseStates);
const mockInterval = vi.mocked(getCheckinInterval);
const mockVerifierCount = vi.mocked(getVerifierCount);
const mockSetN = vi.mocked(setRequiredConfirmations);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: true });
});

it('GET 401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await GET();
  expect(res.status).toBe(401);
});

it('GET returns release states, cadence, and isDemo', async () => {
  mockList.mockResolvedValueOnce([{ id: 'rs', trigger_type: 'emergency', state: 'armed' } as never]);
  mockInterval.mockResolvedValueOnce(30);
  const res = await GET();
  const json = await res.json();
  expect(json.releaseStates).toHaveLength(1);
  expect(json.checkinIntervalDays).toBe(30);
  expect(json.isDemo).toBe(true);
});

it('config PUT 400 on unknown trigger type', async () => {
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: { id: 'bogus' } });
  expect(res.status).toBe(400);
  expect(mockSetN).not.toHaveBeenCalled();
});

it('config PUT sets N against the verifier count (M)', async () => {
  mockVerifierCount.mockResolvedValueOnce(3);
  mockSetN.mockResolvedValueOnce({ required_confirmations: 2 } as never);
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: { id: 'emergency' } });
  expect(res.status).toBe(200);
  expect(mockSetN).toHaveBeenCalledWith('owner-1', 'emergency', 2, 3);
  expect((await res.json()).verifier_count).toBe(3);
});

it('config PUT maps an invalid N-of-M to 400', async () => {
  mockVerifierCount.mockResolvedValueOnce(1);
  mockSetN.mockRejectedValueOnce(new ValidationError('Invalid N-of-M', 'required_confirmations'));
  const res = await PUT(makeReq({ required_confirmations: 5 }), { params: { id: 'emergency' } });
  expect(res.status).toBe(400);
});
