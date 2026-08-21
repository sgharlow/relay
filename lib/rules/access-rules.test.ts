/**
 * Tests for lib/rules/access-rules.ts
 *
 * Validates: Requirements 3.3–3.9
 *  - Property 7: Estate rules are always irreversible
 *  - Property 8: N-of-M constraint enforcement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../db/integrity', () => ({ assertNoCrossOwner: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { assertNoCrossOwner } from '../db/integrity';
import {
  validateAccessRuleInput,
  validateNofM,
  createRule,
  listRules,
  updateRule,
  deleteRule,
  VALID_TRIGGER_TYPES,
  VALID_SCOPES,
} from './access-rules';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const mockAssert = vi.mocked(assertNoCrossOwner);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function validRule(overrides: Record<string, unknown> = {}) {
  return {
    vault_item_id: '11111111-1111-4111-8111-111111111111',
    recipient_id: '22222222-2222-4222-8222-222222222222',
    trigger_type: 'emergency',
    scope: 'view',
    reversible: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateAccessRuleInput', () => {
  it('accepts a valid rule', () => {
    const r = validateAccessRuleInput(validRule());
    expect(r.trigger_type).toBe('emergency');
    expect(r.release_after_days).toBeNull();
  });

  it('lists all missing required fields together', () => {
    try {
      validateAccessRuleInput({ scope: 'view' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain('vault_item_id');
      expect((e as ValidationError).message).toContain('recipient_id');
      expect((e as ValidationError).message).toContain('reversible');
    }
  });

  it('rejects an invalid scope and trigger_type', () => {
    expect(() => validateAccessRuleInput(validRule({ scope: 'admin' }))).toThrow(ValidationError);
    expect(() => validateAccessRuleInput(validRule({ trigger_type: 'apocalypse' }))).toThrow(ValidationError);
  });

  it('rejects a negative release_after_days', () => {
    expect(() => validateAccessRuleInput(validRule({ release_after_days: -1 }))).toThrow(ValidationError);
  });

  it('accepts a valid estate rule when reversible=false', () => {
    const r = validateAccessRuleInput(validRule({ trigger_type: 'estate', reversible: false }));
    expect(r.reversible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 7 — Estate rules are always irreversible
// ---------------------------------------------------------------------------

describe('Property 7: estate rules are always irreversible', () => {
  it('any estate rule with reversible=true is rejected, regardless of other fields', () => {
    // Feature: relay-h0-mvp, Property 7
    fc.assert(
      fc.property(
        fc.record({
          vault_item_id: fc.string({ minLength: 1 }),
          recipient_id: fc.string({ minLength: 1 }),
          scope: fc.constantFrom(...VALID_SCOPES),
          release_after_days: fc.option(fc.integer({ min: 0, max: 365 }), { nil: undefined }),
        }),
        (other) => {
          const body = { ...other, trigger_type: 'estate', reversible: true };
          expect(() => validateAccessRuleInput(body)).toThrow(ValidationError);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8 — N-of-M constraint enforcement
// ---------------------------------------------------------------------------

describe('Property 8: N-of-M constraint enforcement', () => {
  it('rejects any (N,M) with N>M or N<1 or M<1', () => {
    // Feature: relay-h0-mvp, Property 8
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: -5, max: 20 }), fc.integer({ min: -5, max: 20 })).filter(
          ([n, m]) => n > m || n < 1 || m < 1,
        ),
        ([n, m]) => {
          expect(() => validateNofM(n, m)).toThrow(ValidationError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('accepts any valid (N,M) with 1 ≤ N ≤ M', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 })).filter(
          ([n, m]) => n <= m,
        ),
        ([n, m]) => {
          expect(() => validateNofM(n, m)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// createRule — cross-owner enforcement (Req 3.8)
// ---------------------------------------------------------------------------

describe('createRule', () => {
  it('asserts both refs belong to the owner before inserting', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'rule-1', ...validRule(), created_at: new Date() }]));
    await createRule('owner-1', validateAccessRuleInput(validRule()));
    expect(mockAssert).toHaveBeenCalledWith('owner-1', [
      { table: 'vault_items', id: '11111111-1111-4111-8111-111111111111' },
      { table: 'recipients', id: '22222222-2222-4222-8222-222222222222' },
    ]);
  });

  it('propagates a cross-owner IntegrityError and does not insert', async () => {
    mockAssert.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    await expect(createRule('owner-1', validateAccessRuleInput(validRule()))).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('trigger/scope enums', () => {
  it('expose the schema-aligned sets', () => {
    expect(VALID_TRIGGER_TYPES).toContain('estate');
    expect(VALID_SCOPES).toEqual(['view', 'act']);
  });
});

/**
 * Ids that are not UUIDs used to travel to the driver, which raised 22P02 and
 * rendered a 500. `mapError` now catches that class for all 17 routes sharing
 * it; this refuses the value at the edge so the response names the field.
 *
 * The fixture above previously used 'item-1' / 'rec-1' — ids that could never
 * exist, since every id column is a UUID. Tests pinning phantom values cannot
 * see this bug, which is why it survived to production.
 */
