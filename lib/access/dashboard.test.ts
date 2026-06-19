/**
 * Tests for lib/access/dashboard.ts
 *
 * Validates: Requirements 7.1–7.8
 *  - Property 15: Access dashboard ranking invariant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../kms/kms-client', () => ({ decryptDataKey: vi.fn(async () => 'PLAINTEXT_KEY_B64') }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { verifyRecipientToken } from '../auth/recipient-token';
import { decryptDataKey } from '../kms/kms-client';
import { rankAccessItems, getAccessDashboard, decryptAccessItem, AccessError, type AccessItem } from './dashboard';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const mockVerify = vi.mocked(verifyRecipientToken);
const mockDecrypt = vi.mocked(decryptDataKey);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const rsRow = (over: Record<string, unknown> = {}) => ({
  id: 'rs-1', owner_id: 'owner-1', trigger_type: 'emergency', state: 'released', version: 3, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue({ recipientId: 'r-1', releaseStateId: 'rs-1', version: '3', iat: 0, exp: 9e9 });
});

// ---------------------------------------------------------------------------
// Property 15 — ranking invariant
// ---------------------------------------------------------------------------

describe('Property 15: access dashboard ranking invariant', () => {
  it('roots first, then importance desc, ties broken by title asc', () => {
    // Feature: relay-h0-mvp, Property 15
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1 }),
            title: fc.string(),
            type: fc.constant('login'),
            is_root_credential: fc.boolean(),
            // small set so importance ties happen and exercise the tie-break
            importance_score: fc.constantFrom(0.1, 0.5, 0.5, 0.9),
          }),
          { minLength: 2, maxLength: 30 },
        ),
        (items) => {
          const ranked = rankAccessItems(items as AccessItem[]);
          for (let i = 1; i < ranked.length; i++) {
            const prev = ranked[i - 1];
            const cur = ranked[i];
            // no non-root may precede a root
            if (!prev.is_root_credential) expect(cur.is_root_credential).toBe(false);
            if (prev.is_root_credential === cur.is_root_credential) {
              expect(prev.importance_score! >= cur.importance_score!).toBe(true);
              if (prev.importance_score === cur.importance_score) {
                expect(prev.title <= cur.title).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// getAccessDashboard
// ---------------------------------------------------------------------------

describe('getAccessDashboard', () => {
  it('returns ranked full items when RELEASED and audits the view', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([rsRow()])) // release_state
      .mockResolvedValueOnce(
        qResult([
          { id: 'a', title: 'Bank', service_name: 'B', url: null, category: 'finance', type: 'login', is_root_credential: false, importance_score: '0.8', depends_on_item_id: null, scope: 'view' },
          { id: 'b', title: 'Gmail', service_name: 'G', url: null, category: 'communication', type: 'login', is_root_credential: true, importance_score: '0.9', depends_on_item_id: null, scope: 'view' },
        ]),
      );
    const out = await getAccessDashboard('tok');
    expect(out.released).toBe(true);
    expect(out.items[0].id).toBe('b'); // root first
    expect(mockAudit.mock.calls[0][1].action).toBe('recipient_dashboard_viewed');
  });

  it('returns only limited fields (no scope) when NOT released (Req 7.3)', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([rsRow({ state: 'grace' })]))
      .mockResolvedValueOnce(qResult([{ id: 'a', title: 'Bank', service_name: 'B', url: null, category: 'finance', type: 'login', is_root_credential: false, importance_score: '0.8', scope: 'view' }]));
    const out = await getAccessDashboard('tok');
    expect(out.released).toBe(false);
    expect(out.items[0].scope).toBeUndefined();
    expect(out.items[0].is_root_credential).toBeUndefined();
  });

  it('403 on a stale token (version mismatch)', async () => {
    mockVerify.mockReturnValueOnce({ recipientId: 'r-1', releaseStateId: 'rs-1', version: '2', iat: 0, exp: 9e9 });
    mockQuery.mockResolvedValueOnce(qResult([rsRow({ version: 3 })]));
    await expect(getAccessDashboard('tok')).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('403 on an invalid token', async () => {
    mockVerify.mockImplementationOnce(() => {
      throw new Error('bad');
    });
    await expect(getAccessDashboard('tok')).rejects.toBeInstanceOf(AccessError);
  });
});

// ---------------------------------------------------------------------------
// decryptAccessItem
// ---------------------------------------------------------------------------

describe('decryptAccessItem', () => {
  it('decrypts when released + version ok + access_rule covers the item', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([rsRow()])) // release_state
      .mockResolvedValueOnce(qResult([{ id: 'rule-1' }])) // access_rule
      .mockResolvedValueOnce(qResult([{ ciphertext: Buffer.from([1, 2]), wrapped_data_key: Buffer.from([3, 4]), kms_key_id: 'cmk' }]));
    const out = await decryptAccessItem('tok', 'item-1');
    expect(out.plaintext_data_key).toBe('PLAINTEXT_KEY_B64');
    expect(out.ciphertext).toBe(Buffer.from([1, 2]).toString('base64'));
    expect(mockDecrypt).toHaveBeenCalledOnce();
    const authored = mockAudit.mock.calls.find((c) => c[1].detail?.outcome === 'authorized');
    expect(authored).toBeDefined();
  });

  it('denies (403) with NO KMS call and an audited denial when item is out of scope (Req 7.5/7.8)', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([rsRow()])) // release_state
      .mockResolvedValueOnce(qResult([])); // no access_rule
    await expect(decryptAccessItem('tok', 'item-1')).rejects.toMatchObject({ httpStatus: 403 });
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockAudit.mock.calls[0][1].detail).toMatchObject({ outcome: 'denied' });
  });

  it('denies when not released (no KMS, audited)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([rsRow({ state: 'grace' })]));
    await expect(decryptAccessItem('tok', 'item-1')).rejects.toMatchObject({ httpStatus: 403 });
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});
