/**
 * Tests for GET /api/audit
 *
 * Validates: Requirement 8.6
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/audit/audit-service', () => ({ getAuditLog: vi.fn() }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { getAuditLog } from '../../../../lib/audit/audit-service';
import { computeEntryHash, GENESIS_PREV_HASH } from '../../../../lib/audit/chain';
import { GET } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockLog = vi.mocked(getAuditLog);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await GET();
  expect(res.status).toBe(401);
  expect(mockLog).not.toHaveBeenCalled();
});

it('returns the owner-scoped entries with a valid chain verification', async () => {
  const base = { seq: 0, owner_id: 'owner-1', actor: 'system', action: 'x', entity: 'e', entity_id: null, detail: {}, ts: '2026-01-01T00:00:00Z', id: 'a' };
  const entry_hash = computeEntryHash(GENESIS_PREV_HASH, base);
  mockLog.mockResolvedValueOnce([{ ...base, prev_hash: GENESIS_PREV_HASH, entry_hash } as never]);

  const res = await GET();
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.entries).toHaveLength(1);
  expect(json.verification).toEqual({ valid: true, brokenSeq: null });
  expect(mockLog).toHaveBeenCalledWith('owner-1');
});

it('flags a tampered chain as invalid', async () => {
  const base = { seq: 0, owner_id: 'owner-1', actor: 'system', action: 'x', entity: 'e', entity_id: null, detail: {}, ts: 't', id: 'a' };
  // entry_hash intentionally wrong → verification should fail
  mockLog.mockResolvedValueOnce([{ ...base, prev_hash: GENESIS_PREV_HASH, entry_hash: 'deadbeef' } as never]);
  const res = await GET();
  expect((await res.json()).verification.valid).toBe(false);
});
