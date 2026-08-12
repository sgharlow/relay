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

  it('reports NOT released when the owner has re-armed — read fresh, every call', async () => {
    // The whole point of dropping the token: there is no cached version to go
    // stale, because the row is the only source and it is read each time.
    rows([{ ...CLAIM_ROW, state: 'armed' }]);

    const out = await resolveReleaseForUser('user-1');

    expect(out?.released).toBe(false);
    expect(out?.state).toBe('armed');
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
