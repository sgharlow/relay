/**
 * Tests for lib/vault/vault-items.ts
 *
 * Validates: Requirements 1.1–1.8
 *  - Property 2: Invalid vault item types are always rejected
 *  - Property 3: Vault item metadata round-trip
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock('../db/integrity', () => ({ cascadeDelete: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { cascadeDelete } from '../db/integrity';
import {
  validateCreateInput,
  validateUpdateInput,
  createItem,
  listItems,
  getItemForOwner,
  updateItem,
  deleteItem,
  ValidationError,
  VALID_TYPES,
  VALID_CATEGORIES,
  VALID_CRITICALITY,
} from './vault-items';

const mockQuery = vi.mocked(query);
const mockCascade = vi.mocked(cascadeDelete);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const VALID_B64 = 'AAAA'; // valid base64

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'login',
    title: 'Gmail',
    service_name: 'Google',
    url: 'https://mail.google.com',
    category: 'communication',
    criticality: 'high',
    ciphertext: VALID_B64,
    wrapped_data_key: VALID_B64,
    kms_key_id: 'cmk-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// validateCreateInput
// ---------------------------------------------------------------------------

describe('validateCreateInput', () => {
  it('accepts a fully valid payload and normalises optionals to null', () => {
    const input = validateCreateInput(validBody({ service_name: undefined, url: undefined }));
    expect(input.type).toBe('login');
    expect(input.service_name).toBeNull();
    expect(input.url).toBeNull();
  });

  it('rejects a title longer than 200 chars', () => {
    expect(() => validateCreateInput(validBody({ title: 'x'.repeat(201) }))).toThrow(ValidationError);
  });

  it('rejects an empty title', () => {
    expect(() => validateCreateInput(validBody({ title: '' }))).toThrow(ValidationError);
  });

  it('rejects a url longer than 2048 chars', () => {
    expect(() => validateCreateInput(validBody({ url: 'h'.repeat(2049) }))).toThrow(ValidationError);
  });

  it('rejects an invalid category', () => {
    expect(() => validateCreateInput(validBody({ category: 'spaceship' }))).toThrow(ValidationError);
  });

  it('rejects an invalid criticality', () => {
    expect(() => validateCreateInput(validBody({ criticality: 'super' }))).toThrow(ValidationError);
  });

  it('rejects non-base64 ciphertext', () => {
    expect(() => validateCreateInput(validBody({ ciphertext: 'not base64!!' }))).toThrow(ValidationError);
  });

  it('rejects a missing kms_key_id', () => {
    expect(() => validateCreateInput(validBody({ kms_key_id: '' }))).toThrow(ValidationError);
  });
});

describe('validateUpdateInput', () => {
  it('requires base64 ciphertext + wrapped_data_key', () => {
    expect(() => validateUpdateInput({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64 })).not.toThrow();
    expect(() => validateUpdateInput({ ciphertext: 'bad!', wrapped_data_key: VALID_B64 })).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Property 2 — invalid types are always rejected
// ---------------------------------------------------------------------------

describe('Property 2: invalid vault item types are always rejected', () => {
  it('any type not in the allowed set throws ValidationError, nothing persisted', () => {
    // Feature: relay-h0-mvp, Property 2
    fc.assert(
      fc.property(
        fc.string().filter((s) => !VALID_TYPES.includes(s as never)),
        (badType) => {
          expect(() => validateCreateInput(validBody({ type: badType }))).toThrow(ValidationError);
          expect(mockQuery).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — metadata round-trip (create → read unchanged)
// ---------------------------------------------------------------------------

describe('Property 3: vault item metadata round-trip', () => {
  it('valid metadata survives create → returned projection unchanged', async () => {
    // Feature: relay-h0-mvp, Property 3
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          type: fc.constantFrom(...VALID_TYPES),
          title: fc.string({ minLength: 1, maxLength: 200 }),
          service_name: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
          url: fc.option(fc.webUrl(), { nil: null }),
          category: fc.option(fc.constantFrom(...VALID_CATEGORIES), { nil: null }),
          criticality: fc.option(fc.constantFrom(...VALID_CRITICALITY), { nil: null }),
        }),
        async (meta) => {
          mockQuery.mockReset();
          // INSERT ... RETURNING echoes the inserted values back as a row.
          mockQuery.mockImplementation(async (_sql: string, params?: unknown[]) => {
            const p = params ?? [];
            return qResult([
              {
                id: 'generated-id',
                type: p[1],
                title: p[2],
                service_name: p[3],
                url: p[4],
                category: p[5],
                criticality: p[6],
                is_root_credential: false,
                recurring_billing: false,
                irreplaceable: false,
                importance_score: '0.500',
                depends_on_item_id: null,
                backup_note: null,
                created_at: new Date('2026-01-01T00:00:00Z'),
                updated_at: new Date('2026-01-01T00:00:00Z'),
              },
            ]);
          });

          const input = validateCreateInput({
            ...meta,
            ciphertext: VALID_B64,
            wrapped_data_key: VALID_B64,
            kms_key_id: 'cmk-1',
          });
          const out = await createItem('owner-1', input);

          expect(out.type).toBe(meta.type);
          expect(out.title).toBe(meta.title);
          expect(out.service_name).toBe(meta.service_name);
          expect(out.url).toBe(meta.url);
          expect(out.category).toBe(meta.category);
          expect(out.criticality).toBe(meta.criticality);
          expect(out.importance_score).toBe(0.5);
          expect(out.id).toBe('generated-id');
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

describe('listItems', () => {
  it('returns metadata projections and never selects ciphertext', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'a', type: 'login', title: 'A', importance_score: '0.9', is_root_credential: true }]),
    );
    const items = await listItems('owner-1');
    expect(items[0].id).toBe('a');
    expect(items[0].importance_score).toBe(0.9);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('ciphertext');
    expect(sql).not.toContain('wrapped_data_key');
  });
});

describe('getItemForOwner', () => {
  it('returns base64 ciphertext for an owned row', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([
        {
          id: 'a', type: 'login', title: 'A', importance_score: '0.5',
          ciphertext: Buffer.from([1, 2, 3]),
          wrapped_data_key: Buffer.from([4, 5]),
          kms_key_id: 'cmk-1',
        },
      ]),
    );
    const item = await getItemForOwner('owner-1', 'a');
    expect(item?.ciphertext).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(item?.wrapped_data_key).toBe(Buffer.from([4, 5]).toString('base64'));
  });

  it('returns null when no owner-scoped row exists', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    expect(await getItemForOwner('owner-1', 'missing')).toBeNull();
  });
});

describe('updateItem', () => {
  it('returns null when no owner-scoped row is updated', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    const r = await updateItem('owner-1', 'x', { ciphertext: VALID_B64, wrapped_data_key: VALID_B64 });
    expect(r).toBeNull();
  });
});

describe('deleteItem', () => {
  it('cascade-deletes access_rules before deleting the item', async () => {
    const order: string[] = [];
    mockCascade.mockImplementation(async () => {
      order.push('cascade');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM vault_items')) order.push('delete-item');
      return qResult([]);
    });

    await deleteItem('owner-1', 'item-1');
    expect(mockCascade).toHaveBeenCalledWith('access_rules', 'item-1', 'vault_item_id');
    expect(order).toEqual(['cascade', 'delete-item']);
  });
});
