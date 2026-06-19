/**
 * Tests for POST /api/ai/prioritize
 *
 * Validates: Requirement 12.1
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/ai/prioritize-agent', () => ({ runPrioritize: vi.fn() }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { runPrioritize } from '../../../../../lib/ai/prioritize-agent';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockPrioritize = vi.mocked(runPrioritize);

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
  expect(mockPrioritize).not.toHaveBeenCalled();
});

it('returns the gap list for the owner', async () => {
  mockPrioritize.mockResolvedValueOnce({ gaps: [{ vault_item_id: 'p' } as never], custodyRiskCount: 1 });
  const res = await POST();
  expect(res.status).toBe(200);
  expect((await res.json()).custodyRiskCount).toBe(1);
  expect(mockPrioritize).toHaveBeenCalledWith('owner-1');
});
