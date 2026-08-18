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

  it('defaults to 0.5 and warns when classification fails (Req 11.9)', async () => {
    mockMeta.mockResolvedValue([meta({ id: 'i1', title: 'X' }), meta({ id: 'i2', title: 'Y' })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => {
      throw new Error('LLM down');
    });
    const out = await runIntake('owner-1', { classify });
    expect(out.warnings).toEqual(['i1', 'i2']);
    expect(out.results.every((r) => r.importance_score === 0.5 && r.defaulted)).toBe(true);
    // still persisted (does not block)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  /*
    🔴 THE TEST ABOVE USED TO ASSERT `!r.is_root_credential`, AND IT WAS
    ASSERTING THE BUG. Every item in its fixture already had
    is_root_credential: false, so the assertion passed whether the code
    preserved the flag or wiped it — it never exercised a root credential at
    all. Meanwhile runIntake hard-coded `is_root_credential: false` on the
    default path AND wrote the row, so one LLM timeout downgraded every root
    credential in the vault.

    The flag decides what a grieving person is told to do FIRST: bucketFor puts
    root credentials in "Do today" whatever their score, and the handoff order
    puts them ahead of everything else. Losing it silently reorders the plan,
    and the reordered plan looks perfectly normal.

    Req 11.9 requires only a default SCORE on failure. Req 11.8 requires that a
    classification "SHALL NOT be overwritten on subsequent re-analyses".
  */
  it('does NOT wipe an existing root credential when classification fails (Req 11.8)', async () => {
    mockMeta.mockResolvedValue([
      meta({ id: 'gmail', title: 'Gmail', is_root_credential: true }),
      meta({ id: 'chase', title: 'Chase', is_root_credential: false }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => {
      throw new Error('LLM down');
    });

    const out = await runIntake('owner-1', { classify });

    expect(out.results.find((r) => r.id === 'gmail')!.is_root_credential).toBe(true);
    expect(out.results.find((r) => r.id === 'chase')!.is_root_credential).toBe(false);
    // And the preserved value is what gets written, not just what is returned.
    const gmailWrite = mockQuery.mock.calls.find((c) => (c[1] as unknown[])[5] === 'gmail');
    expect((gmailWrite![1] as unknown[])[0]).toBe(true);
  });

  it('preserves a root credential when the model simply omits that item', async () => {
    // The partial-failure path is separate from allFailed and was equally wrong.
    mockMeta.mockResolvedValue([
      meta({ id: 'gmail', title: 'Gmail', is_root_credential: true }),
      meta({ id: 'chase', title: 'Chase' }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'chase', is_root_credential: false, recurring_billing: true, irreplaceable: false, importance_score: 0.9, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.warnings).toEqual(['gmail']);
    expect(out.results.find((r) => r.id === 'gmail')!.is_root_credential).toBe(true);
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

/*
 * 🔴 REQUIREMENT 11.8 WAS UNIMPLEMENTED IN BOTH HALVES. The spec says the owner
 * may override a classification and that the override "SHALL NOT be overwritten
 * on subsequent re-analyses of the same item" — but there was no column, no
 * endpoint and no control, so the agent re-decided is_root_credential from the
 * title on every run and the owner could not disagree.
 *
 * The fact this protects is one only the owner knows: which account the others
 * reset THROUGH. Getting it wrong reorders what a grieving person is told to do
 * first, because a root credential is forced into "Do today" whatever the model
 * scored it.
 */
describe('an owner override survives re-analysis (Req 11.8)', () => {
  it('keeps the owner YES even when the model says no', async () => {
    mockMeta.mockResolvedValue([
      meta({ id: 'gmail', title: 'Gmail', is_root_credential: true, owner_set_root: true }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'gmail', is_root_credential: false, recurring_billing: false, irreplaceable: false, importance_score: 0.4, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].is_root_credential).toBe(true);
    // And the preserved value is what is written, not merely returned.
    expect((mockQuery.mock.calls[0][1] as unknown[])[0]).toBe(true);
  });

  it('keeps the owner NO even when the model says yes', async () => {
    // The direction that matters for trust: an owner who says "no, this is not
    // the one" must not be overruled every time the agent runs.
    mockMeta.mockResolvedValue([
      meta({ id: 'bank', title: 'Bank', is_root_credential: false, owner_set_root: false }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'bank', is_root_credential: true, recurring_billing: true, irreplaceable: false, importance_score: 0.95, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].is_root_credential).toBe(false);
  });

  it('still lets the model decide when the owner has never said', async () => {
    // Every item that existed before this feature reads NULL, so the agent must
    // keep working exactly as before for them.
    mockMeta.mockResolvedValue([meta({ id: 'x', title: 'X', owner_set_root: null })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'x', is_root_credential: true, recurring_billing: false, irreplaceable: false, importance_score: 0.9, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].is_root_credential).toBe(true);
  });

  it('treats an ABSENT field as "never said", not as "no"', async () => {
    // Callers built from partial fixtures omit it entirely; reading that as a
    // false override would silently freeze every item as non-root.
    mockMeta.mockResolvedValue([meta({ id: 'y', title: 'Y' })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'y', is_root_credential: true, recurring_billing: false, irreplaceable: false, importance_score: 0.9, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].is_root_credential).toBe(true);
  });
});

/**
 * The same guarantee for the flag with the worse failure mode.
 *
 * 🔴 `irreplaceable` IS WHAT RAISES A CUSTODY_RISK — the gap type covering the
 * things that cannot be regenerated from a login: a deed, a will, a passport.
 * Until migration 034 the model decided it alone, on every run, from the title.
 * An owner who corrected it had nowhere to record the correction, and writing
 * `irreplaceable` directly would have lasted exactly until the next analysis.
 *
 * The failure is silent in the dangerous direction: an item wrongly marked
 * replaceable simply never produces a warning, so nobody learns the judgement
 * was ever made.
 */
describe('an owner override of irreplaceable survives re-analysis (migration 034)', () => {
  it('keeps the owner YES when the model says no', async () => {
    mockMeta.mockResolvedValue([
      meta({ id: 'passport', title: 'Passport', irreplaceable: true, owner_set_irreplaceable: true }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'passport', is_root_credential: false, recurring_billing: false, irreplaceable: false, importance_score: 0.3, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].irreplaceable).toBe(true);
    // Written, not merely returned — irreplaceable is the third parameter.
    expect((mockQuery.mock.calls[0][1] as unknown[])[2]).toBe(true);
  });

  it('keeps the owner NO when the model says yes', async () => {
    mockMeta.mockResolvedValue([
      meta({ id: 'photos', title: 'Photo backup', irreplaceable: false, owner_set_irreplaceable: false }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'photos', is_root_credential: false, recurring_billing: false, irreplaceable: true, importance_score: 0.8, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].irreplaceable).toBe(false);
  });

  it('still lets the model decide when the owner has never said', async () => {
    // Every item predating migration 034 reads NULL, so nothing changes for them.
    mockMeta.mockResolvedValue([meta({ id: 'y', title: 'Y', owner_set_irreplaceable: null })]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'y', is_root_credential: false, recurring_billing: false, irreplaceable: true, importance_score: 0.5, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].irreplaceable).toBe(true);
  });

  it('the two overrides are independent — one does not carry the other', async () => {
    /*
      Both are nullable booleans read with `== null`, and a copy-paste that
      pointed the second at owner_set_root would pass every test above. This is
      the one that would catch it.
    */
    mockMeta.mockResolvedValue([
      meta({ id: 'z', title: 'Z', owner_set_root: true, owner_set_irreplaceable: false }),
    ]);
    const classify = vi.fn(async (): Promise<RawClassification[]> => [
      { id: 'z', is_root_credential: false, recurring_billing: false, irreplaceable: true, importance_score: 0.5, depends_on_title: null },
    ]);

    const out = await runIntake('owner-1', { classify });

    expect(out.results[0].is_root_credential).toBe(true);
    expect(out.results[0].irreplaceable).toBe(false);
  });
});
