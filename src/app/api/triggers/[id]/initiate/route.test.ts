/**
 * Tests for POST /api/triggers/[type]/initiate
 *
 * Validates: Requirements 4.3, 6.2
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/triggers', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/release/triggers')>();
  return { ...actual, initiateTrigger: vi.fn() };
});
vi.mock('../../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));
vi.mock('../../../../../../lib/people/verifiers', () => ({ listVerifiers: vi.fn(async () => []) }));
vi.mock('../../../../../../lib/notify/notifications', () => ({ notifyVerifiersForTrigger: vi.fn(async () => 0) }));

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { initiateTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { notifyVerifiersForTrigger } from '../../../../../../lib/notify/notifications';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockInitiate = vi.mocked(initiateTrigger);
const mockNotify = vi.mocked(notifyVerifiersForTrigger);

function makeReq() {
  return {} as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST(makeReq(), { params: { id: 'emergency' } });
  expect(res.status).toBe(401);
});

it('400 on an unknown trigger type', async () => {
  const res = await POST(makeReq(), { params: { id: 'apocalypse' } });
  expect(res.status).toBe(400);
  expect(mockInitiate).not.toHaveBeenCalled();
});

it('initiates and notifies verifiers', async () => {
  mockInitiate.mockResolvedValueOnce({ id: 'rs-1', state: 'pending' } as never);
  mockNotify.mockResolvedValueOnce(2);
  const res = await POST(makeReq(), { params: { id: 'emergency' } });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.state).toBe('pending');
  expect(json.verifiersNotified).toBe(2);
  expect(mockNotify).toHaveBeenCalledWith([], 'emergency', 'rs-1');
});

it('409 when the trigger is not ARMED', async () => {
  mockInitiate.mockRejectedValueOnce(new TriggerError('not armed', 409));
  const res = await POST(makeReq(), { params: { id: 'emergency' } });
  expect(res.status).toBe(409);
});
