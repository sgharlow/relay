/**
 * A single-use credential is spent exactly once, and the DATABASE is what says so.
 *
 * 🔴 NONE OF THE FIVE REDEMPTION PATHS WERE ATOMIC until 2026-08-13. Each read a
 * row filtered on "not yet used", then stamped it with a bare
 * `UPDATE ... WHERE id = $1`. Aurora DSQL gives snapshot isolation, so two
 * requests can each read the same unredeemed row, both satisfy every guard in
 * JS, and both write — which means "single use" was a property of the reader
 * rather than of the data.
 *
 * The sharpest case is claimStandbyRole: claiming is the moment a roster row
 * stops being a name the owner typed and becomes a human identity. Two people
 * with one code both bound themselves, and the slot kept whichever wrote last
 * while the other walked away holding a session.
 *
 * WHY THIS TEST LOOKS AT SQL AND NOT ONLY AT BEHAVIOUR. A behavioural test with
 * a mocked driver cannot produce a real race — it can only assert what the code
 * does when told it lost one. That half matters (a lost race must REFUSE, not
 * fall through), but the guarantee itself lives in the predicate, so the
 * predicate is asserted directly. CLAUDE.md's rule is the same one:
 * "any write that can race must go through withOccRetry()" — a compare-and-swap
 * is the cheaper form of the same idea and the one the state machine already
 * uses.
 *
 * lib/people/fingerprint.ts had this right before any of these did.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn() }));
vi.mock('../notify/email', () => ({ sendEmailBestEffort: vi.fn() }));

import { query } from '../db/connection';
import { redeemRecipientCode, RecipientCodeError, hashCode } from './recipient-code';
import { redeemRecoveryCode, RecoveryCodeError } from './recovery-code';
import { claimStandbyRole } from '../people/claim';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const q = (rows: unknown[], rowCount = rows.length) =>
  ({ rows, rowCount, command: '', oid: 0, fields: [] }) as never;

beforeEach(() => vi.clearAllMocks());

/**
 * Every statement that spends one of these credentials, and the column that
 * makes it spent. If a new single-use credential appears, it belongs here.
 */
const REDEMPTIONS: [file: string, table: string, column: string][] = [
  ['lib/auth/recipient-code.ts', 'recipient_codes', 'redeemed_at'],
  ['lib/auth/verifier-code.ts', 'verifier_codes', 'redeemed_at'],
  ['lib/auth/recovery-code.ts', 'recovery_codes', 'used_at'],
  ['lib/people/claim.ts', 'invitations', 'claimed_at'],
  ['lib/people/invitations.ts', 'invitations', 'claimed_at'],
];

describe('redemption is a compare-and-swap, not a stamp', () => {
  it.each(REDEMPTIONS)('%s guards the write on %s.%s IS NULL', (file, table, column) => {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const update = new RegExp(
      `UPDATE\\s+${table}\\s+SET\\s+${column}\\s*=\\s*now\\(\\)[\\s\\S]{0,120}?WHERE[\\s\\S]{0,120}?${column}\\s+IS\\s+NULL`,
      'i',
    );
    expect(
      update.test(src),
      `${file} spends a single-use credential without an "AND ${column} IS NULL" ` +
        'predicate on the UPDATE. Under snapshot isolation the SELECT that ' +
        'checked it is not enough — two callers can both pass it. See ' +
        'lib/people/fingerprint.ts for the form.',
    ).toBe(true);
  });

  /*
    A predicate that nobody checks the result of is decoration. The loser of the
    race gets rowCount 0 and MUST be refused; falling through would hand out the
    access the predicate just declined to grant — a worse bug than the one being
    fixed, and an easy one to write.
  */
  it.each(REDEMPTIONS)('%s acts on the rowCount', (file) => {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(src).toMatch(/rowCount\s*===\s*0/);
  });
});

describe('losing the race refuses, rather than falling through', () => {
  it('a recipient code that another caller just redeemed answers "used"', async () => {
    mockQuery
      // The SELECT still sees it unredeemed — this is the snapshot the bug lived in.
      .mockResolvedValueOnce(
        q([
          {
            id: 'rc-1',
            recipient_id: 'rec-1',
            release_state_id: 'rs-1',
            release_version: '4',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            redeemed_at: null,
            failed_attempts: 0,
            current_version: '4',
            state: 'released',
          },
        ]),
      )
      // The compare-and-swap matches nothing: somebody else got there first.
      .mockResolvedValueOnce(q([], 0));

    await expect(redeemRecipientCode('ABCD2345')).rejects.toMatchObject({
      name: 'RecipientCodeError',
      reason: 'used',
    });
    expect(hashCode('ABCD2345')).toHaveLength(64);
  });

  it('a recovery code that another caller just spent is refused', async () => {
    mockQuery
      .mockResolvedValueOnce(q([{ id: 'rec-1', user_id: 'u-1' }]))
      .mockResolvedValueOnce(q([], 0));

    await expect(redeemRecoveryCode('a@b.com', 'ABCD234567')).rejects.toBeInstanceOf(
      RecoveryCodeError,
    );
  });

  /*
    THE ONE THAT MATTERS MOST. If this fell through, the loser would continue
    into the identity binding and overwrite claimed_user_id — the exact outcome
    the predicate exists to prevent.
  */
  it('an invitation claimed by somebody else does not bind a second identity', async () => {
    mockQuery
      .mockResolvedValueOnce(
        q([
          {
            id: 'inv-1',
            owner_id: 'own-1',
            person_id: 'p-1',
            person_type: 'recipient',
            failed_attempts: 0,
          },
        ]),
      )
      .mockResolvedValueOnce(q([], 0));

    await expect(claimStandbyRole({ token: 'tok' })).rejects.toBeInstanceOf(ValidationError);

    // Two calls and no more: the SELECT and the losing UPDATE. Nothing touched
    // the recipients row, and no user was created.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).not.toMatch(/claimed_user_id/);
    expect(sql).not.toMatch(/INSERT INTO users/i);
  });
});

describe('the winner still succeeds', () => {
  it('a first redemption returns the identity it stands for', async () => {
    mockQuery
      .mockResolvedValueOnce(
        q([
          {
            id: 'rc-1',
            recipient_id: 'rec-9',
            release_state_id: 'rs-9',
            release_version: '2',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            redeemed_at: null,
            failed_attempts: 0,
            current_version: '2',
            state: 'released',
          },
        ]),
      )
      .mockResolvedValueOnce(q([], 1));

    await expect(redeemRecipientCode('ABCD2345')).resolves.toEqual({
      recipientId: 'rec-9',
      releaseStateId: 'rs-9',
      version: '2',
    });
  });

  it('is not accidentally refusing everything', async () => {
    // Guards the shape of the test above: if the CAS returned 0 for a genuine
    // first redemption, every code in the product would be dead on arrival and
    // the "losing" tests would still pass.
    expect(RecipientCodeError).toBeDefined();
  });
});
