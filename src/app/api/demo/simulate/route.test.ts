/**
 * Tests for POST /api/demo/simulate
 *
 * Validates: Requirements 9.1, 9.2, 9.7
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/simulate', () => ({ runSimulation: vi.fn() }));
vi.mock('../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { runSimulation } from '../../../../../lib/release/simulate';
import { TriggerError } from '../../../../../lib/release/triggers';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockRun = vi.mocked(runSimulation);

function makeReq(body: unknown = {}) {
  return { json: async () => body } as never;
}

beforeEach(() => vi.clearAllMocks());

it('401 when unauthenticated (no state touched)', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST(makeReq());
  expect(res.status).toBe(401);
  expect(mockRun).not.toHaveBeenCalled();
});

it('403 for a non-demo account BEFORE any state is read (Req 9.1)', async () => {
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
  const res = await POST(makeReq());
  expect(res.status).toBe(403);
  expect(mockRun).not.toHaveBeenCalled();
});

it('400 on an unknown trigger type', async () => {
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: true });
  const res = await POST(makeReq({ trigger_type: 'apocalypse' }));
  expect(res.status).toBe(400);
  expect(mockRun).not.toHaveBeenCalled();
});

/*
  🔴 THIS ROUTE VALIDATED AGAINST THE OPEN LIST, closed 2026-08-21. It imported
  `VALID_TRIGGER_TYPES` — the DOMAIN enum, which still contains `estate` for
  compatibility with rows written before the withdrawal — while every other
  release-starting boundary uses the CLOSED list `USER_SELECTABLE_TRIGGER_TYPES`
  (rules, policies, initiate, config, the dropdown).

  Harmless in practice today: the route is demo-gated and the seed types its
  release states as `UserSelectableTriggerType`, so `runSimulation` would 404
  before doing anything. That is a defence-in-depth gap held shut by two
  circumstances rather than by a rule — and this is a route that drives ARMED →
  RELEASED on a NON-REVERSIBLE trigger. The portfolio rule is structural safety
  over convention: the closed list is the only list a release-starting route
  consults.
*/
it('400 on estate — the closed list is the only list this route consults', async () => {
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: true });
  const res = await POST(makeReq({ trigger_type: 'estate' }));
  expect(res.status).toBe(400);
  expect(mockRun).not.toHaveBeenCalled();
});

it('runs the simulation for a demo account and returns the state sequence', async () => {
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: true });
  mockRun.mockResolvedValueOnce({ releaseStateId: 'rs-1', states: ['pending', 'grace', 'released'] });
  const res = await POST(makeReq({ trigger_type: 'emergency' }));
  expect(res.status).toBe(200);
  expect((await res.json()).states).toEqual(['pending', 'grace', 'released']);
  expect(mockRun).toHaveBeenCalledOnce();
});

it('409 when the trigger is not ARMED (Req 9.7)', async () => {
  mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: true });
  mockRun.mockRejectedValueOnce(new TriggerError('not armed', 409));
  const res = await POST(makeReq());
  expect(res.status).toBe(409);
});
