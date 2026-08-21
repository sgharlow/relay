/**
 * Tests for POST /api/ai/intake
 *
 * Validates: Requirements 11.1, 11.9
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/ai/intake-agent', () => ({ runIntake: vi.fn() }));
// The route now reserves against a daily ceiling before it spends money at the
// AI seam. Mocked here so this file keeps testing the handler's own decisions;
// the ceiling itself is covered by lib/ai/intake-budget.test.ts.
vi.mock('../../../../../lib/ai/intake-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/ai/intake-budget')>()),
  reserveIntakeRun: vi.fn(async () => {}),
}));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { runIntake } from '../../../../../lib/ai/intake-agent';
import { reserveIntakeRun, IntakeBudgetError } from '../../../../../lib/ai/intake-budget';
import { _resetRateLimitForTesting } from '../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockIntake = vi.mocked(runIntake);
const mockReserve = vi.mocked(reserveIntakeRun);

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTesting(); // the burst limiter is module state across tests
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
  mockReserve.mockResolvedValue(undefined);
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST();
  expect(res.status).toBe(401);
  expect(mockIntake).not.toHaveBeenCalled();
});

it('runs intake for the owner and returns scored + warnings', async () => {
  mockIntake.mockResolvedValueOnce({ scored: 3, warnings: ['x'], results: [] });
  const res = await POST();
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.scored).toBe(3);
  expect(json.warnings).toEqual(['x']);
  expect(mockIntake).toHaveBeenCalledWith('owner-1');
});

/*
  🔴 THE HANDLER DROPPED THE ONE NUMBER THE OWNER NEEDED. `runIntake` caps a run
  at 300 items (Req 11.10) and returns whatever the cap left behind as
  `remaining` — added 2026-08-21 so the library stopped reporting `scored: 300`
  on a 312-item vault as though it had looked at all of it. This handler then
  destructured `{ scored, warnings, results }` and dropped it, so the number
  existed inside lib/ai and nowhere a caller, a screen or an owner could see it.
  A field nothing forwards is worth exactly as much as the silence it replaced.
*/
it('forwards how many items the batch cap left behind', async () => {
  mockIntake.mockResolvedValueOnce({ scored: 300, remaining: 12, warnings: [], results: [] });
  const json = await (await POST()).json();
  expect(json.scored).toBe(300);
  expect(json.remaining, 'the batch cap must be visible outside lib/ai').toBe(12);
});

it('reports nothing left behind as zero, not as absent', async () => {
  // `remaining` is optional in IntakeResult only because fixtures outside that
  // module build one by hand (see the field's note). An absent value here would
  // make "everything was scored" and "an old build that cannot tell you"
  // indistinguishable on the screen, which is the shape of the original defect.
  mockIntake.mockResolvedValueOnce({ scored: 3, warnings: [], results: [] });
  const json = await (await POST()).json();
  expect(json.remaining).toBe(0);
});

it('refuses with 429 once the owner has used their runs for the day', async () => {
  mockReserve.mockRejectedValueOnce(new IntakeBudgetError('used them all', 3600));
  const res = await POST();
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('3600');
  // The decisive part: no money was spent.
  expect(mockIntake).not.toHaveBeenCalled();
});

it('throttles a hammering caller before it reaches the ceiling or the model', async () => {
  mockIntake.mockResolvedValue({ scored: 1, warnings: [], results: [] });
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await POST()).status);

  expect(codes.filter((c) => c === 200).length).toBeGreaterThan(0);
  expect(codes.at(-1), 'a burst must eventually be refused').toBe(429);
  // Refused calls never reached the model, and never ticked the daily meter.
  expect(mockIntake.mock.calls.length).toBe(codes.filter((c) => c === 200).length);
  expect(mockReserve.mock.calls.length).toBe(codes.filter((c) => c === 200).length);
});
