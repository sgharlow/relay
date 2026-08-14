/**
 * Tests for session-based release access — the Sprint D swap.
 *
 * TODAY a recipient redeems an emailed code for a JWT scoped to
 * (release_state.id, version) and opens `/access?token=…`. UNDER STANDBY a
 * claimed recipient signs into an account they already have, the row is read
 * fresh, and nothing secret is transmitted at release time.
 *
 * The version guarantee is what people worry about when a token disappears, so
 * it is the thing tested hardest here. It does not weaken — it gets STRONGER.
 * A JWT carries a snapshot of the version and has to be compared against the row;
 * a session carries nothing, so every request reads the current row and a re-arm
 * closes the dashboard on the next call BY CONSTRUCTION. There is no stale claim
 * to leak because there is no claim.
 *
 * The other property: an unclaimed recipient must keep working. The swap is
 * additive during the transition, and a contact who has not claimed still has the
 * emailed-code path.
 *
 * Feature: relay-standby
 * Requirements: 7.3, 7.7, J8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { resolveReleaseForUser } from './session-access';

const mockQuery = vi.mocked(query);

function rows(...batches: unknown[][]) {
  for (const b of batches) mockQuery.mockResolvedValueOnce({ rows: b, rowCount: b.length } as never);
}

const CLAIM_ROW = {
  recipient_id: 'rec-1',
  owner_id: 'owner-1',
  release_state_id: 'rs-1',
  trigger_type: 'emergency',
  state: 'released',
  version: '4',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('resolveReleaseForUser', () => {
  it('finds an open release through the CLAIMED link, never through a token', async () => {
    rows([CLAIM_ROW]);

    const out = await resolveReleaseForUser('user-1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('claimed_user_id = $1');
    expect(params[0]).toBe('user-1');
    expect(out).toMatchObject({ recipientId: 'rec-1', releaseStateId: 'rs-1', released: true });
  });

  /*
    🔴 THIS TEST USED TO ASSERT THE BUG. It fed an `armed` row to a mocked query
    and asserted `released === false`, which reads as a version-freshness
    property but actually documented the resolver matching a release that was
    never open. The caller treats a non-released resolve as CLOSED, so that row
    produced "Everything is back to normal. The vault has been re-armed" for a
    family member of an owner in perfect health.

    Because the query is mocked, no assertion about the returned row could have
    caught it — the mock supplies whatever the test asks for. The only honest
    check is on the SQL itself, which is what this now does.
  */
  it('never asks the database for a release that is not open', async () => {
    rows([]);
    await resolveReleaseForUser('user-1');

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("state IN ('pending', 'grace', 'released')");
    // An armed row is the steady state of every owner who ever wrote a rule.
    expect(sql).not.toMatch(/state\s*=\s*'armed'/);
  });

  it('still reads the row fresh on every call, so a re-arm closes the dashboard', async () => {
    // The whole point of dropping the token: there is no cached version to go
    // stale. A re-armed release now simply stops matching, so the next call
    // resolves nothing at all rather than resolving as "not released".
    rows([]);
    await expect(resolveReleaseForUser('user-1')).resolves.toBeNull();
  });

  it('resolves a release still in progress, and does not call it released', async () => {
    // pending/grace must resolve — the caller has to tell the difference
    // between "nothing is happening" and "you are waiting".
    rows([{ ...CLAIM_ROW, state: 'grace' }]);

    const out = await resolveReleaseForUser('user-1');

    expect(out?.state).toBe('grace');
    expect(out?.released).toBe(false);
  });

  it('returns null for a user with no claimed recipient row at all', async () => {
    rows([]);
    await expect(resolveReleaseForUser('nobody')).resolves.toBeNull();
  });

  it('ignores a revoked link — a withdrawn recipient opens nothing', async () => {
    rows([]);
    await resolveReleaseForUser('user-1');
    expect(String(mockQuery.mock.calls[0][0])).toContain("<> 'revoked'");
  });

  it('audits the view against the owner, exactly as the token path does', async () => {
    rows([CLAIM_ROW]);

    await resolveReleaseForUser('user-1', { audit: true });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'recipient_dashboard_viewed' }),
    );
  });

  it('does not audit a mere resolution — only an actual view', async () => {
    rows([CLAIM_ROW]);
    await resolveReleaseForUser('user-1');
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });
});
