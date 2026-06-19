/**
 * Tests for POST /api/cron/heartbeat
 *
 * Validates: Requirements 4.3, 4.6, 4.7
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/release/heartbeat', () => ({ runHeartbeatSweep: vi.fn() }));
vi.mock('../../../../../lib/release/state-machine', () => ({ ReleaseStateMachine: vi.fn() }));

import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';
import { POST } from './route';

const mockSweep = vi.mocked(runHeartbeatSweep);

function makeReq(headers: Record<string, string> = {}) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'secret-token';
});

it('401 when the Authorization header does not match CRON_SECRET', async () => {
  const res = await POST(makeReq({ authorization: 'Bearer wrong' }));
  expect(res.status).toBe(401);
  expect(mockSweep).not.toHaveBeenCalled();
});

it('401 when no CRON_SECRET is configured', async () => {
  delete process.env.CRON_SECRET;
  const res = await POST(makeReq({ authorization: 'Bearer anything' }));
  expect(res.status).toBe(401);
});

it('runs the sweep and returns the summary on a valid secret', async () => {
  mockSweep.mockResolvedValueOnce({ evaluated: 2, transitioned: 1, failures: 0 });
  const res = await POST(makeReq({ authorization: 'Bearer secret-token' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ evaluated: 2, transitioned: 1, failures: 0 });
});
