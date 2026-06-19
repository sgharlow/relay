/**
 * Tests for POST /api/kms/unwrap
 *
 * Validates: Requirements 2.4, 7.5, 17.4
 *  - Property 6: KMS unwrap is made IFF an access_rule links recipient→item AND
 *    release_state is RELEASED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../../../../../lib/db/integrity', () => ({ assertOwns: vi.fn() }));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/kms/kms-client', () => ({ decryptDataKey: vi.fn() }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { assertOwns } from '../../../../../lib/db/integrity';
import { query } from '../../../../../lib/db/connection';
import { decryptDataKey } from '../../../../../lib/kms/kms-client';
import { evaluateRecipientUnwrap } from '../../../../../lib/kms/unwrap-gate';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockVerify = vi.mocked(verifyRecipientToken);
const mockAssertOwns = vi.mocked(assertOwns);
const mockQuery = vi.mocked(query);
const mockDecrypt = vi.mocked(decryptDataKey);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockResolvedValue('UNWRAPPED_PLAINTEXT_B64');
});

describe('POST /api/kms/unwrap — validation', () => {
  it('400 when wrapped_data_key or vault_item_id is missing', async () => {
    const res = await POST(makeReq({ vault_item_id: 'v1' }));
    expect(res.status).toBe(400);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});

describe('POST /api/kms/unwrap — owner path', () => {
  it('decrypts when the owner owns the item', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);

    const res = await POST(makeReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).plaintext_data_key).toBe('UNWRAPPED_PLAINTEXT_B64');
    expect(mockDecrypt).toHaveBeenCalledOnce();
  });

  it('403 and no KMS call when the owner does not own the item', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const res = await POST(makeReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));
    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});

describe('POST /api/kms/unwrap — recipient path', () => {
  it('403 on an invalid recipient token (no KMS call)', async () => {
    mockVerify.mockImplementationOnce(() => {
      throw new Error('bad token');
    });
    const res = await POST(
      makeReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }, { authorization: 'Bearer junk' }),
    );
    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 6 — KMS unwrap is gated on (RELEASED state) AND (access_rule exists)
// ---------------------------------------------------------------------------

describe('Property 6: KMS unwrap scoped to access rules', () => {
  it('decrypt happens IFF release_state=released AND a matching access_rule exists', async () => {
    // Feature: relay-h0-mvp, Property 6
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          state: fc.constantFrom('armed', 'pending', 'grace', 'released', 'cancelled'),
          rulePresent: fc.boolean(),
          stateRowPresent: fc.boolean(),
        }),
        async ({ state, rulePresent, stateRowPresent }) => {
          vi.clearAllMocks();
          mockDecrypt.mockResolvedValue('UNWRAPPED_PLAINTEXT_B64');

          mockVerify.mockReturnValue({
            recipientId: 'r1',
            releaseStateId: 'rs1',
            version: '0',
            iat: 0,
            exp: 9_999_999_999,
          });

          // First query → release_state row; second → access_rules lookup.
          mockQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM release_state')) {
              return stateRowPresent ? qResult([{ state, owner_id: 'owner-1' }]) : qResult([]);
            }
            if (sql.includes('FROM access_rules')) {
              return rulePresent ? qResult([{ id: 'rule-1' }]) : qResult([]);
            }
            return qResult([]);
          });

          const res = await POST(
            makeReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }, { authorization: 'Bearer t' }),
          );

          const shouldDecrypt = stateRowPresent && state === 'released' && rulePresent;
          if (shouldDecrypt) {
            expect(res.status).toBe(200);
            expect(mockDecrypt).toHaveBeenCalledOnce();
          } else {
            expect(res.status).toBe(403);
            expect(mockDecrypt).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('evaluateRecipientUnwrap returns the exact gate predicate', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM release_state')) return qResult([{ state: 'released', owner_id: 'o1' }]);
      if (sql.includes('FROM access_rules')) return qResult([{ id: 'rule-1' }]);
      return qResult([]);
    });
    const r = await evaluateRecipientUnwrap({ recipientId: 'r1', vaultItemId: 'v1', releaseStateId: 'rs1' });
    expect(r).toEqual({ allowed: true, ownerId: 'o1' });
  });
});
