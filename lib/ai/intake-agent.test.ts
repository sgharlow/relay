/**
 * Tests for lib/ai/intake-agent.ts
 *
 * Validates: Requirements 11.1–11.7, 11.9
 *  - Property 18: Importance score range invariant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('./metadata-query', () => ({ getVaultMetadata: vi.fn() }));

import { query } from '../db/connection';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';
import { runIntake, clampScore } from './intake-agent';
import type { RawClassification } from './openai-client';

const mockQuery = vi.mocked(query);
const mockMeta = vi.mocked(getVaultMetadata);

function qResult(rows: unknown[] = []) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function meta(over: Partial<VaultMetadata> = {}): VaultMetadata {
  return {
    id: 'i1', title: 'Item', service_name: null, url: null, category: 'other', type: 'login',
    criticality: 'medium', is_root_credential: false, recurring_billing: false, irreplaceable: false,
    importance_score: 0.5, depends_on_item_id: null, backup_note: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue(qResult());
});

describe('clampScore', () => {
  it('clamps out-of-range and non-finite values into [0,1]', () => {
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(42)).toBe(1);
    expect(clampScore(0.4)).toBe(0.4);
    expect(clampScore(NaN)).toBe(0.5);
    expect(clampScore(Infinity)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Property 18 — importance score range invariant
// ---------------------------------------------------------------------------

describe('Property 18: importance score range invariant', () => {
  it('clamps any model-returned score into [0,1] for the persisted value', async () => {
    // Feature: relay-h0-mvp, Property 18
    await fc.assert(
      fc.asyncProperty(
        fc.double({ noNaN: false, min: -1e6, max: 1e6 }),
        async (rawScore) => {
          mockMeta.mockResolvedValue([meta({ id: 'i1', title: 'X' })]);
          const classify = vi.fn(async (): Promise<RawClassification[]> => [
            { id: 'i1', is_root_credential: false, recurring_billing: false, irreplaceable: false, importance_score: rawScore, depends_on_title: null },
          ]);
          const out = await runIntake('owner-1', { classify });
          const score = out.results[0].importance_score;
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Classification behaviour
// ---------------------------------------------------------------------------

describe('runIntake', () => {
  it('persists clamped classifications and resolves depends_on_title within the batch', async () => {
    mockMeta.mockResolvedValue([
      meta({ id: 'gmail', title: 'Gmail' }),
      meta({ id: 'chase', title: 'Chase' }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'gmail', is_root_credential: true, recurring_billing: false, irreplaceable: false, importance_score: 0.98, depends_on_title: null },
      { id: 'chase', is_root_credential: false, recurring_billing: true, irreplaceable: false, importance_score: 0.9, depends_on_title: 'Gmail' },
    ]);

    const out = await runIntake('owner-1', { classify });
    expect(out.scored).toBe(2);
    expect(out.warnings).toEqual([]);
    const chase = out.results.find((r) => r.id === 'chase')!;
    expect(chase.depends_on_item_id).toBe('gmail'); // resolved by title
    expect(out.results.find((r) => r.id === 'gmail')!.is_root_credential).toBe(true);
  });

  it('defaults to 0.5 / not-root and warns when classification fails (Req 11.9)', async () => {
    mockMeta.mockResolvedValue([meta({ id: 'i1', title: 'X' }), meta({ id: 'i2', title: 'Y' })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => {
      throw new Error('LLM down');
    });
    const out = await runIntake('owner-1', { classify });
    expect(out.warnings).toEqual(['i1', 'i2']);
    expect(out.results.every((r) => r.importance_score === 0.5 && !r.is_root_credential && r.defaulted)).toBe(true);
    // still persisted (does not block)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('defaults only the items the model omitted', async () => {
    mockMeta.mockResolvedValue([meta({ id: 'i1', title: 'X' }), meta({ id: 'i2', title: 'Y' })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'i1', is_root_credential: false, recurring_billing: false, irreplaceable: false, importance_score: 0.7, depends_on_title: null },
    ]);
    const out = await runIntake('owner-1', { classify });
    expect(out.warnings).toEqual(['i2']);
    expect(out.results.find((r) => r.id === 'i1')!.importance_score).toBe(0.7);
  });

  it('times out and defaults when classification hangs past the budget', async () => {
    mockMeta.mockResolvedValue([meta({ id: 'i1', title: 'X' })]);
    const classify = vi.fn(() => new Promise<RawClassification[]>((r) => setTimeout(() => r([]), 50)));
    const out = await runIntake('owner-1', { classify, timeoutMs: 5 });
    expect(out.warnings).toEqual(['i1']);
  });

  it('no-ops on an empty vault', async () => {
    mockMeta.mockResolvedValue([]);
    const out = await runIntake('owner-1', { classify: vi.fn() });
    expect(out).toEqual({ scored: 0, warnings: [], results: [] });
  });
});
