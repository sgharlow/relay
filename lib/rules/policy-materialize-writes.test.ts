/**
 * The half of materialization that WRITES — and had no tests at all.
 *
 * 🔴 FOUND BY THE PRE-RELEASE COVERAGE PASS, 2026-08-13. policy-materialize.ts
 * measured 10.6% statements and 0% branches, the worst file in the repo, and it
 * is the file that creates and revokes rows in `access_rules` — which its own
 * header calls "the sole authority consulted by the KMS unwrap path". The
 * existing test file covers `diffGrants`, the pure function, and nothing that
 * applies the diff. The arithmetic of who should have access was verified; the
 * act of granting it was not.
 *
 * Every assertion here is an access-control invariant, not a mechanic:
 *   - narrowing a policy REVOKES (J4-R14) — append-only would silently widen
 *   - revocation is scoped by policy_id, so a hand-made rule survives
 *   - every write is scoped by owner_id, because DSQL has no foreign keys and
 *     nothing else would refuse a cross-owner grant
 *   - a new item is auto-covered by matching policies (J4-R4)
 *   - policies die before their rules, so a revoked grant cannot re-materialise
 *     on the next run (J4-R15)
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R4, J4-R14, J4-R15
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isSqlState40001: vi.fn(() => false),
}));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  materializePolicy,
  coverNewItem,
  previewPolicyChange,
  deletePoliciesForRecipient,
} from './policy-materialize';

const mockQuery = vi.mocked(query);
const OWNER = 'owner-1';
const POLICY = 'policy-1';
const RECIPIENT = 'rec-1';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  category: 'finance',
  criticality: 'critical',
  is_root_credential: false,
  irreplaceable: false,
  importance_score: 0.9,
  ...over,
});

const policyRow = (over: Record<string, unknown> = {}) => ({
  id: POLICY,
  recipient_id: RECIPIENT,
  trigger_type: 'emergency',
  scope: 'view',
  reversible: true,
  predicate: { criticalities: ['critical'] },
  ...over,
});

/**
 * Routes on the SQL, never on call order. Positional mocks in this repo have
 * broken several times when an unrelated query was added ahead of them, and a
 * test that counts calls the implementation does not make passes for the wrong
 * reason. Reads are answered from the fixture; everything else is a WRITE and
 * gets captured for inspection.
 */
function db(opts: {
  policy?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
  grants?: string[];
  policies?: Record<string, unknown>[];
}) {
  const writes: { sql: string; params: unknown[] }[] = [];
  mockQuery.mockImplementation((async (sql: string, params: unknown[] = []) => {
    if (/FROM access_policies/.test(sql) && /WHERE id/.test(sql)) {
      return { rows: opts.policy ? [opts.policy] : [], rowCount: opts.policy ? 1 : 0 };
    }
    if (/FROM vault_items/.test(sql)) {
      return { rows: opts.items ?? [], rowCount: (opts.items ?? []).length };
    }
    if (/SELECT vault_item_id FROM access_rules/.test(sql)) {
      const g = (opts.grants ?? []).map((vault_item_id) => ({ vault_item_id }));
      return { rows: g, rowCount: g.length };
    }
    if (/FROM access_policies/.test(sql)) {
      return { rows: opts.policies ?? [], rowCount: (opts.policies ?? []).length };
    }
    writes.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }) as never);
  return writes;
}

beforeEach(() => {
  mockQuery.mockReset();
  vi.mocked(writeAuditEntry).mockClear();
});

