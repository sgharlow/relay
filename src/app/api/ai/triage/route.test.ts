/**
 * Tests for POST /api/ai/triage
 *
 * Validates: Requirements 13.1, 13.8
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/ai/triage-agent', () => ({ runTriage: vi.fn() }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { runTriage } from '../../../../../lib/ai/triage-agent';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockTriage = vi.mocked(runTriage);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('400 when recipient_id or trigger_type is missing/invalid', async () => {
  expect((await POST(makeReq({ trigger_type: 'emergency' }))).status).toBe(400);
  expect((await POST(makeReq({ recipient_id: 'r', trigger_type: 'bogus' }))).status).toBe(400);
  expect(mockTriage).not.toHaveBeenCalled();
});

it('returns the handoff plan for a recipient + trigger', async () => {
  mockTriage.mockResolvedValueOnce({ steps: [{ step: 1, vault_item_id: 'g', title: 'Gmail', bucket: 'do_today' }], fallback: false });
  const res = await POST(makeReq({ recipient_id: 'rec-1', trigger_type: 'emergency' }));
  expect(res.status).toBe(200);
  expect((await res.json()).steps).toHaveLength(1);
  expect(mockTriage).toHaveBeenCalledWith('owner-1', 'rec-1', 'emergency');
});
