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
import { claimStandbyRole, MAX_STANDBY } from './claim';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

const INVITE = {
  id: 'inv-1',
  owner_id: 'owner-1',
  person_id: 'rec-1',
  person_type: 'recipient' as const,
  failed_attempts: 0,
};

/**
 * Queue query() results in order.
 *
 * An array is a SELECT: those rows, and rowCount is how many came back. A
 * NUMBER is a write: no rows, and rowCount is how many were AFFECTED.
 *
 * ⚠️ THE DISTINCTION IS NEW AND IT MATTERS. This helper used to derive rowCount
 * from the array length, so an UPDATE was written as `[]` — which reads as
 * "zero rows affected". That was harmless while the stamp was unconditional and
 * nothing looked at the result. Now that `claimed_at IS NULL` makes the write a
 * compare-and-swap, rowCount 0 is exactly how the code learns it LOST a race, so
 * a mock that says `[]` for a successful claim is asserting the opposite of what
 * it means.
 */
function rows(...batches: (unknown[] | number)[]) {
  for (const b of batches) {
    mockQuery.mockResolvedValueOnce(
      (typeof b === 'number' ? { rows: [], rowCount: b } : { rows: b, rowCount: b.length }) as never,
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset(); // clearAllMocks leaves the ...Once queue intact
});

describe('claimStandbyRole — binding an identity to a roster row', () => {
  it('creates a user for a first-time claimer and links it to the roster row', async () => {
    rows(
      [INVITE], // find invitation
      1, // mark claimed — one row AFFECTED, i.e. this caller won the CAS
      [{ email: 'sister@example.com' }], // roster row email
      [{ n: '0' }], // §3.7 rule 10 — how many relationships this person already holds
      1,  // link claimed_user_id + standby_state — ONE row affected
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
      1, // mark claimed — won the CAS
      [{ n: '0' }], // the standby cap count
      1,  // link — no user lookup or upsert should happen at all
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
      1, // mark claimed — won the CAS
      [{ email: 'uncle@example.com' }],
      [{ n: '0' }],
      1,
    );

    await claimStandbyRole({ token: 'ABCDE-FGHIJ' });

    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain('UPDATE verifiers');
  });

  it('records the claim in the audit log against the OWNER, whose circle changed', async () => {
    rows([INVITE], 1, [{ email: 'sister@example.com' }], [{ n: '0' }], 1);

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

describe('an invitation whose roster row is gone', () => {
  it('refuses instead of minting a session with no role', async () => {
    /*
      🔴 THE ORPHAN INVITATION. `deleteRecipient`/`deleteVerifier` cascaded only
      access_policies and access_rules, so removing somebody left their
      unexpired invitation behind. The code-entry paths refuse when the roster
      row has gone — break-glass.ts checks, and the branch below that looks up
      the person's email fails on `if (!email)`. This branch does not look the
      person up at all: `existingUserId` skips straight to the binding UPDATE,
      which matched ZERO rows and whose rowCount nobody read.

      So the invitation was burned, the caller got a session bound to nothing,
      and `standby_claimed` was written into the OWNER's tamper-evident log for
      a person who does not exist. The cascade is fixed in recipients.ts and
      verifiers.ts; this is the guard at the place the mistake actually lands,
      because rows written before that fix are still out there with up to thirty
      days to run.
    */
    rows(
      [INVITE],
      1, // won the CAS on the invitation
      [{ n: '0' }], // the standby cap count — below the cap, so it proceeds
      0, // the binding UPDATE matched NOTHING — the owner removed this person
    );

    await expect(
      claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' }),
    ).rejects.toThrow(ValidationError);

    expect(
      writeAuditEntry,
      'a claim was recorded against the owner for a person who no longer exists',
    ).not.toHaveBeenCalled();
  });
});

describe('re-claiming invalidates a confirmation made about someone else', () => {
  it('clears fingerprint_confirmed_at, so the owner is asked again', async () => {
    // Risk 8. A re-claim binds a different claimed_user_id, which changes the
    // derived phrase — an earlier confirmation was an assertion about a
    // DIFFERENT human holding this slot and must not silently stand.
    rows([INVITE], 1, [{ email: 'sister@example.com' }], [{ n: '0' }], 1);

    await claimStandbyRole({ token: 'ABCDE-FGHIJ' });

    const bind = String(mockQuery.mock.calls.at(-1)?.[0]);
    expect(bind).toContain('fingerprint_confirmed_at = NULL');
    expect(bind).toContain("standby_state = 'claimed'");
    // §8.1: the marker records that somebody will never hold an account, and
    // they just did. Cleared in the SAME statement as the binding, so it cannot
    // be forgotten by a future path that binds an identity.
    expect(bind).toContain('break_glass_only = false');
  });
});

describe('the standby cap — §3.7 rule 10 (B23)', () => {
  it('refuses the claim when the person already holds MAX_STANDBY relationships', async () => {
    rows(
      [INVITE],
      1, // won the CAS — the code is spent before identity work, by design
      [{ n: String(MAX_STANDBY) }], // already at the cap
    );

    await expect(
      claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' }),
    ).rejects.toBeInstanceOf(ValidationError);

    // The refusal must actually refuse: no binding UPDATE ran. (The cap-count
    // SELECT also names claimed_user_id, so pin the write's SET clause.)
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('SET claimed_user_id');

    // §3.7 rule 4: a cap refusal written to the OWNER's audit chain would tell
    // the owner this contact stands by for many others — the exact enumeration
    // the rule forbids. Nothing is written.
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });

  it('tells the claimer what happened without counting anything for anybody (§3.7 rule 4)', async () => {
    rows([INVITE], 1, [{ n: String(MAX_STANDBY + 3) }]);

    const err = await claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' }).catch(
      (e: ValidationError) => e,
    );

    expect(err).toBeInstanceOf(ValidationError);
    // Distinguishable from the generic code refusal — a claimer retyping a
    // burned code forever, with the owner reissuing into the same wall, is a
    // silent cap, and a silent cap is hostile to exactly the person it limits.
    expect((err as ValidationError).message).toContain('maximum number of people');
    // No count, no names: the message travels through a 400 body and could be
    // screenshotted to the owner. It must enumerate nothing (rule 4).
    expect((err as ValidationError).message).not.toMatch(/\d/);
  });

  it('counts across BOTH tables and EXCLUDES the row being claimed, so a re-claim is never self-refused', async () => {
    rows([INVITE], 1, [{ n: '0' }], 1);

    await claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' });

    // Pin the ARGUMENTS, not the mocked result — a mock answers whatever it was
    // asked. The count must be keyed on the resolved user AND exclude the slot
    // being claimed, or a reissued invitation to someone at the cap refuses
    // their own existing row.
    const capCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('count(*)'));
    expect(capCall, 'no cap-count query ran at all').toBeDefined();
    const capSql = String(capCall?.[0]);
    expect(capSql).toContain('FROM recipients');
    expect(capSql).toContain('FROM verifiers');
    expect(capSql).toContain('id <> $2');
    expect(capCall?.[1]).toEqual(['user-77', 'rec-1']);
  });

  it('fails loudly when the count query returns nothing, instead of reading absence as zero', async () => {
    // Blind-guard shape: a cap whose count silently reads as 0 on a broken
    // query is a cap that has been disabled without anybody deciding to.
    rows([INVITE], 1, []);

    await expect(
      claimStandbyRole({ token: 'ABCDE-FGHIJ', existingUserId: 'user-77' }),
    ).rejects.toThrow(/refusing to guess/);
  });
});
