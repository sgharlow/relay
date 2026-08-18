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
    secret_kinds: 'password',
    ...overrides,
  };
}

/** A metadata row shaped like the RETURNING projection, for tests that only care about the call. */
function metaRow(over: Record<string, unknown> = {}) {
  return {
    id: 'item-1', type: 'login', title: 'Gmail', service_name: 'Google',
    url: null, category: 'communication', criticality: 'high',
    is_root_credential: false, owner_set_root: null, recurring_billing: false,
    irreplaceable: false, importance_score: '0.500', depends_on_item_id: null,
    backup_note: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...over,
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
    expect(() => validateUpdateInput({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64, secret_kinds: 'password' })).not.toThrow();
    expect(() => validateUpdateInput({ ciphertext: 'bad!', wrapped_data_key: VALID_B64, secret_kinds: 'password' })).toThrow(ValidationError);
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
            // Required on every write since 035 Phase 1 was hardened — the blob
            // always declares what it holds. A realistic value; this property is
            // about the metadata round-trip, not the declaration.
            secret_kinds: 'password',
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
    const r = await updateItem('owner-1', 'x', { ciphertext: VALID_B64, wrapped_data_key: VALID_B64, secret_kinds: 'password' });
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
    expect(mockCascade).toHaveBeenCalledWith('access_rules', 'item-1', 'vault_item_id', 'owner-1');
    expect(order).toEqual(['cascade', 'delete-item']);
  });
});

/**
 * 🔴 THE COLUMN EXISTED SINCE MIGRATION 001 AND NOTHING COULD WRITE IT.
 *
 * `detectGaps` decides CUSTODY_RISK and MISSING_NOTE from `backup_note`, so with
 * no write path every item in every real vault carried a permanent gap telling
 * the owner to add a note the product gave them no way to add. Only the seed
 * runner set it, which is why the demo vault looked correct.
 *
 * `lib/ops/advice-inputs-writable.test.ts` guards the structure. These cover the
 * behaviour, including the whitespace case that would have cleared the gap on
 * screen while the advice layer still counted the item as noteless.
 */
describe('backup_note — the note the advice layer reads', () => {
  it('is accepted on create and persisted', async () => {
    const input = validateCreateInput(validBody({ backup_note: 'Passport is in the fireproof box.' }));
    expect(input.backup_note).toBe('Passport is in the fireproof box.');

    mockQuery.mockResolvedValueOnce(qResult([metaRow()]));
    await createItem('owner-1', input);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('backup_note');
    expect(params).toContain('Passport is in the fireproof box.');
  });

  it('defaults to null when the caller omits it — existing callers are unaffected', () => {
    expect(validateCreateInput(validBody()).backup_note).toBeNull();
  });

  it('treats a whitespace-only note as no note at all', () => {
    // hasNote() trims before deciding. Storing "   " would look like it cleared
    // the gap while the advice layer still reported one — two definitions of
    // "has a note" that disagree.
    expect(validateCreateInput(validBody({ backup_note: '   \n\t ' })).backup_note).toBeNull();
    expect(validateUpdateInput({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64, secret_kinds: 'password', backup_note: '  ' }).backup_note)
      .toBeUndefined();
  });

  it('trims a real note rather than storing the surrounding whitespace', () => {
    expect(validateCreateInput(validBody({ backup_note: '  in the safe  ' })).backup_note).toBe('in the safe');
  });

  it('rejects a note longer than the bound, on create and on update', () => {
    const tooLong = 'x'.repeat(2001);
    expect(() => validateCreateInput(validBody({ backup_note: tooLong }))).toThrow(/backup_note/);
    expect(() =>
      validateUpdateInput({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64, secret_kinds: 'password', backup_note: tooLong }),
    ).toThrow(/backup_note/);
  });

  it('rejects a non-string note instead of coercing it', () => {
    expect(() => validateCreateInput(validBody({ backup_note: 42 }))).toThrow(/backup_note/);
  });

  it('is settable on update, and an omitted note leaves the stored one alone', async () => {
    mockQuery.mockResolvedValueOnce(qResult([metaRow()]));
    await updateItem('owner-1', 'item-1', {
      ciphertext: VALID_B64,
      wrapped_data_key: VALID_B64,
      backup_note: 'Recovery codes are in the desk drawer.',
      secret_kinds: 'password',
    });
    const [sql, params] = mockQuery.mock.calls[0];
    // COALESCE, matching title/service_name/url — omitting the field keeps what is there.
    expect(sql).toContain('backup_note = COALESCE(');
    expect(params).toContain('Recovery codes are in the desk drawer.');

    mockQuery.mockResolvedValueOnce(qResult([metaRow()]));
    await updateItem('owner-1', 'item-1', { ciphertext: VALID_B64, wrapped_data_key: VALID_B64, secret_kinds: 'password' });
    const [, paramsOmitted] = mockQuery.mock.calls[1];
    expect(paramsOmitted).toContain(null);
  });
});