describe('materializePolicy', () => {
  it('grants access to every newly matching item', async () => {
    const writes = db({ policy: policyRow(), items: [item('i1'), item('i2')], grants: [] });
    expect(await materializePolicy(OWNER, POLICY)).toEqual({ added: 2, removed: 0 });
    expect(writes.filter((w) => /INSERT INTO access_rules/.test(w.sql))).toHaveLength(2);
  });

  /*
    THE ONE THAT MATTERS. Narrowing a policy has to take access away. If this
    ever appends instead of diffing, every edit widens the circle silently and
    nothing in the product would say so.
  */
  it('REVOKES a grant the policy no longer covers', async () => {
    const writes = db({
      policy: policyRow(),
      items: [item('i1'), item('i2', { criticality: 'low' })],
      grants: ['i1', 'i2'],
    });
    expect(await materializePolicy(OWNER, POLICY)).toEqual({ added: 0, removed: 1 });
    const del = writes.find((w) => /DELETE FROM access_rules/.test(w.sql));
    expect(del, 'a narrowed policy must delete, not merely stop adding').toBeTruthy();
    expect(del?.params).toContainEqual(['i2']);
  });

  it('scopes revocation by policy_id, so a hand-made rule survives', async () => {
    const writes = db({ policy: policyRow(), items: [], grants: ['i1'] });
    await materializePolicy(OWNER, POLICY);
    const del = writes.find((w) => /DELETE FROM access_rules/.test(w.sql));
    expect(del?.sql).toMatch(/policy_id\s*=\s*\$2/);
    expect(del?.params[1]).toBe(POLICY);
  });

  it('scopes every write by owner — nothing else would refuse a cross-owner grant', async () => {
    const writes = db({ policy: policyRow(), items: [item('i1')], grants: ['i9'] });
    await materializePolicy(OWNER, POLICY);
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.sql).toMatch(/owner_id/);
      expect(w.params[0]).toBe(OWNER);
    }
  });

  it('records what it changed, so a grant is never invisible', async () => {
    db({ policy: policyRow(), items: [item('i1')], grants: [] });
    await materializePolicy(OWNER, POLICY);
    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ action: 'policy_materialized' }),
    );
  });

  it('writes no audit entry when nothing changed', async () => {
    db({ policy: policyRow(), items: [item('i1')], grants: ['i1'] });
    expect(await materializePolicy(OWNER, POLICY)).toEqual({ added: 0, removed: 0 });
    expect(vi.mocked(writeAuditEntry)).not.toHaveBeenCalled();
  });

  it('does nothing for a policy that belongs to somebody else', async () => {
    const writes = db({ policy: null, items: [item('i1')] });
    expect(await materializePolicy(OWNER, POLICY)).toEqual({ added: 0, removed: 0 });
    expect(writes).toHaveLength(0);
  });
});

describe('previewPolicyChange', () => {
  it('shows the revocations before the owner commits to them (J4-R14)', async () => {
    db({ items: [item('i1'), item('i2', { criticality: 'low' })], grants: ['i1', 'i2'] });
    expect(await previewPolicyChange(OWNER, POLICY, { criticalities: ['critical'] })).toEqual({
      toAdd: [],
      toRemove: ['i2'],
    });
  });

  it('changes nothing — it only reports', async () => {
    const writes = db({ items: [item('i1')], grants: [] });
    await previewPolicyChange(OWNER, POLICY, { criticalities: ['critical'] });
    expect(writes).toHaveLength(0);
  });
});

describe('coverNewItem', () => {
  it('covers a new item against every matching policy (J4-R4)', async () => {
    const writes = db({
      items: [item('new')],
      policies: [policyRow(), policyRow({ id: 'policy-2', recipient_id: 'rec-2' })],
    });
    expect(await coverNewItem(OWNER, 'new')).toEqual({ policiesMatched: 2 });
    expect(writes.filter((w) => /INSERT INTO access_rules/.test(w.sql))).toHaveLength(2);
  });

  it('leaves an item no policy matches uncovered, and writes nothing', async () => {
    const writes = db({ items: [item('new', { criticality: 'low' })], policies: [policyRow()] });
    expect(await coverNewItem(OWNER, 'new')).toEqual({ policiesMatched: 0 });
    expect(writes).toHaveLength(0);
    expect(vi.mocked(writeAuditEntry)).not.toHaveBeenCalled();
  });

  it('does nothing for an item that belongs to somebody else', async () => {
    const writes = db({ items: [], policies: [policyRow()] });
    expect(await coverNewItem(OWNER, 'someone-elses')).toEqual({ policiesMatched: 0 });
    expect(writes).toHaveLength(0);
  });
});

describe('deletePoliciesForRecipient', () => {
  /*
    J4-R15: the policy has to die before the rules cascade. If it survived, the
    next materialisation would re-create grants for a recipient the owner just
    removed — access returning from the dead.
  */
  it('removes the policies, scoped to this owner and this recipient', async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    mockQuery.mockImplementation((async (sql: string, params: unknown[]) => {
      seen.push({ sql, params });
      return { rows: [{ id: POLICY }], rowCount: 1 };
    }) as never);

    expect(await deletePoliciesForRecipient(OWNER, RECIPIENT)).toBe(1);
    expect(seen[0].sql).toMatch(/DELETE FROM access_policies/);
    expect(seen[0].sql).toMatch(/owner_id\s*=\s*\$1/);
    expect(seen[0].sql).toMatch(/recipient_id\s*=\s*\$2/);
    expect(seen[0].params).toEqual([OWNER, RECIPIENT]);
  });
});
