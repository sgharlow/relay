/**
 * Tests for POST /api/import
 *
 * Validates: Requirements 10.4, 10.8
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/vault/vault-items', async (io) => {
  const actual = await io<typeof import('../../../../lib/vault/vault-items')>();
  return { ...actual, createItem: vi.fn() };
});
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { createItem } from '../../../../lib/vault/vault-items';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockCreate = vi.mocked(createItem);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}
const VALID_B64 = 'AAAA';
function item(over: Record<string, unknown> = {}) {
  return { type: 'login', title: 'Gmail', ciphertext: VALID_B64, wrapped_data_key: VALID_B64, kms_key_id: 'cmk', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
  mockCreate.mockResolvedValue({ id: 'new' } as never);
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST(makeReq({ items: [item()] }));
  expect(res.status).toBe(401);
});

it('imports a batch and returns the count', async () => {
  const res = await POST(makeReq({ items: [item({ title: 'A' }), item({ title: 'B' })] }));
  expect(res.status).toBe(200);
  expect((await res.json()).imported).toBe(2);
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it('rejects the WHOLE batch (400) with nothing inserted if any item is invalid (Req 10.4)', async () => {
  const res = await POST(makeReq({ items: [item(), item({ type: 'malware' })] }));
  expect(res.status).toBe(400);
  expect((await res.json()).index).toBe(1);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('400 when items is not an array', async () => {
  expect((await POST(makeReq({ items: 'nope' }))).status).toBe(400);
});

it('returns 0 for an empty batch', async () => {
  const res = await POST(makeReq({ items: [] }));
  expect((await res.json()).imported).toBe(0);
  expect(mockCreate).not.toHaveBeenCalled();
});
