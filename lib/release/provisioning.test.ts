/**
 * Tests for lib/release/provisioning.ts
 *
 * Validates: Requirements 5.1, 3.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));

import { query } from '../db/connection';
import { ensureReleaseState, setRequiredConfirmations } from './provisioning';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('ensureReleaseState', () => {
  it('returns the existing row without inserting (idempotent, Req 5.1)', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'rs-1', state: 'armed' }]));
    const row = await ensureReleaseState('owner-1', 'emergency');
    expect(row.id).toBe('rs-1');
    expect(mockQuery).toHaveBeenCalledOnce(); // only the intent-read, no INSERT
  });

  it('creates an ARMED row when none exists', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([])) // intent-read: none
      .mockResolvedValueOnce(qResult([{ id: 'rs-new', state: 'armed', required_confirmations: 2 }])); // insert
    const row = await ensureReleaseState('owner-1', 'emergency', { requiredConfirmations: 2 });
    expect(row.id).toBe('rs-new');
    const insertSql = mockQuery.mock.calls[1][0] as string;
    expect(insertSql).toContain('INSERT INTO release_state');
    expect(insertSql).toContain("'armed'");
  });

  it('rejects an unknown trigger type', async () => {
    await expect(ensureReleaseState('owner-1', 'apocalypse')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects required_confirmations < 1', async () => {
    await expect(ensureReleaseState('owner-1', 'emergency', { requiredConfirmations: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('setRequiredConfirmations', () => {
  it('validates N-of-M then persists N', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', state: 'armed', version: 3 }])) // ensure: existing
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', required_confirmations: 2 }])); // update
    const row = await setRequiredConfirmations('owner-1', 'emergency', 2, 3);
    expect(row.required_confirmations).toBe(2);
  });

  it('rejects an invalid N-of-M (N > M) before any write', async () => {
    await expect(setRequiredConfirmations('owner-1', 'emergency', 5, 2)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  /*
    🔴 THE ONE release_state WRITE THE OCC DESIGN DID NOT COVER, closed
    2026-08-21. `001_initial.sql:9-12` states the rule for this table without
    exception — "all state mutations use CAS on state+version" — and this
    statement was `UPDATE ... WHERE owner_id = $1 AND trigger_type = $2`: no
    state predicate, no version match, no version bump.

    It is the owner's own trigger, so this is not an attack; it is an owner
    changing the outcome of a release that is already running, which is worse
    for being an accident. Lower N from 2 to 1 while a GRACE row already holds
    one confirmation and `resolveElapsedGrace` — which releases on
    `received_confirmations >= required_confirmations` — opens the vault at the
    top of the next hour, with nobody having done anything and no screen having
    said that is what the Set button meant.

    Refused rather than serialised. There is no correct interleaving to pick
    here: a quorum edit during a live release is a question for the owner, not a
    race for the database to arbitrate.
  */
  it('REFUSES to change the quorum while a release is in flight', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ id: 'rs-1', state: 'grace', version: 4 }]));

    await expect(setRequiredConfirmations('owner-1', 'emergency', 1, 3)).rejects.toMatchObject({
      httpStatus: 409,
    });
    // Refused BEFORE the write, not by a rowcount afterwards.
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('carries the CAS predicate and bumps the version', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', state: 'armed', version: 7 }]))
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', required_confirmations: 2 }]));

    await setRequiredConfirmations('owner-1', 'emergency', 2, 3);

    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/state\s*=\s*'armed'/);
    expect(sql).toMatch(/version\s*=\s*version\s*\+\s*1/);
    expect(sql).toMatch(/AND version\s*=\s*\$/);
    expect(params).toContain('7');
  });

  /*
    The CAS losing is a DIFFERENT event from the state check refusing: it means
    a transition committed between the read and the write — the row is in
    flight now even though it was ARMED a moment ago. Same refusal, because the
    answer is the same: do not quietly re-aim a running release.
  */
  it('refuses when a transition committed between the read and the write', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', state: 'armed', version: 7 }]))
      .mockResolvedValueOnce(qResult([])); // CAS matched nothing

    await expect(setRequiredConfirmations('owner-1', 'emergency', 2, 3)).rejects.toMatchObject({
      httpStatus: 409,
    });
  });
});
