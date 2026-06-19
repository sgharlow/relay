/**
 * Tests for POST /api/access/[itemId]/decrypt
 *
 * Validates: Requirements 7.5, 7.8
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/access/dashboard', async (io) => {
  const actual = await io<typeof import('../../../../../../lib/access/dashboard')>();
  return { ...actual, decryptAccessItem: vi.fn() };
});

import { decryptAccessItem, AccessError } from '../../../../../../lib/access/dashboard';
import { POST } from './route';

const mockDecrypt = vi.mocked(decryptAccessItem);

function makeReq(body: unknown = {}, headers: Record<string, string> = {}) {
  return { json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never;
}
const ctx = { params: { itemId: 'item-1' } };

beforeEach(() => vi.clearAllMocks());

it('401 when no token is supplied', async () => {
  const res = await POST(makeReq(), ctx);
  expect(res.status).toBe(401);
  expect(mockDecrypt).not.toHaveBeenCalled();
});

it('returns the decrypt payload on success', async () => {
  mockDecrypt.mockResolvedValueOnce({ plaintext_data_key: 'K', ciphertext: 'C', kms_key_id: 'cmk' });
  const res = await POST(makeReq({ token: 't' }), ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ plaintext_data_key: 'K', ciphertext: 'C', kms_key_id: 'cmk' });
  expect(mockDecrypt).toHaveBeenCalledWith('t', 'item-1');
});

it('maps a denied decrypt (AccessError 403) to 403', async () => {
  mockDecrypt.mockRejectedValueOnce(new AccessError('Item not in scope', 403));
  const res = await POST(makeReq({}, { authorization: 'Bearer t' }), ctx);
  expect(res.status).toBe(403);
});
