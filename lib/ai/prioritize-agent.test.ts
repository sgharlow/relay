/**
 * Tests for lib/ai/prioritize-agent.ts
 *
 * Validates: Requirements 12.1–12.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./metadata-query', () => ({ getVaultMetadata: vi.fn() }));

import { query } from '../db/connection';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';
import { detectGaps, rankGaps, runPrioritize } from './prioritize-agent';

const mockQuery = vi.mocked(query);
const mockMeta = vi.mocked(getVaultMetadata);

function qResult(rows: unknown[] = []) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

function meta(over: Partial<VaultMetadata> = {}): VaultMetadata {
  return {
    id: 'i1', title: 'Item', service_name: null, url: null, category: 'other', type: 'login',
    criticality: 'medium', is_root_credential: false, recurring_billing: false, irreplaceable: false,
    importance_score: 0.5, depends_on_item_id: null, backup_note: 'a note', ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('detectGaps', () => {
  it('flags an irreplaceable item with no recipient as CUSTODY_RISK', () => {
    const gaps = detectGaps([meta({ id: 'p', title: 'Passport', irreplaceable: true, backup_note: 'in safe' })], new Set());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap_type).toBe('CUSTODY_RISK');
  });

  it('flags an irreplaceable item with a recipient but no note as CUSTODY_RISK', () => {
    const gaps = detectGaps([meta({ id: 'p', irreplaceable: true, backup_note: '' })], new Set(['p']));
    expect(gaps[0].gap_type).toBe('CUSTODY_RISK');
  });

  it('does NOT flag an irreplaceable item that has both a recipient and a note', () => {
    const gaps = detectGaps([meta({ id: 'p', irreplaceable: true, backup_note: 'in safe' })], new Set(['p']));
    expect(gaps).toHaveLength(0);
  });

  it('flags a non-irreplaceable item with no note as MISSING_NOTE', () => {
    const gaps = detectGaps([meta({ id: 'x', backup_note: null })], new Set(['x']));
    expect(gaps[0].gap_type).toBe('MISSING_NOTE');
  });

  it('emits no gaps when items are complete', () => {
    expect(detectGaps([meta({ backup_note: 'documented' })], new Set(['i1']))).toHaveLength(0);
  });
});

describe('rankGaps', () => {
  it('ranks root credentials first, then by importance desc', () => {
    const gaps = rankGaps([
      { vault_item_id: 'a', title: 'A', gap_type: 'MISSING_NOTE', consequence: '', is_root_credential: false, importance_score: 0.9 },
      { vault_item_id: 'b', title: 'B', gap_type: 'MISSING_NOTE', consequence: '', is_root_credential: true, importance_score: 0.2 },
      { vault_item_id: 'c', title: 'C', gap_type: 'MISSING_NOTE', consequence: '', is_root_credential: false, importance_score: 0.95 },
    ]);
    expect(gaps.map((g) => g.vault_item_id)).toEqual(['b', 'c', 'a']);
  });
});

describe('runPrioritize', () => {
  it('joins access_rules to decide recipient coverage and counts custody risks', async () => {
    mockMeta.mockResolvedValueOnce([
      meta({ id: 'passport', title: 'Passport', irreplaceable: true, backup_note: '' }),
      meta({ id: 'gmail', title: 'Gmail', backup_note: 'documented' }),
    ]);
    mockQuery.mockResolvedValueOnce(qResult([{ vault_item_id: 'gmail' }])); // only gmail has a recipient
    const out = await runPrioritize('owner-1');
    expect(out.custodyRiskCount).toBe(1);
    expect(out.gaps[0].vault_item_id).toBe('passport');
  });
});

/*
 * 🔴 REQUIREMENT 12 WAS BUILT AND CALLED BY NOTHING. detectGaps, rankGaps and
 * runPrioritize were all implemented and tested, and `runPrioritize` had zero
 * production callers — so the "Custody Risk" label the requirement names had
 * never once been shown to an owner.
 *
 * A CUSTODY_RISK is an irreplaceable item — a deed, a will, an ID — with nobody
 * scoped to it or no note saying what it is for. Those cannot be regenerated
 * from a login, so an owner who never learns they are unreachable keeps a vault
 * that looks complete and loses exactly the things that cannot be replaced.
 *
 * This asserts the WIRING, because both halves passed their own tests while the
 * requirement shipped switched off — the same shape as Requirement 13.
 */
describe('Requirement 12 is actually reachable', () => {
  it('runs on vault load and renders the gaps', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    const page = strip(readFileSync('src/app/(owner)/vault/page.tsx', 'utf8'));
    /*
      The CALL, not the identifier. The first version of this assertion read
      `toContain('runPrioritize')` and passed while the call had been deleted,
      because the import line still mentions the name — the same
      matching-something-adjacent fault that bit four other checks in this
      session. Caught by breaking it on purpose.
    */
    expect(page).toMatch(/runPrioritize\(\s*session\.ownerId\s*\)/);
    expect(page).toMatch(/<GapList\s+gaps=/);

    // The label the requirement names, on the surface an owner actually opens.
    const list = strip(readFileSync('src/app/(owner)/vault/GapList.tsx', 'utf8'));
    expect(list).toContain('Custody Risk');
    // Req 12.4: the consequence travels with the gap, not just its name.
    expect(list).toContain('consequence');
  });

  it('never blocks the owner — the scan is advisory (Req 12.7)', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/(owner)/vault/page.tsx', 'utf8');
    // A failed scan must not stop somebody reaching their own vault.
    expect(page).toMatch(/try\s*\{[\s\S]*runPrioritize[\s\S]*\}\s*catch/);
  });
});
