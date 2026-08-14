/**
 * Removing a verifier must remove their vote.
 *
 * 🔴 THE FAILURE THIS PREVENTS OPENS A VAULT. Quorum is a COUNTER on
 * release_state, not a count of verifier_confirmations rows at read time.
 * deleteVerifier cascade-deleted the rows and left the counter alone, so an
 * owner who removed a verifier mid-release — the precise action of an owner who
 * has stopped trusting somebody — left that person's attestation behind, still
 * counting toward the threshold that opens everything to everyone.
 *
 * With the default quorum of two and one confirmation already recorded, removing
 * that verifier left the tally at 1. The next single attestation from anybody
 * reached quorum, and one of the two votes belonged to a person the owner had
 * deliberately removed.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.7, 6.3, 6.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { withdrawVerifierAttestations } from './withdraw-confirmations';

const mockQuery = vi.mocked(query);

const q = (rows: unknown[]) => ({ rows, rowCount: rows.length } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('withdrawVerifierAttestations', () => {
  it('decrements the confirmation tally that would otherwise open the vault', async () => {
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: 'confirm', owner_id: 'o-1' }]))
      .mockResolvedValueOnce(q([{ version: '7' }]))
      .mockResolvedValueOnce(q([{}]));

    const n = await withdrawVerifierAttestations('o-1', 'v-1');

    expect(n).toBe(1);
    const sql = String(mockQuery.mock.calls[2][0]);
    expect(sql).toContain('received_confirmations');
    // Compare-and-swap on the version, exactly as the increment path does —
    // a plain UPDATE would clobber an in-flight confirmation.
    expect(sql).toContain('version = $2');
    expect(mockQuery.mock.calls[2][1]).toEqual(['rs-1', '7']);
  });

  it('takes back a DENIAL from the denial tally, not the confirmation one', async () => {
    // Getting this backwards would be worse than doing nothing: it would remove
    // a confirmation nobody gave and leave the halt in place.
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: 'deny', owner_id: 'o-1' }]))
      .mockResolvedValueOnce(q([{ version: '2' }]))
      .mockResolvedValueOnce(q([{}]));

    await withdrawVerifierAttestations('o-1', 'v-1');

    const sql = String(mockQuery.mock.calls[2][0]);
    expect(sql).toContain('received_denials');
    expect(sql).not.toContain('received_confirmations');
  });

  it('reads a NULL decision as a confirmation, per migration 011', async () => {
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: null, owner_id: 'o-1' }]))
      .mockResolvedValueOnce(q([{ version: '1' }]))
      .mockResolvedValueOnce(q([{}]));

    await withdrawVerifierAttestations('o-1', 'v-1');

    expect(String(mockQuery.mock.calls[2][0])).toContain('received_confirmations');
  });

  it('leaves an abstention alone — it was never counted', async () => {
    mockQuery.mockResolvedValueOnce(
      q([{ release_state_id: 'rs-1', decision: 'abstain', owner_id: 'o-1' }]),
    );

    const n = await withdrawVerifierAttestations('o-1', 'v-1');

    expect(n).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  /*
    A released row is history. The release happened, the recipients were told,
    and the hash-chained audit log records the tally it happened at. Editing the
    counter afterwards would make the log disagree with the row and change
    nothing about the world.
  */
  it('only touches releases still in play', async () => {
    mockQuery.mockResolvedValueOnce(q([]));

    await withdrawVerifierAttestations('o-1', 'v-1');

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("state IN ('pending', 'grace')");
    expect(sql).toContain('rs.owner_id = $2'); // never another owner's tally
  });

  it('never drives a tally below zero', async () => {
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: 'confirm', owner_id: 'o-1' }]))
      .mockResolvedValueOnce(q([{ version: '1' }]))
      .mockResolvedValueOnce(q([{}]));

    await withdrawVerifierAttestations('o-1', 'v-1');

    expect(String(mockQuery.mock.calls[2][0])).toContain('GREATEST');
  });

  it('records the withdrawal in the owner audit chain', async () => {
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: 'confirm', owner_id: 'o-1' }]))
      .mockResolvedValueOnce(q([{ version: '3' }]))
      .mockResolvedValueOnce(q([{}]));

    await withdrawVerifierAttestations('o-1', 'v-1');

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({
        action: 'verifier_attestation_withdrawn',
        detail: expect.objectContaining({ verifierId: 'v-1', reason: 'verifier_removed' }),
      }),
    );
  });

  it('gives up on a contended row rather than throwing — the delete must still proceed', async () => {
    // Failing here would leave the owner with a verifier they asked to remove,
    // which is the worse of the two outcomes.
    mockQuery
      .mockResolvedValueOnce(q([{ release_state_id: 'rs-1', decision: 'confirm', owner_id: 'o-1' }]))
      // Every attempt loses the CAS.
      .mockResolvedValue(q([{ version: '9' }]));
    mockQuery.mockImplementation(async (sql: unknown) =>
      String(sql).startsWith('SELECT version') ? q([{ version: '9' }]) : q([]),
    );

    await expect(withdrawVerifierAttestations('o-1', 'v-1')).resolves.toBe(0);
  });
});
