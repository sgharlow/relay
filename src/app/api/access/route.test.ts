/**
 * Tests for GET /api/access
 *
 * Validates: Requirements 7.1–7.4, 7.7
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/access/dashboard', async (io) => {
  const actual = await io<typeof import('../../../../lib/access/dashboard')>();
  return { ...actual, getAccessDashboard: vi.fn() };
});

import { getAccessDashboard, AccessError } from '../../../../lib/access/dashboard';
import { GET } from './route';

const mockDashboard = vi.mocked(getAccessDashboard);

function makeReq(headers: Record<string, string> = {}, query: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    nextUrl: { searchParams: { get: (k: string) => query[k] ?? null } },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

it('401 when no token is supplied', async () => {
  const res = await GET(makeReq());
  expect(res.status).toBe(401);
  expect(mockDashboard).not.toHaveBeenCalled();
});

it('accepts a token from the query string', async () => {
  mockDashboard.mockResolvedValueOnce({ state: 'released', released: true, items: [] });
  const res = await GET(makeReq({}, { token: 'abc' }));
  expect(res.status).toBe(200);
  expect(mockDashboard).toHaveBeenCalledWith('abc');
});

it('returns the dashboard payload from a Bearer token', async () => {
  mockDashboard.mockResolvedValueOnce({ state: 'released', released: true, items: [{ id: 'a' } as never] });
  const res = await GET(makeReq({ authorization: 'Bearer t' }));
  expect(res.status).toBe(200);
  expect((await res.json()).released).toBe(true);
});

it('maps AccessError to its HTTP status (stale token → 403)', async () => {
  mockDashboard.mockRejectedValueOnce(new AccessError('stale', 403));
  const res = await GET(makeReq({ authorization: 'Bearer t' }));
  expect(res.status).toBe(403);
});
