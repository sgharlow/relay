/**
 * Tests for POST /api/ai/intake
 *
 * Validates: Requirements 11.1, 11.9
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/ai/intake-agent', () => ({ runIntake: vi.fn() }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { runIntake } from '../../../../../lib/ai/intake-agent';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockIntake = vi.mocked(runIntake);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
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
