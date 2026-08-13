/**
 * Tests for /api/vault/items/[id] (PUT, DELETE)
 *
 * Validates: Requirements 1.5–1.8
 *  - not-found and cross-owner both return 403 (existence not revealed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../../../lib/db/integrity', () => {
  class IntegrityError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return { assertOwns: vi.fn(), IntegrityError };
});
vi.mock('../../../../../../lib/vault/vault-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/vault/vault-items')>();
  return {
    ...actual,
    getItemForOwner: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  };
});

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import { updateItem, deleteItem } from '../../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../../lib/audit/audit-service';
import { PUT, DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockAssertOwns = vi.mocked(assertOwns);
const mockUpdate = vi.mocked(updateItem);
const mockDelete = vi.mocked(deleteItem);
const mockAudit = vi.mocked(writeAuditEntry);

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}
const VALID_B64 = 'AAAA';

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

/*
  DRIVEN THROUGH DELETE SINCE 2026-08-13, when the GET handler was retired.
  These test the shared `authorize()` helper, not any one verb — and the
  behaviour they pin is Requirement 1.8: a row you do not own and a row that
  does not exist must be indistinguishable, or the 404 itself tells an attacker
  which item IDs are real. That guarantee still has to hold on the verbs that
  remain, so the coverage moved rather than going with the handler.
*/
describe('authorization (Requirement 1.8)', () => {
  it('returns 403 — not 404 — when the row does not exist', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 403 on a cross-owner row (same response as not-found)', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'mismatch'));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/vault/items/[id]', () => {
  it('400 on an invalid (non-base64) body', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    const res = await PUT(makeReq({ ciphertext: 'bad!', wrapped_data_key: VALID_B64 }), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('replaces the payload, audits, and returns the updated metadata', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockUpdate.mockResolvedValueOnce({ id: 'item-1', title: 'A' } as never);
    const res = await PUT(makeReq({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64 }), ctx);
    expect(res.status).toBe(200);
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_updated');
  });
});

describe('DELETE /api/vault/items/[id]', () => {
  it('cascade-deletes and audits', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockDelete.mockResolvedValueOnce(undefined);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('owner-1', 'item-1');
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_deleted');
  });
});
