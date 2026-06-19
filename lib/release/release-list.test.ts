/**
 * Tests for lib/release/release-list.ts
 *
 * Validates: Requirements 4.1, 5.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { listReleaseStates, getCheckinInterval, updateCheckinInterval, getVerifierCount } from './release-list';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('listReleaseStates', () => {
  it('maps rows with numeric confirmation counts', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([{ id: 'rs', trigger_type: 'emergency', state: 'armed', required_confirmations: '2', received_confirmations: '0', version: '3', grace_ends_at: null }]),
    );
    const [rs] = await listReleaseStates('owner-1');
    expect(rs.required_confirmations).toBe(2);
    expect(rs.state).toBe('armed');
  });
});

describe('getCheckinInterval', () => {
  it('returns the stored interval or defaults to 30', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ checkin_interval_days: 14 }]));
    expect(await getCheckinInterval('o')).toBe(14);
    mockQuery.mockResolvedValueOnce(qResult([]));
    expect(await getCheckinInterval('o')).toBe(30);
  });
});

describe('updateCheckinInterval', () => {
  it('persists a valid interval', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    expect(await updateCheckinInterval('o', 45)).toBe(45);
  });

  it('rejects out-of-range or non-integer values (Req 4.1) without writing', async () => {
    await expect(updateCheckinInterval('o', 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCheckinInterval('o', 366)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCheckinInterval('o', 1.5)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('getVerifierCount', () => {
  it('returns the verifier count', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ count: 3 }]));
    expect(await getVerifierCount('o')).toBe(3);
  });
});
