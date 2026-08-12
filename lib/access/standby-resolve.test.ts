/**
 * Tests for standby resolution — "what am I on standby for".
 *
 * This is rung 0: the surface a contact can look at without being told anything,
 * which is the whole reason the architecture stops depending on delivery.
 *
 * The security property here is §3.7 rule 1: **`standbyFor` in the JWT is a
 * rendering hint, never an authorization.** Sessions are `strategy: 'jwt'` with
 * no adapter, so the token is a snapshot — reading membership from it would delay
 * REVOCATION by the token lifetime, and revocation is the control behind the
 * coercion risk. Every resolve reads the database.
 *
 * The second property is cross-owner confidentiality (§3.7 rule 4): standing by
 * for Margaret and for Tom must never let either of them learn about the other.
 * That is enforced on the owner-facing side, but the shape here is what makes it
 * possible — relationships are keyed by the CONTACT, never joined across owners.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../people/invitations', () => ({
  buildStandbyView: vi.fn(async () => ({
    itemCount: 4,
    categories: { finance: 3, health: 1 },
    triggerTypes: ['emergency'],
  })),
}));
vi.mock('../release/escalation', () => ({
  escalateLapsedRequestsForOwners: vi.fn(async () => []),
}));

import { query } from '../db/connection';
import { buildStandbyView } from '../people/invitations';
import { escalateLapsedRequestsForOwners } from '../release/escalation';
import { resolveStandbyFor } from './standby-resolve';

const mockQuery = vi.mocked(query);

function rows(...batches: unknown[][]) {
  for (const b of batches) mockQuery.mockResolvedValueOnce({ rows: b, rowCount: b.length } as never);
}

const RECIPIENT_ROW = {
  person_id: 'rec-1',
  person_type: 'recipient',
  owner_id: 'owner-1',
  owner_email: 'margaret@example.com',
  standby_state: 'confirmed',
};

const VERIFIER_ROW = {
  person_id: 'ver-1',
  person_type: 'verifier',
  owner_id: 'owner-2',
  owner_email: 'tom@example.com',
  standby_state: 'claimed',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('resolveStandbyFor', () => {
  it('reads relationships from the DATABASE, keyed on the claimed user', async () => {
    rows([RECIPIENT_ROW], []); // relationships, then open releases

    const out = await resolveStandbyFor({ userId: 'user-1' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('claimed_user_id = $1');
    expect(params[0]).toBe('user-1');
    expect(out.relationships).toHaveLength(1);
  });

  it('gives a recipient the SHAPE of their grant — counts and categories (J4-R10)', async () => {
    rows([RECIPIENT_ROW], []);

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].grant).toEqual({
      itemCount: 4,
      categories: { finance: 3, health: 1 },
      triggerTypes: ['emergency'],
    });
    expect(buildStandbyView).toHaveBeenCalledWith('owner-1', 'rec-1');
  });

  it('NEVER builds a grant view for a verifier — they must not see vault shape', async () => {
    rows([VERIFIER_ROW], []);

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].grant).toBeUndefined();
    expect(buildStandbyView).not.toHaveBeenCalled();
  });

  it('drives the derive-on-read escalation for exactly the owners it stands by for', async () => {
    rows([RECIPIENT_ROW, VERIFIER_ROW], []);

    await resolveStandbyFor({ userId: 'user-1' });

    const passed = vi.mocked(escalateLapsedRequestsForOwners).mock.calls[0][0];
    expect([...passed].sort()).toEqual(['owner-1', 'owner-2']);
  });

  it('reports open work so rung 0 shows something without anyone being told', async () => {
    rows(
      [VERIFIER_ROW],
      [{ owner_id: 'owner-2', release_state_id: 'rs-1', trigger_type: 'emergency', state: 'grace', case_id: 'RLY-A' }],
    );

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].openRelease).toMatchObject({
      releaseStateId: 'rs-1',
      state: 'grace',
      caseId: 'RLY-A',
    });
  });

  it('shows nothing open when nothing is open — the normal, reassuring case', async () => {
    rows([RECIPIENT_ROW], []);

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].openRelease).toBeNull();
    expect(out.anythingOpen).toBe(false);
  });

  it('excludes revoked relationships in the QUERY, where a rendering bug cannot reach', async () => {
    rows([RECIPIENT_ROW], []);

    await resolveStandbyFor({ userId: 'user-1' });

    expect(String(mockQuery.mock.calls[0][0])).toContain("<> 'revoked'");
  });

  it('also excludes a revoked row in JS, so dropping that clause cannot resurrect anyone', async () => {
    // Defence in depth: revocation is the control behind the coercion risk, so a
    // future edit to the query must not be able to silently undo it.
    rows([{ ...RECIPIENT_ROW, standby_state: 'revoked' }], []);

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships).toHaveLength(0);
  });

  it('returns an empty result for someone who stands by for nobody, without querying releases', async () => {
    rows([]);

    const out = await resolveStandbyFor({ userId: 'nobody' });

    expect(out.relationships).toEqual([]);
    expect(out.anythingOpen).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
