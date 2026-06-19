/**
 * Tests for /api/vault/items (GET list, POST create)
 *
 * Validates: Requirements 1.1–1.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../../lib/vault/vault-items', async (importOriginal) => {
  // Keep the real validators (so 400 logic is exercised), stub the DB calls.
  const actual = await importOriginal<typeof import('../../../../../lib/vault/vault-items')>();
  return { ...actual, listItems: vi.fn(), createItem: vi.fn() };
});

import { getOwnerSession } from '../../../../../lib/auth/session';
import { listItems, createItem } from '../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { GET, POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockList = vi.mocked(listItems);
const mockCreate = vi.mocked(createItem);
const mockAudit = vi.mocked(writeAuditEntry);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

const VALID_B64 = 'AAAA';
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'login',
    title: 'Gmail',
    ciphertext: VALID_B64,
    wrapped_data_key: VALID_B64,
    kms_key_id: 'cmk-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/vault/items', () => {
  it('401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns the owner items list', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockList.mockResolvedValueOnce([{ id: 'a' } as never]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([{ id: 'a' }]);
    expect(mockList).toHaveBeenCalledWith('owner-1');
  });
});

describe('POST /api/vault/items', () => {
  it('401 when unauthenticated (no create)', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400 on invalid type, nothing persisted', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    const res = await POST(makeReq(validBody({ type: 'malware' })));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('type');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the item, audits, and returns 201', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockCreate.mockResolvedValueOnce({ id: 'new-1', type: 'login' } as never);

    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe('new-1');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_created');
  });
});
