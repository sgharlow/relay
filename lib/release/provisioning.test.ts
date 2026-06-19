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
      .mockResolvedValueOnce(qResult([{ id: 'rs-1' }])) // ensure: existing
      .mockResolvedValueOnce(qResult([{ id: 'rs-1', required_confirmations: 2 }])); // update
    const row = await setRequiredConfirmations('owner-1', 'emergency', 2, 3);
    expect(row.required_confirmations).toBe(2);
  });

  it('rejects an invalid N-of-M (N > M) before any write', async () => {
    await expect(setRequiredConfirmations('owner-1', 'emergency', 5, 2)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
