/**
 * Tests for lib/people/recipients.ts
 *
 * Validates: Requirements 3.1, 3.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../db/integrity', () => ({ cascadeDelete: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { cascadeDelete } from '../db/integrity';
import {
  validateRecipientInput,
  createRecipient,
  deleteRecipient,
  VALID_ROLES,
} from './recipients';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const mockCascade = vi.mocked(cascadeDelete);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('validateRecipientInput', () => {
  it('accepts a valid recipient and nulls empty optionals', () => {
    const r = validateRecipientInput({ name: 'Sam', email: 'sam@example.com', role: 'executor' });
    expect(r.role).toBe('executor');
    expect(r.relationship).toBeNull();
    expect(r.phone).toBeNull();
  });

  it('rejects a missing name, bad email, and invalid role', () => {
    expect(() => validateRecipientInput({ email: 'a@b.co', role: 'executor' })).toThrow(ValidationError);
    expect(() => validateRecipientInput({ name: 'x', email: 'nope', role: 'executor' })).toThrow(ValidationError);
    expect(() => validateRecipientInput({ name: 'x', email: 'a@b.co', role: 'boss' })).toThrow(ValidationError);
  });

  it('accepts every valid role', () => {
    for (const role of VALID_ROLES) {
      expect(validateRecipientInput({ name: 'x', email: 'a@b.co', role }).role).toBe(role);
    }
  });
});

describe('createRecipient', () => {
  it('inserts and returns the recipient', async () => {
    mockQuery.mockResolvedValueOnce(qResult([])); // dedupe check: no existing row
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'r1', name: 'Sam', relationship: null, email: 'sam@example.com', phone: null, role: 'executor', created_at: new Date() }]),
    );
    const r = await createRecipient('owner-1', validateRecipientInput({ name: 'Sam', email: 'sam@example.com', role: 'executor' }));
    expect(r.id).toBe('r1');
  });
});

describe('deleteRecipient', () => {
  it('cascade-deletes policies, then rules, then the recipient (Req 3.6, J4-R15)', async () => {
    const order: string[] = [];
    mockCascade.mockImplementation(async (table: string) => {
      order.push(`cascade-${table}`);
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM recipients')) order.push('delete-recipient');
      return qResult([]);
    });

    await deleteRecipient('owner-1', 'r1');

    // The owner is passed so the cascade lands in THEIR audit chain (Req 16.5).
    expect(mockCascade).toHaveBeenCalledWith('access_policies', 'r1', 'recipient_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('access_rules', 'r1', 'recipient_id', 'owner-1');

    // Policies must go FIRST: dropping only the rules would leave the
    // generating policy behind to recreate them on the next materialisation.
    expect(order).toEqual([
      'cascade-access_policies',
      'cascade-access_rules',
      'cascade-invitations',
      'cascade-break_glass_codes',
      'cascade-recipient_codes',
      'cascade-access_requests',
      'delete-recipient',
    ]);
  });

  it('takes back every credential issued FOR this person, before the roster row goes', async () => {
    /*
      🔴 REMOVING SOMEBODY DID NOT REVOKE WHAT THEY HELD. Only access_policies
      and access_rules were cascaded, so an owner who deleted a contact kept
      that contact's unexpired invitation token hash, their break-glass code
      hash (a bearer credential with a ONE-YEAR life, 023), any recipient-code
      rows and any open access request.

      The sharp end is claim.ts: a signed-in standby who later typed the orphan
      invitation burned it, got a session with no role, and wrote
      `standby_claimed` into the owner's tamper-evident log for a person who no
      longer exists. Redemption is refused on the other code paths only because
      they look the roster row up; the existing-user branch did not.

      Order matters for the same reason it does in deleteAccount: the roster row
      is what makes these findable, so it goes last.
    */
    const order: string[] = [];
    mockCascade.mockImplementation(async (table: string) => {
      order.push(table);
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM recipients')) order.push('recipients');
      return qResult([]);
    });

    await deleteRecipient('owner-1', 'r1');

    expect(mockCascade).toHaveBeenCalledWith('invitations', 'r1', 'person_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('break_glass_codes', 'r1', 'person_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('recipient_codes', 'r1', 'recipient_id', 'owner-1');
    expect(mockCascade).toHaveBeenCalledWith('access_requests', 'r1', 'recipient_id', 'owner-1');
    expect(order[order.length - 1], 'the roster row went before its credentials').toBe('recipients');
  });
});

describe('createRecipient — duplicate guard', () => {
  it('REJECTS a second recipient with the same email for one owner', async () => {
    // Found by a live walk: approving a delegate proposal for someone already
    // in the circle created "Sarah Chen, Sarah Chen" — two rows, one human,
    // access_rules split across both.
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'existing' }]));

    await expect(
      createRecipient('owner-1', validateRecipientInput({ name: 'Sam', email: 'sam@example.com', role: 'recipient' })),
    ).rejects.toThrow(ValidationError);
  });

  it('compares on NORMALISED email, matching listPeople and the abuse detector', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'r1', name: 'Sam', relationship: null, email: 'sam@example.com', phone: null, role: 'recipient', created_at: new Date() }]));

    await createRecipient('owner-1', validateRecipientInput({ name: 'Sam', email: 'sam@example.com', role: 'recipient' }));

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/lower\(trim\(email\)\)/i);
  });
});