describe('malformed identifiers are rejected at the edge, naming the field', () => {
  for (const bad of ['item-1', 'not-a-uuid', '123', 'x'.repeat(36)]) {
    it(`rejects vault_item_id ${JSON.stringify(bad)} with a field-level error`, () => {
      try {
        validateAccessRuleInput(validRule({ vault_item_id: bad }));
        throw new Error('expected ValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).field).toBe('vault_item_id');
      }
    });
  }

  it('names recipient_id when that is the malformed one', () => {
    try {
      validateAccessRuleInput(validRule({ recipient_id: 'rec-1' }));
      throw new Error('expected ValidationError');
    } catch (e) {
      expect((e as ValidationError).field).toBe('recipient_id');
    }
  });

  it('still accepts canonical UUIDs in either case', () => {
    const upper = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
    const r = validateAccessRuleInput(validRule({ vault_item_id: upper }));
    expect(r.vault_item_id).toBe(upper);
  });
});

/*
  🔴 THREE OF THE FOUR EXPORTS IN THIS MODULE HAD NO TEST, and the route that
  removes a recipient's access was one of them. `listRules` (GET /api/rules),
  `updateRule` and `deleteRule` (DELETE /api/rules/[id]) all showed as uncovered
  functions, while `src/app/api/rules/[id]/route.ts` states that PUT was retired
  and "`updateRule` survives in lib/rules/access-rules.ts with its tests" — a
  sentence that was simply not true.

  The api-reachability guard cannot see this: it checks that ROUTES are
  reachable, not that library exports are exercised, so a retired capability
  sitting in a module is invisible to it. Retiring the function was the other
  honest option; it is kept and tested instead, because that is what the route's
  own header already claims and the claim is cheaper to make true than to unwind.
*/
describe('the owner-scoped rule CRUD the routes actually call', () => {
  const OWNER = 'owner-1';
  const ROW = {
    id: 'rule-1',
    vault_item_id: '11111111-1111-4111-8111-111111111111',
    recipient_id: '22222222-2222-4222-8222-222222222222',
    trigger_type: 'emergency',
    scope: 'view',
    reversible: true,
    release_after_days: null,
    created_at: new Date('2026-08-21T00:00:00.000Z'),
  };

  it('listRules scopes to the owner and returns them oldest first', async () => {
    mockQuery.mockResolvedValueOnce(qResult([ROW]));

    const rules = await listRules(OWNER);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE owner_id = \$1/);
    expect(String(sql)).toMatch(/ORDER BY created_at ASC/);
    expect(params).toEqual([OWNER]);
    expect(rules[0].id).toBe('rule-1');
    expect(rules[0].created_at).toBe('2026-08-21T00:00:00.000Z');
  });

  it('deleteRule refuses to delete another owner\'s rule by id alone', async () => {
    // The owner_id predicate is the whole authorization story on a schema with
    // no foreign keys: pass someone else's rule id and it must match nothing.
    mockQuery.mockResolvedValueOnce(qResult([]));

    const foreignRuleId = 'rule-belonging-to-someone-else';
    await deleteRule(OWNER, foreignRuleId);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/DELETE FROM access_rules WHERE id = \$1 AND owner_id = \$2/);
    expect(params).toEqual([foreignRuleId, OWNER]);
  });

  it('updateRule checks BOTH references belong to the owner before writing', async () => {
    mockQuery.mockResolvedValueOnce(qResult([ROW]));

    await updateRule(OWNER, 'rule-1', validateAccessRuleInput(validRule()));

    expect(mockAssert).toHaveBeenCalledWith(OWNER, [
      { table: 'vault_items', id: validRule().vault_item_id },
      { table: 'recipients', id: validRule().recipient_id },
    ]);
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/WHERE id = \$7 AND owner_id = \$8/);
  });

  it('updateRule returns null rather than inventing a row when nothing matched', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    expect(await updateRule(OWNER, 'no-such-rule', validateAccessRuleInput(validRule()))).toBeNull();
  });

  it('updateRule does not write when the cross-owner check throws', async () => {
    mockAssert.mockRejectedValueOnce(new Error('IntegrityError: cross-owner reference'));

    await expect(updateRule(OWNER, 'rule-1', validateAccessRuleInput(validRule()))).rejects.toThrow(/cross-owner/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
