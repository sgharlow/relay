/**
 * Tests for the graceful close (J9-R4).
 *
 * The load-bearing test is the FIRST one: an unverified bearer must get null,
 * so the route falls back to the flat generic error. The graceful message
 * confirms that a vault exists, that a specific recipient was granted access to
 * it, and how many items — none of which is safe to hand an unknown caller.
 * Signature verification is the entire boundary.
 *
 * Feature: relay-h0-mvp
 * Requirements: J9-R4, 7.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));

import { query } from '../db/connection';
import { verifyRecipientToken } from '../auth/recipient-token';
import { getClosureSummary, getClosureSummaryForUser } from './closure';

const mockQuery = vi.mocked(query);
const mockVerify = vi.mocked(verifyRecipientToken);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

/** release_state → granted count → opened rows → activity window. */
function installQueries(opts: {
  releaseState?: unknown[];
  granted?: string;
  opened?: unknown[];
  first?: string | null;
  last?: string | null;
}) {
  const {
    releaseState = [{ owner_id: 'owner-1', trigger_type: 'caregiver', version: '9' }],
    granted = '5',
    opened = [],
    first = '2026-08-08T10:00:00.000Z',
    last = '2026-08-08T16:00:00.000Z',
  } = opts;

  mockQuery
    .mockResolvedValueOnce(qResult(releaseState))
    .mockResolvedValueOnce(qResult([{ n: granted }]))
    .mockResolvedValueOnce(qResult(opened))
    .mockResolvedValueOnce(qResult([{ first_ts: first, last_ts: last }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue({
    recipientId: 'r-1',
    releaseStateId: 'rs-1',
    version: '4',
  } as never);
});

describe('security boundary', () => {
  it('returns NULL for a token that fails verification — say nothing to an unknown bearer', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    await expect(getClosureSummary('forged.token.here')).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns null when the release state no longer exists', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(getClosureSummary('t')).resolves.toBeNull();
  });

  it('counts the grant from access_rules, not from anything the token carries', async () => {
    installQueries({ granted: '3' });
    const s = await getClosureSummary('t');

    expect(s?.grantedCount).toBe(3);
    const grantSql = mockQuery.mock.calls[1][0] as string;
    expect(grantSql).toContain('FROM access_rules');
    expect(mockQuery.mock.calls[1][1]).toEqual(['owner-1', 'r-1', 'caregiver']);
  });

  it('counts ONLY authorized decrypts — a denied attempt is not an item you opened', async () => {
    installQueries({});
    await getClosureSummary('t');

    const openedSql = mockQuery.mock.calls[2][0] as string;
    expect(openedSql).toContain("detail->>'outcome' = 'authorized'");
    expect(openedSql).toContain("action = 'vault_item_decrypted'");
  });

  it('scopes the opened query to this recipient only', async () => {
    installQueries({});
    await getClosureSummary('t');
    expect(mockQuery.mock.calls[2][1]).toEqual(['owner-1', 'recipient:r-1']);
  });

  it('never selects ciphertext, wrapped keys or kms ids', async () => {
    installQueries({});
    await getClosureSummary('t');

    for (const call of mockQuery.mock.calls) {
      const sql = String(call[0]).toLowerCase();
      expect(sql).not.toContain('ciphertext');
      expect(sql).not.toContain('wrapped_data_key');
      expect(sql).not.toContain('kms_key_id');
    }
  });
});

describe('summary content', () => {
  it('lists opened items with their titles', async () => {
    installQueries({
      opened: [
        { entity_id: 'i-1', ts: '2026-08-08T15:00:00.000Z', title: 'Chase checking' },
        { entity_id: 'i-2', ts: '2026-08-08T12:00:00.000Z', title: 'Their primary email' },
      ],
    });

    const s = await getClosureSummary('t');
    expect(s?.opened.map((o) => o.title)).toEqual(['Chase checking', 'Their primary email']);
  });

  it('DEDUPLICATES repeat opens — reading a password twice is one item seen', async () => {
    installQueries({
      opened: [
        { entity_id: 'i-1', ts: '2026-08-08T15:00:00.000Z', title: 'Chase checking' },
        { entity_id: 'i-1', ts: '2026-08-08T14:00:00.000Z', title: 'Chase checking' },
        { entity_id: 'i-1', ts: '2026-08-08T13:00:00.000Z', title: 'Chase checking' },
      ],
    });

    const s = await getClosureSummary('t');
    expect(s?.opened).toHaveLength(1);
    expect(s?.opened[0].openedAt).toBe('2026-08-08T15:00:00.000Z'); // most recent kept
  });

  it('falls back to a neutral label when the item row is gone', async () => {
    installQueries({ opened: [{ entity_id: 'i-1', ts: '2026-08-08T15:00:00.000Z', title: null }] });
    const s = await getClosureSummary('t');
    expect(s?.opened[0].title).toBe('An item');
  });

  it('skips audit rows with no entity id', async () => {
    installQueries({ opened: [{ entity_id: null, ts: '2026-08-08T15:00:00.000Z', title: 'x' }] });
    const s = await getClosureSummary('t');
    expect(s?.opened).toHaveLength(0);
  });

  it('computes whole hours between first and last activity', async () => {
    installQueries({ first: '2026-08-08T10:00:00.000Z', last: '2026-08-08T16:30:00.000Z' });
    const s = await getClosureSummary('t');
    expect(s?.hoursOfAccess).toBe(6);
  });

  it('reports 0 hours for a single visit rather than a negative or NaN', async () => {
    installQueries({ first: '2026-08-08T10:00:00.000Z', last: '2026-08-08T10:00:00.000Z' });
    const s = await getClosureSummary('t');
    expect(s?.hoursOfAccess).toBe(0);
  });

  it('handles a recipient who never looked — no activity at all', async () => {
    installQueries({ opened: [], first: null, last: null });
    const s = await getClosureSummary('t');

    expect(s).toMatchObject({ opened: [], firstSeenAt: null, lastSeenAt: null, hoursOfAccess: 0 });
  });

  it('normalises timestamps to ISO strings', async () => {
    installQueries({ first: '2026-08-08T10:00:00.000Z', last: '2026-08-08T16:00:00.000Z' });
    const s = await getClosureSummary('t');
    expect(s?.firstSeenAt).toBe('2026-08-08T10:00:00.000Z');
    expect(s?.lastSeenAt).toBe('2026-08-08T16:00:00.000Z');
  });
});

/*
 * 🔴 THE SIGNED-IN PATH'S BOUNDARY IS EVIDENCE, NOT A ROW.
 *
 * This function used to delegate to resolveReleaseForUser, which matched ANY
 * release_state belonging to the owner — so a claimed recipient of a perfectly
 * healthy owner received a full closure summary: an item count, a duration, and
 * "Everything is back to normal. The vault has been re-armed." Nothing had ever
 * opened for them.
 *
 * It cannot be fixed by asking for a released row either: after a genuine close
 * the row is re-armed, so the true J9-R4 case looks identical by state. The only
 * thing that separates "your access ended" from "nothing ever happened" is
 * whether this person actually did anything, which is what the audit chain is
 * for. Hence: no footprint, no summary.
 */
describe('the signed-in closure path', () => {
  it('says nothing to a recipient who never had access', async () => {
    mockQuery.mockResolvedValueOnce(qResult([])); // no audit footprint
    await expect(getClosureSummaryForUser('user-1')).resolves.toBeNull();
    // It must not go on to compute a summary for somebody with no history.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('looks for the recipient OWN footprint, and only for real access events', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await getClosureSummaryForUser('user-1');

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('claimed_user_id = $1');
    expect(sql).toContain("'recipient:' || r.id");
    expect(sql).toContain('recipient_dashboard_viewed');
    expect(sql).toContain('vault_item_decrypted');
    // A withdrawn recipient is not owed a farewell.
    expect(sql).toContain("<> 'revoked'");
  });

  it('returns the summary for someone whose footprint is really there', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ recipient_id: 'r-1', release_state_id: 'rs-1' }]));
    installQueries({ granted: '3' });

    const s = await getClosureSummaryForUser('user-1');

    expect(s?.grantedCount).toBe(3);
  });
});
