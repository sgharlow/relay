/**
 * Tests for lib/people/verifiers.ts
 *
 * Validates: Requirements 3.2, 3.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../db/integrity', () => ({ cascadeDelete: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { cascadeDelete } from '../db/integrity';
import { validateVerifierInput, createVerifier, deleteVerifier } from './verifiers';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);
const mockCascade = vi.mocked(cascadeDelete);

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
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'v1', name: 'Dr Lee', email: 'lee@example.com', phone: null, verification_status: 'pending', created_at: new Date() }]),
    );
    const v = await createVerifier('owner-1', validateVerifierInput({ name: 'Dr Lee', email: 'lee@example.com' }));
    expect(v.verification_status).toBe('pending');
  });
});

describe('deleteVerifier', () => {
  it('removes verifier_confirmations before the verifier (Req 3.7)', async () => {
    const order: string[] = [];
    mockCascade.mockImplementation(async () => { order.push('cascade-confirmations'); });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM verifiers')) order.push('delete-verifier');
      return qResult([]);
    });
    await deleteVerifier('owner-1', 'v1');
    expect(mockCascade).toHaveBeenCalledWith('verifier_confirmations', 'v1', 'verifier_id');
    expect(order).toEqual(['cascade-confirmations', 'delete-verifier']);
  });
});
