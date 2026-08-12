/**
 * Tests for claiming a standby role.
 *
 * Redemption already existed and did half the job: it validated the code and
 * stamped `claimed_at`. What it never did was bind an IDENTITY — no `users` row,
 * no `claimed_user_id` — so "claimed" meant "someone typed the code", not "this
 * person can now be reached by signing in". That is the half that lets a release
 * transmit nothing secret.
 *
 * The property with the most money on it is the multi-hat case: a contact who is
 * already signed in must LINK a second relationship, never mint a second account.
 * Routing that through signup severs every standby link that person already
 * holds, which silently breaks the acquisition loop the architecture was adopted
 * for (docs/standby-architecture.md §3.7 rule 2).
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
// Mocked because claim.ts must NOT re-derive the upsert: this data layer needs
// the app-level intent-read, and INSERT ... ON CONFLICT (auth_sub) 500s on real
// DSQL. Mocking it here keeps this file testing claim.ts's own decisions.
vi.mock('../auth/upsert-user', () => ({
  upsertUser: vi.fn(async () => ({ id: 'user-9', email: 'sister@example.com', is_demo_account: false })),
}));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { claimStandbyRole } from './claim';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

const INVITE = {
  id: 'inv-1',
  owner_id: 'owner-1',
  person_id: 'rec-1',
  person_type: 'recipient' as const,
  failed_attempts: 0,
};

function rows(...batches: unknown[][]) {
  for (const b of batches) mockQuery.mockResolvedValueOnce({ rows: b, rowCount: b.length } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset(); // clearAllMocks leaves the ...Once queue intact
});

describe('claimStandbyRole — binding an identity to a roster row', () => {
  it('creates a user for a first-time claimer and links it to the roster row', async () => {
    rows(
      [INVITE], // find invitation
      [], // mark claimed
      [{ email: 'sister@example.com' }], // roster row email
      [], // link claimed_user_id + standby_state
    );

    const out = await claimStandbyRole({ token: 'ABCDE-FGHIJ' });

    expect(out).toMatchObject({
      userId: 'user-9',
      ownerId: 'owner-1',
      personId: 'rec-1',
      personType: 'recipient',
      linkedExisting: false,
    });

    const linkSql = String(mockQuery.mock.calls.at(-1)?.[0]);
    expect(linkSql).toContain('UPDATE recipients');
    expect(linkSql).toContain('claimed_user_id');
    expect(linkSql).toContain('standby_state');
  });

  it('LINKS an already-signed-in user instead of minting a second account', async () => {
    rows(
      [INVITE],
      [],
      [], // link — no user lookup or upsert should happen at all
    );

    const out = await claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' });

    expect(out).toMatchObject({ userId: 'user-77', linkedExisting: true });

    // The decisive assertion: nothing inserted into users.
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('INSERT INTO users');
  });

  it('writes the roster row for a verifier too, not only a recipient', async () => {
    rows(
      [{ ...INVITE, person_type: 'verifier', person_id: 'ver-1' }],
      [],
      [{ email: 'uncle@example.com' }],
      [],
    );

    await claimStandbyRole({ token: 'ABCDE-FGHIJ' });

    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain('UPDATE verifiers');
  });

  it('records the claim in the audit log against the OWNER, whose circle changed', async () => {
    rows([INVITE], [], [{ email: 'sister@example.com' }], []);

    await claimStandbyRole({ token: 'ABCDE-FGHIJ' });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'standby_claimed' }),
    );
  });

  it('rejects an unknown, expired or already-used code with one indistinguishable error', async () => {
    rows([]); // SQL filters expiry and single-use, so all three arrive as no row

    await expect(claimStandbyRole({ token: 'BADBA-DBADB' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a code that has burned through its attempt budget', async () => {
    rows([{ ...INVITE, failed_attempts: 10 }]);

    await expect(claimStandbyRole({ token: 'ABCDE-FGHIJ' })).rejects.toBeInstanceOf(ValidationError);

    // It must NOT go on to claim the invitation after refusing.
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('SET claimed_at');
  });

  it('counts a failed attempt against the row so a stale code cannot be probed forever', async () => {
    rows([{ ...INVITE, failed_attempts: 10 }]);

    await claimStandbyRole({ token: 'ABCDE-FGHIJ' }).catch(() => {});

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).toContain('failed_attempts = failed_attempts + 1');
  });
});
