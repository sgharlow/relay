/**
 * Tests for lib/ai/triage-agent.ts
 *
 * Validates: Requirements 13.1–13.5, 13.8
 *  - Property 19: Triage plan respects dependency order
 *  - Property 20: Triage time-horizon bucket assignment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./metadata-query', () => ({ getVaultMetadata: vi.fn() }));

import { query } from '../db/connection';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';
import { bucketFor, buildTriagePlan, runTriage } from './triage-agent';

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

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Property 20 — bucket assignment
// ---------------------------------------------------------------------------

describe('Property 20: time-horizon bucket assignment', () => {
  it('assigns the correct bucket for any (importance, is_root) pair', () => {
    // Feature: relay-h0-mvp, Property 20
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), (score, isRoot) => {
        const bucket = bucketFor({ importance_score: score, is_root_credential: isRoot });
        if (isRoot || score >= 0.7) expect(bucket).toBe('do_today');
        else if (score >= 0.4) expect(bucket).toBe('this_week');
        else expect(bucket).toBe('within_30_days');
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19 — dependency order over random DAGs
// ---------------------------------------------------------------------------

describe('Property 19: triage plan respects dependency order', () => {
  it('every item appears after its (in-scope) dependency for all valid DAGs', () => {
    // Feature: relay-h0-mvp, Property 19
    fc.assert(
      fc.property(
        // n items; item i may depend on a LOWER index j (guarantees a DAG) or none.
        fc.integer({ min: 1, max: 25 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.array(fc.integer({ min: -1, max: n - 1 }), { minLength: n, maxLength: n }),
            fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
          ),
        ),
        ([n, deps, scores]) => {
          const items: VaultMetadata[] = Array.from({ length: n }, (_, i) =>
            meta({
              id: `n${i}`,
              title: `n${i}`,
              importance_score: scores[i],
              // depend on a strictly lower index → acyclic; -1 or >=i means none
              depends_on_item_id: deps[i] >= 0 && deps[i] < i ? `n${deps[i]}` : null,
            }),
          );
          const plan = buildTriagePlan(items, 'emergency');
          const pos = new Map(plan.map((s, idx) => [s.vault_item_id, idx]));
          expect(plan).toHaveLength(n);
          for (const it of items) {
            if (it.depends_on_item_id) {
              expect(pos.get(it.depends_on_item_id)!).toBeLessThan(pos.get(it.id)!);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('places root credentials and dependency-free items first', () => {
    const plan = buildTriagePlan(
      [
        meta({ id: 'bank', title: 'Bank', importance_score: 0.9, depends_on_item_id: 'gmail' }),
        meta({ id: 'gmail', title: 'Gmail', is_root_credential: true, importance_score: 0.95 }),
      ],
      'emergency',
    );
    expect(plan[0].vault_item_id).toBe('gmail');
    expect(plan[1].vault_item_id).toBe('bank');
  });
});

// ---------------------------------------------------------------------------
// Provider guidance + fallback
// ---------------------------------------------------------------------------

describe('buildTriagePlan estate guidance', () => {
  it('attaches provider guidance only for estate triggers', () => {
    const items = [meta({ id: 'g', title: 'Gmail', service_name: 'Google', importance_score: 0.9 })];
    expect(buildTriagePlan(items, 'estate')[0].provider_guidance).toContain('Inactive Account Manager');
    expect(buildTriagePlan(items, 'emergency')[0].provider_guidance).toBeUndefined();
  });
});

describe('runTriage', () => {
  it('filters to the recipient-scoped items and builds a plan', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ vault_item_id: 'gmail' }])); // scoped ids
    mockMeta.mockResolvedValueOnce([meta({ id: 'gmail', title: 'Gmail', importance_score: 0.9 }), meta({ id: 'other', title: 'Other' })]);
    const out = await runTriage('owner-1', 'rec-1', 'emergency');
    expect(out.fallback).toBe(false);
    expect(out.steps).toHaveLength(1); // only the scoped item
    expect(out.steps[0].vault_item_id).toBe('gmail');
    expect(out.steps[0].bucket).toBe('do_today');
  });

  it('returns an empty plan when nothing is scoped', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    mockMeta.mockResolvedValueOnce([meta()]);
    const out = await runTriage('owner-1', 'rec-1', 'emergency');
    expect(out.steps).toEqual([]);
  });
});
