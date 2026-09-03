/**
 * Tests for POST /api/kms/unwrap
 *
 * Validates: Requirements 2.4, 7.5, 17.4
 *  - Property 6: KMS unwrap is made IFF an access_rule links recipient→item AND
 *    release_state is RELEASED.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../../../../../lib/db/integrity', async (io) => {
  // Keep the REAL IntegrityError so instanceof checks in the route still work.
  const actual = await io<typeof import('../../../../../lib/db/integrity')>();
  return { ...actual, assertOwns: vi.fn() };
});
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/kms/kms-client', () => ({ decryptDataKey: vi.fn() }));
vi.mock('../../../../../lib/people/delegation', () => ({ getActiveDelegation: vi.fn() }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { assertOwns } from '../../../../../lib/db/integrity';
import { query } from '../../../../../lib/db/connection';
import { decryptDataKey } from '../../../../../lib/kms/kms-client';
import { getActiveDelegation } from '../../../../../lib/people/delegation';
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
  it('400 when vault_item_id is missing', async () => {
    const res = await POST(makeReq({ wrapped_data_key: 'W' }));
    expect(res.status).toBe(400);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('does NOT require wrapped_data_key in the body — the server loads it', async () => {
    // The blob is no longer trusted from the caller; a body that omits it must
    // not 400, because the route reads the real blob from the row.
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(qResult([{ wrapped_data_key: Buffer.from('STORED') }]));

    const res = await POST(makeReq({ vault_item_id: 'v1' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/kms/unwrap — owner path', () => {
  it('decrypts the STORED blob when the owner owns the item — never the body blob', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(qResult([{ wrapped_data_key: Buffer.from('STORED-BLOB') }]));

    const res = await POST(makeReq({ wrapped_data_key: 'ATTACKER-SUPPLIED', vault_item_id: 'v1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).plaintext_data_key).toBe('UNWRAPPED_PLAINTEXT_B64');
    expect(mockDecrypt).toHaveBeenCalledOnce();
    // 🔴 THE ORACLE, REFUTED. The decrypted input is the row's stored blob,
    // NOT the attacker-supplied body value.
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED-BLOB').toString('base64'), {
      era: null,
      ownerId: 'owner-1',
    });
  });

  /*
    Phase B of docs/encryption-context-rollout.md. The row above has no
    `kms_context_era`, which is every row in production today, and the decrypt
    is byte-for-byte the call it has always been. These two pin the routing:
    the era travels from the row to the KMS boundary, and it is read from the
    row rather than accepted from the caller.
  */
  it('reads a NULL era as legacy — the no-op every row takes today', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(
      qResult([{ wrapped_data_key: Buffer.from('STORED-BLOB'), kms_context_era: null }]),
    );

    const res = await POST(makeReq({ vault_item_id: 'v1' }));
    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith(expect.any(String), {
      era: null,
      ownerId: 'owner-1',
    });
  });

  it("passes an 'owner_v1' era through with the row's owner — the reading side, before anything writes", async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(
      qResult([{ wrapped_data_key: Buffer.from('STORED-BLOB'), kms_context_era: 'owner_v1' }]),
    );

    const res = await POST(makeReq({ vault_item_id: 'v1' }));
    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED-BLOB').toString('base64'), {
      era: 'owner_v1',
      ownerId: 'owner-1',
    });
  });

  it('selects the era in the SAME query as the blob — never from the caller', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(
      qResult([{ wrapped_data_key: Buffer.from('B'), kms_context_era: null }]),
    );

    await POST(makeReq({ vault_item_id: 'v1', kms_context_era: 'owner_v1' }));

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('kms_context_era');
    expect(sql).toContain('FROM vault_items WHERE id = $1 AND owner_id = $2');
    // A body-supplied era is an instruction to skip the context. It is ignored.
    expect(mockDecrypt).toHaveBeenCalledWith(expect.any(String), {
      era: null,
      ownerId: 'owner-1',
    });
  });

  it('403 when the owner owns nothing at that id (row missing) — no decrypt', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(qResult([])); // no vault_items row

    const res = await POST(makeReq({ wrapped_data_key: 'ATTACKER-SUPPLIED', vault_item_id: 'v1' }));
    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
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

describe('POST /api/kms/unwrap — recipient path, era routing', () => {
  /*
    ⚠️ `withRow` installs a PERSISTENT mockImplementation, not a queued value, so
    it outlives its test. Left in place it would answer every later
    `FROM release_state` with a RELEASED row owned by owner-9 — a fixture that
    silently satisfies the gate these tests exist to prove is refusable.
    `vi.clearAllMocks()` in the outer beforeEach clears calls and NOT
    implementations, so the reset has to be explicit.
  */
  afterEach(() => {
    mockQuery.mockReset();
    mockVerify.mockReset();
  });

  /** Drives the real gate: release_state -> access_rules -> the blob lookup. */
  function withRow(row: Record<string, unknown>) {
    mockVerify.mockResolvedValue({
      recipientId: 'r1',
      releaseStateId: 'rs1',
      version: '0',
      iat: 0,
      exp: 9_999_999_999,
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM release_state'))
        return qResult([
          { state: 'released', owner_id: 'owner-9', released_at: '2026-01-01' },
        ]);
      if (sql.includes('FROM access_rules'))
        return qResult([{ id: 'rule-1', release_after_days: null }]);
      if (sql.includes('FROM vault_items')) return qResult([row]);
      return qResult([]);
    });
  }

  const recipientReq = () =>
    makeReq({ vault_item_id: 'v1' }, { authorization: 'Bearer t' });

  it('reads a NULL era as legacy — the no-op every row takes today', async () => {
    withRow({ wrapped_data_key: Buffer.from('STORED'), kms_context_era: null });

    const res = await POST(recipientReq());

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED').toString('base64'), {
      era: null,
      ownerId: 'owner-9',
    });
  });

  it("passes an 'owner_v1' era with the OWNER id the gate resolved, not the recipient's", async () => {
    withRow({ wrapped_data_key: Buffer.from('STORED'), kms_context_era: 'owner_v1' });

    const res = await POST(recipientReq());

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED').toString('base64'), {
      era: 'owner_v1',
      ownerId: 'owner-9',
    });
  });
});

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

          mockVerify.mockResolvedValue({
            recipientId: 'r1',
            releaseStateId: 'rs1',
            version: '0',
            iat: 0,
            exp: 9_999_999_999,
          });

          // First query → release_state row; second → access_rules lookup.
          mockQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM release_state')) {
              return stateRowPresent ? qResult([{ state, owner_id: 'owner-1', released_at: '2026-01-01' }]) : qResult([]);
            }
            if (sql.includes('FROM access_rules')) {
              return rulePresent ? qResult([{ id: 'rule-1', release_after_days: null }]) : qResult([]);
            }
            // The server-authoritative blob lookup, present whenever the gate passes.
            if (sql.includes('FROM vault_items')) {
              return qResult([{ wrapped_data_key: Buffer.from('STORED') }]);
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
      if (sql.includes('FROM release_state'))
        return qResult([{ state: 'released', owner_id: 'o1', released_at: '2026-01-01', trigger_type: 'emergency' }]);
      if (sql.includes('FROM access_rules')) return qResult([{ id: 'rule-1', release_after_days: null }]);
      return qResult([]);
    });
    const r = await evaluateRecipientUnwrap({ recipientId: 'r1', vaultItemId: 'v1', releaseStateId: 'rs1' });
    expect(r).toEqual({ allowed: true, ownerId: 'o1' });
  });

  it('scopes the rule lookup to the RELEASED trigger_type — a cross-trigger grant is refused', async () => {
    // 🔴 A recipient granted this item only under trigger B must not decrypt it
    // during trigger A's release. The gate binds the access_rules lookup to the
    // release row's trigger_type; the SQL must carry that filter.
    let ruleSql = '';
    let ruleParams: unknown[] = [];
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM release_state'))
        return qResult([{ state: 'released', owner_id: 'o1', released_at: '2026-01-01', trigger_type: 'caregiver' }]);
      if (sql.includes('FROM access_rules')) {
        ruleSql = sql;
        ruleParams = params ?? [];
        return qResult([]); // no rule for THIS trigger
      }
      return qResult([]);
    });
    const r = await evaluateRecipientUnwrap({ recipientId: 'r1', vaultItemId: 'v1', releaseStateId: 'rs1' });
    expect(r).toEqual({ allowed: false, ownerId: 'o1' });
    expect(ruleSql).toContain('trigger_type = $3');
    expect(ruleParams[2]).toBe('caregiver');
  });
});

