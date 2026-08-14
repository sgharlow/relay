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
    mockWithdraw.mockImplementation(async () => { order.push('withdraw'); return 0; });
    mockCascade.mockImplementation(async () => { order.push('cascade-confirmations'); });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM verifiers')) order.push('delete-verifier');
      return qResult([]);
    });
    await deleteVerifier('owner-1', 'v1');
    expect(mockCascade).toHaveBeenCalledWith('verifier_confirmations', 'v1', 'verifier_id', 'owner-1');
    expect(order).toEqual(['withdraw', 'cascade-confirmations', 'delete-verifier']);
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
