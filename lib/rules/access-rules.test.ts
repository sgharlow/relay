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
    vault_item_id: 'item-1',
    recipient_id: 'rec-1',
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
      { table: 'vault_items', id: 'item-1' },
      { table: 'recipients', id: 'rec-1' },
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
