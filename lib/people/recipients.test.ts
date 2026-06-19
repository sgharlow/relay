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
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'r1', name: 'Sam', relationship: null, email: 'sam@example.com', phone: null, role: 'executor', created_at: new Date() }]),
    );
    const r = await createRecipient('owner-1', validateRecipientInput({ name: 'Sam', email: 'sam@example.com', role: 'executor' }));
    expect(r.id).toBe('r1');
  });
});

describe('deleteRecipient', () => {
  it('cascade-deletes access_rules before the recipient (Req 3.6)', async () => {
    const order: string[] = [];
    mockCascade.mockImplementation(async () => { order.push('cascade-rules'); });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM recipients')) order.push('delete-recipient');
      return qResult([]);
    });
    await deleteRecipient('owner-1', 'r1');
    expect(mockCascade).toHaveBeenCalledWith('access_rules', 'r1', 'recipient_id');
    expect(order).toEqual(['cascade-rules', 'delete-recipient']);
  });
});