// ---------------------------------------------------------------------------
// Delegate boundary (J3-R4) — a helper may open ONLY what they entered.
// ---------------------------------------------------------------------------

describe('POST /api/kms/unwrap — delegate path', () => {
  function delegateReq(body: unknown) {
    return {
      url: 'https://relay.test/api/kms/unwrap?ownerId=parent-1',
      json: async () => body,
      headers: { get: () => null },
    } as never;
  }

  beforeEach(() => {
    mockSession.mockResolvedValue({ ownerId: 'child-1', isDemo: false } as never);
    vi.mocked(getActiveDelegation).mockResolvedValue({ id: 'd-1', scopes: ['items:create'] } as never);
    mockAssertOwns.mockResolvedValue(undefined as never);
  });

  it('DENIES a delegate opening an item the owner entered, with NO KMS call', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ created_by_delegate_id: null }]));

    const res = await POST(delegateReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));

    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('DENIES a delegate opening an item ANOTHER delegate entered', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ created_by_delegate_id: 'd-2' }]));

    const res = await POST(delegateReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));

    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('ALLOWS a delegate opening an item they entered themselves — and unwraps the STORED blob', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ created_by_delegate_id: 'd-1' }])) // provenance
      .mockResolvedValueOnce(qResult([{ wrapped_data_key: Buffer.from('STORED-BLOB') }])); // blob lookup
    mockDecrypt.mockResolvedValueOnce('PLAINTEXT_KEY' as never);

    const res = await POST(delegateReq({ wrapped_data_key: 'ATTACKER-SUPPLIED', vault_item_id: 'v1' }));

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledOnce();
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED-BLOB').toString('base64'), {
      era: null,
      ownerId: 'parent-1',
    });
  });

  it("passes the era with the DELEGATED owner's id, not the delegate's", async () => {
    // The context binds to whoever owns the vault. A delegate opening an item
    // they entered is still reading `parent-1`'s row.
    mockQuery
      .mockResolvedValueOnce(qResult([{ created_by_delegate_id: 'd-1' }]))
      .mockResolvedValueOnce(
        qResult([{ wrapped_data_key: Buffer.from('STORED-BLOB'), kms_context_era: 'owner_v1' }]),
      );

    const res = await POST(delegateReq({ vault_item_id: 'v1' }));

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from('STORED-BLOB').toString('base64'), {
      era: 'owner_v1',
      ownerId: 'parent-1',
    });
  });

  it('refuses entirely when no active delegation exists', async () => {
    vi.mocked(getActiveDelegation).mockResolvedValueOnce(null as never);

    const res = await POST(delegateReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));

    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('fails closed when the item row is missing', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));

    const res = await POST(delegateReq({ wrapped_data_key: 'W', vault_item_id: 'v1' }));

    expect(res.status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});
