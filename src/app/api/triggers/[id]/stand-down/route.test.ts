/**
 * Tests for POST /api/triggers/[id]/stand-down
 *
 * The behaviour under test is not "does it stand down" — `standDownTrigger` is
 * covered in lib/release/triggers.test.ts — it is that standing a release down
 * COUNTS AS BEING ALIVE. See the note in route.ts.
 *
 * Validates: Requirements 5.3, 4.2, J5-R1
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
  isDeliberate: (m: string) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m),
}));
vi.mock('../../../../../../lib/release/triggers', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/release/triggers')>();
  return { ...actual, standDownTrigger: vi.fn() };
});
vi.mock('../../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { recordDeliberateActivity } from '../../../../../../lib/release/liveness';
import { standDownTrigger, TriggerError } from '../../../../../../lib/release/triggers';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockStandDown = vi.mocked(standDownTrigger);
const mockLiveness = vi.mocked(recordDeliberateActivity);

const ctx = { params: Promise.resolve({ id: 'rs-1' }) };
const req = { method: 'POST' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('stands a reversible release down to ARMED', async () => {
  mockStandDown.mockResolvedValueOnce({ state: 'armed' } as never);
  const res = await POST(req, ctx);
  expect(res.status).toBe(200);
  expect((await res.json()).state).toBe('armed');
  expect(mockStandDown).toHaveBeenCalledWith('owner-1', 'rs-1', expect.anything());
});

/*
  🔴 THE REGRESSION THIS PINS. Until 2026-08-21 this route called
  `requireOwner()` with no argument, so it recorded no liveness — and
  `standDownTrigger` does not stamp `last_active_at` either. An owner who went
  quiet past their interval, got armed by the sweep, came back and pressed
  "Stand down — re-arm" was STILL overdue: the row went back to ARMED, and the
  top of the next hour armed it again and re-emailed every verifier. Hourly,
  until they happened to press the other button.

  Standing down a false alarm is the strongest "I am here" signal in the
  product. It has to count as one.
*/
it('records the stand-down as deliberate liveness so the sweep does not re-arm', async () => {
  mockStandDown.mockResolvedValueOnce({ state: 'armed' } as never);
  await POST(req, ctx);
  expect(mockLiveness).toHaveBeenCalledWith({ userId: 'owner-1', method: 'POST' });
});

it('409 when the trigger is not in a stand-downable state', async () => {
  mockStandDown.mockRejectedValueOnce(new TriggerError('not standable', 409));
  const res = await POST(req, ctx);
  expect(res.status).toBe(409);
});

it('403 on a cross-owner stand-down', async () => {
  mockStandDown.mockRejectedValueOnce(new TriggerError('not authorized', 403));
  const res = await POST(req, ctx);
  expect(res.status).toBe(403);
});
