/**
 * Tests for lib/people/verifiers.ts
 *
 * Validates: Requirements 3.2, 3.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../db/integrity', () => ({ cascadeDelete: vi.fn(async () => undefined) }));
vi.mock('../release/withdraw-confirmations', () => ({
  withdrawVerifierAttestations: vi.fn(async () => 0),
}));

import { query } from '../db/connection';
import { cascadeDelete } from '../db/integrity';
import { withdrawVerifierAttestations } from '../release/withdraw-confirmations';
import { validateVerifierInput, createVerifier, deleteVerifier } from './verifiers';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const mockCascade = vi.mocked(cascadeDelete);
const mockWithdraw = vi.mocked(withdrawVerifierAttestations);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('validateVerifierInput', () => {
  it('accepts a valid verifier', () => {
    const v = validateVerifierInput({ name: 'Dr Lee', email: 'lee@example.com', phone: '555-1234' });
    expect(v.name).toBe('Dr Lee');
    expect(v.phone).toBe('555-1234');
  });

  it('rejects a missing name or bad email', () => {
    expect(() => validateVerifierInput({ email: 'a@b.co' })).toThrow(ValidationError);
    expect(() => validateVerifierInput({ name: 'x', email: 'bad' })).toThrow(ValidationError);
  });
});

describe('createVerifier', () => {
  it('defaults verification_status to pending in the mapping', async () => {
    // Two queries since the J4-R1 duplicate guard landed: the same-human check,
    // then the INSERT. The empty first result is "nobody by that address yet".
    mockQuery.mockResolvedValueOnce(qResult([]));
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'v1', name: 'Dr Lee', email: 'lee@example.com', phone: null, verification_status: 'pending', created_at: new Date() }]),
    );
    const v = await createVerifier('owner-1', validateVerifierInput({ name: 'Dr Lee', email: 'lee@example.com' }));
    expect(v.verification_status).toBe('pending');
  });
});

describe('deleteVerifier', () => {
  it('removes verifier_confirmations before the verifier (Req 3.7)', async () => {
    /*
      ⚠️ THIS ASSERTION WAS WEAKENED TO LET THE NEW CASCADES THROUGH, and is put
      back 2026-08-21. It was `toEqual(['withdraw','cascade-confirmations',
      'delete-verifier'])`; when deleteVerifier grew the credential cascades it
      was relaxed to three positional index checks — order[0], order[1] and
      order[last] — which stops pinning that nothing unexpected happens in
      between. Widening an exact array to match new behaviour is the correct
      move and the sibling test (recipients.test.ts, 'cascade-deletes policies,
      then rules, then the recipient') did exactly that; relaxing it to indices
      buys the same green for less guard.
    */
    const order: string[] = [];
    mockWithdraw.mockImplementation(async () => { order.push('withdraw'); return 0; });
    mockCascade.mockImplementation(async (table: string) => { order.push(`cascade-${table}`); });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM verifiers')) order.push('delete-verifier');
      return qResult([]);
    });
    await deleteVerifier('owner-1', 'v1');
    expect(mockCascade).toHaveBeenCalledWith('verifier_confirmations', 'v1', 'verifier_id', 'owner-1');
    expect(order).toEqual([
      'withdraw',
      'cascade-verifier_confirmations',
      'cascade-invitations',
      'cascade-break_glass_codes',
      'cascade-verifier_codes',
      'delete-verifier',
    ]);
  });

  it('takes back every credential issued FOR this verifier, before the roster row goes', async () => {
    // Same defect as deleteRecipient's, and the same argument: an invitation
    // token hash and a one-year break-glass code outliving the person they
    // named is a credential for a circle that no longer contains them.
    const order: string[] = [];
    mockCascade.mockImplementation(async (table: string) => {
      order.push(table);
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM verifiers')) order.push('verifiers');
      return qResult([]);
    });

    await deleteVerifier('owner-1', 'v1');

    expect(mockCascade).toHaveBeenCalledWith('invitations', 'v1', 'person_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('break_glass_codes', 'v1', 'person_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('verifier_codes', 'v1', 'verifier_id', 'owner-1');
    expect(order[order.length - 1], 'the roster row went before its credentials').toBe('verifiers');
  });

  /*
    🔴 THE VOTE OUTLIVED THE VERIFIER. Quorum is a counter on release_state, not
    a live count of verifier_confirmations, so deleting the rows left the tally
    intact and a removed verifier's attestation still counted toward opening the
    vault.

    The ORDER is the load-bearing part and is asserted above: the withdrawal
    reads the attestation rows to know what to take back, so cascading first
    would leave nothing to find and the counter permanently wrong.
  */
  it('takes the verifier vote back out of the quorum first', async () => {
    mockQuery.mockImplementation(async () => qResult([]));
    await deleteVerifier('owner-1', 'v1');
    expect(mockWithdraw).toHaveBeenCalledWith('owner-1', 'v1');
  });
});

/**
 * 🔴 ONE HUMAN, ONE VERIFIER ROW (J4-R1).
 *
 * `createRecipient` has refused a second row for the same normalised email since
 * the approvals queue shipped — "approving a delegate proposal for someone
 * already in the circle silently creates a SECOND recipient with the same email".
 * `createVerifier` never got the same guard, so the identical mistake was still
 * one submit away on the other table: two verifier rows for one person means two
 * invitations, two claim codes, two standby lights, and a quorum that counts the
 * same human twice.
 *
 * That last one is the sharp end. Quorum is a COUNT of confirmed verifiers, so a
 * duplicated person could satisfy a quorum of two on their own — which is
 * precisely the self-confirmation structure `detectRoleConcentration` exists to
 * make impossible.
 *
 * Compared on the same normalised key `listPeople` and `detectRoleConcentration`
 * use, so all three agree on what "the same person" means.
 */
describe('createVerifier refuses a duplicate human (J4-R1)', () => {
  it('refuses a second verifier row for an email already on this vault', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'v1' }]));

    await expect(
      createVerifier('owner-1', validateVerifierInput({ name: 'Sam', email: 'sam@example.com' })),
    ).rejects.toThrow(ValidationError);

    const inserted = mockQuery.mock.calls.some((c) => /INSERT INTO verifiers/i.test(String(c[0])));
    expect(inserted, 'the duplicate check must run BEFORE the INSERT').toBe(false);
  });

  it('compares on the normalised email, not the raw string', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'v2', name: 'Sam', email: ' Sam@Example.COM ', phone: null, verification_status: 'pending', created_at: new Date() }]),
    );

    await createVerifier('owner-1', validateVerifierInput({ name: 'Sam', email: 'sam@example.com' }));

    const check = String(mockQuery.mock.calls[0][0]);
    expect(check).toMatch(/SELECT id FROM verifiers/i);
    expect(check).toMatch(/lower\(trim\(email\)\)\s*=\s*lower\(trim\(\$2\)\)/i);
    expect(check).toMatch(/owner_id\s*=\s*\$1/i);
  });

  it('scopes the duplicate check to this owner — a name in another vault is not a clash', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'v3', name: 'Sam', email: 'sam@example.com', phone: null, verification_status: 'pending', created_at: new Date() }]),
    );

    await createVerifier('owner-1', validateVerifierInput({ name: 'Sam', email: 'sam@example.com' }));

    expect(mockQuery.mock.calls[0][1]).toEqual(['owner-1', 'sam@example.com']);
  });
});
