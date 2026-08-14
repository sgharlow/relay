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
import { fingerprintFor } from '../people/fingerprint';
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
  // Anything the `rows(...)` sequence does not spell out answers empty rather
  // than undefined. These tests assert on ONE thing each, and a positional mock
  // that crashes the moment an unrelated query is added makes every future
  // change look like a regression in tests that were never about it — which is
  // exactly what happened when the already-answered lookup landed.
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
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

  it('stops asking a verifier who has already answered', async () => {
    // Found live on 2026-08-12: after confirming, the card went on saying "They
    // need your answer". Submitting again was safely idempotent, but being asked
    // the same question twice during an emergency reads as the product having
    // lost the answer — and a verifier who stops trusting the ask stops
    // answering, which is the one failure this journey cannot absorb.
    rows(
      [VERIFIER_ROW],
      [{ owner_id: 'owner-2', release_state_id: 'rs-1', trigger_type: 'emergency', state: 'grace', case_id: 'RLY-A' }],
      [{ verifier_id: 'ver-1', release_state_id: 'rs-1' }],
    );

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].awaitingDecision).toBe(false);
  });

  it('still asks a verifier who has not answered THIS release', async () => {
    rows(
      [VERIFIER_ROW],
      [{ owner_id: 'owner-2', release_state_id: 'rs-1', trigger_type: 'emergency', state: 'pending', case_id: 'RLY-A' }],
      // An answer to a DIFFERENT release must not silence this one.
      [{ verifier_id: 'ver-1', release_state_id: 'rs-earlier' }],
    );

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].awaitingDecision).toBe(true);
  });

  it('asks nothing of a verifier once the release is RELEASED', async () => {
    // The decision has been made and acted on; there is no question left.
    rows(
      [VERIFIER_ROW],
      [{ owner_id: 'owner-2', release_state_id: 'rs-1', trigger_type: 'emergency', state: 'released', case_id: 'RLY-A' }],
      [],
    );

    const out = await resolveStandbyFor({ userId: 'user-1' });

    expect(out.relationships[0].awaitingDecision).toBe(false);
  });

  it('leaves awaitingDecision undefined for a recipient', async () => {
    rows([RECIPIENT_ROW], []);
    const out = await resolveStandbyFor({ userId: 'user-1' });
    expect(out.relationships[0].awaitingDecision).toBeUndefined();
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

describe('🔴 owner label — found by writing the user manual 2026-08-12', () => {
  it('prefers the display name over the email address', async () => {
    // This selected `u.email` and nothing else, so the one screen a standby
    // contact returns to for years said someone@gmail.com while every message
    // Relay sent on the owner's behalf said "Margaret". The Account page's own
    // copy names the cost: "the worst possible moment for it to say an email
    // address they do not recognise."
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            person_id: 'p-1',
            person_type: 'recipient',
            owner_id: 'o-1',
            owner_email: 'margaret@example.com',
            owner_display_name: 'Margaret Chen',
            standby_state: 'confirmed',
          },
        ],
      } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const res = await resolveStandbyFor({ userId: 'u-1' });
    expect(res.relationships[0].ownerLabel).toBe('Margaret Chen');
  });

  it('falls back to the address when no name is set, never to nothing', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            person_id: 'p-1',
            person_type: 'recipient',
            owner_id: 'o-1',
            owner_email: 'margaret@example.com',
            owner_display_name: null,
            standby_state: 'confirmed',
          },
        ],
      } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const res = await resolveStandbyFor({ userId: 'u-1' });
    expect(res.relationships[0].ownerLabel).toBe('margaret@example.com');
  });

  it('actually asks the database for the display name', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await resolveStandbyFor({ userId: 'u-1' });
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/display_name/);
  });
});

describe('🔴 the contact side of the verification call — 2026-08-12', () => {
  function oneRelationship(state = 'claimed') {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          person_id: 'p-1',
          person_type: 'recipient',
          owner_id: 'o-1',
          owner_email: 'm@example.com',
          owner_display_name: 'Margaret Chen',
          standby_state: state,
        }],
      } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);
  }

  it('gives the contact the same four words the owner is told to read out', async () => {
    // The owner's screen has always said "They see the same four words on their
    // own screen." Nothing showed them, so the owner was reading a phrase at
    // somebody holding nothing — and "do these match?" answered by a person with
    // nothing to compare is a yes. That is the rubber stamp this control exists
    // to prevent, on the step the whole quorum model rests on.
    oneRelationship();
    const res = await resolveStandbyFor({ userId: 'u-1' });

    const expected = fingerprintFor({ ownerId: 'o-1', personId: 'p-1', claimedUserId: 'u-1' });
    expect(res.relationships[0].fingerprint).toBe(expected);
    expect(expected.split(/\s+/).length).toBeGreaterThanOrEqual(3);
  });

  it('derives it from the same three values as the owner side, so they cannot drift', async () => {
    oneRelationship();
    const res = await resolveStandbyFor({ userId: 'u-1' });

    // A different binding must produce a different phrase — that is what makes a
    // re-claim invalidate an old confirmation (Risk 8).
    const other = fingerprintFor({ ownerId: 'o-1', personId: 'p-1', claimedUserId: 'someone-else' });
    expect(res.relationships[0].fingerprint).not.toBe(other);
  });
});


/**
 * 🔴 AN UNANSWERED ASK USED TO LOOK LIKE NOTHING HAPPENED. An access_request in
 * awaiting_owner creates no release row, so /standby said "Nothing open." and
 * offered the Ask control again — the confirmation lived only in component
 * state, gone on reload. Every ask is deliberately loud (owner + whole circle,
 * J6-R9), so a worried requester checking hourly tripled the family's email
 * until the velocity cap refused them, never once shown their first ask was
 * heard. The standing answer now comes from the database.
 */
describe('the requester can see their own unanswered ask', () => {
  function route(withAsk: boolean) {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes('FROM recipients r JOIN users')) {
        return {
          rows: [{
            person_id: 'rec-1',
            person_type: 'recipient',
            owner_id: 'o-1',
            owner_email: 'm@example.com',
            owner_display_name: 'Margaret Chen',
            standby_state: 'confirmed',
          }],
          rowCount: 1,
        } as never;
      }
      if (q.includes('FROM access_requests')) {
        return {
          rows: withAsk
            ? [{ recipient_id: 'rec-1', case_id: 'RLY-TEST-0001', expires_at: '2026-08-14T12:00:00Z' }]
            : [],
          rowCount: withAsk ? 1 : 0,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  }

  it('surfaces the pending ask on the relationship', async () => {
    route(true);
    const res = await resolveStandbyFor({ userId: 'u-1' });
    expect(res.relationships[0].pendingAsk).toEqual({
      caseId: 'RLY-TEST-0001',
      expiresAt: '2026-08-14T12:00:00Z',
    });
  });

  it('is null when nothing is pending — the Ask control may render', async () => {
    route(false);
    const res = await resolveStandbyFor({ userId: 'u-1' });
    expect(res.relationships[0].pendingAsk).toBeNull();
  });
});
