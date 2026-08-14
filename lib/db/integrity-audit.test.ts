/**
 * Requirement 16.5 — the audit log must record integrity enforcement.
 *
 * 🔴 THE REQUIREMENT NAMES FOUR EXACT ACTIONS AND NONE HAD EVER BEEN WRITTEN.
 * `ref_integrity_parent_not_found`, `ref_integrity_owner_mismatch`,
 * `ref_integrity_cascade_delete`, `ref_integrity_uniqueness_enforced` — the
 * enforcement all worked, and the record of it did not exist.
 *
 * The gap that matters most is the cascade. An owner removing one recipient
 * silently takes their access_rules and access_policies with them; the audit
 * page — the screen that promises to hold what happened — showed the recipient
 * leaving and nothing else. A family reconstructing "who could reach what, and
 * when did that change" had no way to see it.
 *
 * The owner-mismatch entry is the one that is a security record rather than
 * bookkeeping: somebody reached for a row in another vault.
 *
 * Feature: relay-h0-mvp
 * Requirements: 16.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./connection', () => ({ query: vi.fn() }));
vi.mock('./occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from './connection';
import { writeAuditEntry } from '../audit/audit-service';
import { assertOwns, cascadeDelete, recordIntegrityAction } from './integrity';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

const q = (rows: unknown[], rowCount?: number) =>
  ({ rows, rowCount: rowCount ?? rows.length } as never);

const OWNER = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the four actions Requirement 16.5 names', () => {
  it('records a parent that does not exist', async () => {
    mockQuery.mockResolvedValueOnce(q([]));

    await expect(assertOwns(OWNER, 'vault_items', ROW)).rejects.toThrow();

    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ action: 'ref_integrity_parent_not_found', entity: 'vault_items' }),
    );
  });

  it('records a reach into somebody else vault — WITHOUT naming the true owner', async () => {
    mockQuery.mockResolvedValueOnce(q([{ owner_id: 'someone-else' }]));

    await expect(assertOwns(OWNER, 'vault_items', ROW)).rejects.toThrow();

    const [, entry] = mockAudit.mock.calls[0];
    expect(entry.action).toBe('ref_integrity_owner_mismatch');
    // The log is readable by the CALLER's owner. Naming whose row it really was
    // would turn an audit trail into a disclosure.
    expect(JSON.stringify(entry)).not.toContain('someone-else');
  });

  it('records a cascade that actually deleted something', async () => {
    mockQuery.mockResolvedValueOnce(q([], 3));

    await cascadeDelete('access_rules', ROW, 'recipient_id', OWNER);

    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        action: 'ref_integrity_cascade_delete',
        entity: 'access_rules',
        detail: expect.objectContaining({ rows: 3, via: 'recipient_id' }),
      }),
    );
  });

  it('stays silent when a cascade deleted nothing', async () => {
    // Logging a no-op cascade would bury the ones that mattered.
    mockQuery.mockResolvedValueOnce(q([], 0));
    await cascadeDelete('access_rules', ROW, 'recipient_id', OWNER);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('still deletes when no owner is available to record it', async () => {
    // Account closure removes the owner row first; the cascade must not stop.
    mockQuery.mockResolvedValueOnce(q([], 2));
    await expect(cascadeDelete('access_rules', ROW, 'recipient_id')).resolves.toBeUndefined();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

/*
  🔴 THE ONLY PLACE IN THIS CODEBASE WHERE AN AUDIT FAILURE DOES NOT BLOCK.
  CLAUDE.md's invariant is that audit writes block the operation they describe.
  assertOwns is the ownership GATE: if a failed audit write threw from inside
  it, an audit outage would stop every ownership check from returning, turning a
  logging problem into a total vault outage — including a release a family is
  waiting on. And the refusal being recorded is already decided; the caller gets
  NOT_FOUND or UNAUTHORIZED either way, so blocking buys no safety.

  Asserted explicitly so the exception stays deliberate rather than becoming
  something someone "tidies up" in either direction.
*/
describe('the deliberate inversion of the audit-blocks rule', () => {
  it('does not let a failed audit write break an ownership check', async () => {
    mockAudit.mockRejectedValueOnce(new Error('DSQL unavailable'));
    mockQuery.mockResolvedValueOnce(q([]));

    // Still throws the INTEGRITY error, not the audit error.
    await expect(assertOwns(OWNER, 'vault_items', ROW)).rejects.toThrow(/not found/i);
  });

  it('does not let a failed audit write break a cascade', async () => {
    mockAudit.mockRejectedValueOnce(new Error('DSQL unavailable'));
    mockQuery.mockResolvedValueOnce(q([], 1));

    await expect(cascadeDelete('access_rules', ROW, 'recipient_id', OWNER)).resolves.toBeUndefined();
  });

  it('records under a system actor, never as the owner themselves', async () => {
    await recordIntegrityAction(OWNER, 'ref_integrity_cascade_delete', 'access_rules', ROW);
    expect(mockAudit.mock.calls[0][1].actor).toBe('system:integrity');
  });
});
