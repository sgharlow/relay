/**
 * Tests for recovery codes.
 *
 * Relay has no password, so this is the only path back into a vault after a
 * phone is lost or replaced. The behaviours that matter most are: codes are
 * single-use, they are scoped to the account they were issued for, and the
 * failure message never reveals whether an email has a Relay account.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  generateRecoveryCode,
  normaliseRecoveryCode,
  formatRecoveryCode,
  hashRecoveryCode,
  issueRecoveryCodes,
  redeemRecoveryCode,
  remainingRecoveryCodes,
  RecoveryCodeError,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from './recovery-code';

const mockQuery = vi.mocked(query);
const qResult = (rows: unknown[]) =>
  ({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }) as never;

beforeEach(() => vi.clearAllMocks());

describe('generation', () => {
  it('produces codes of the declared length from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateRecoveryCode();
      expect(c).toHaveLength(RECOVERY_CODE_LENGTH);
      expect(c).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTVWXYZ]+$/);
    }
  });

  it('omits characters people mistype when copying from paper', () => {
    const all = Array.from({ length: 300 }, () => generateRecoveryCode()).join('');
    expect(all).not.toMatch(/[IOU01]/);
  });

  it('does not collide across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateRecoveryCode()));
    expect(seen.size).toBe(500);
  });
});

describe('normalisation', () => {
  it.each(['4KMPQ-7XR2W', '4kmpq 7xr2w', ' 4KMPQ7XR2W '])('accepts %j', (input) => {
    expect(normaliseRecoveryCode(input)).toBe('4KMPQ7XR2W');
  });

  it('hashes equivalently however it was written down', () => {
    expect(hashRecoveryCode('4kmpq 7xr2w')).toBe(hashRecoveryCode('4KMPQ-7XR2W'));
  });

  it('formats in two groups of five for accurate transcription', () => {
    expect(formatRecoveryCode('4KMPQ7XR2W')).toBe('4KMPQ-7XR2W');
  });
});

describe('issuing', () => {
  it('issues the full set', async () => {
    mockQuery.mockResolvedValue(qResult([]));
    const codes = await issueRecoveryCodes('u-1');
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('REPLACES any previous set — an old sheet must stop working', async () => {
    mockQuery.mockResolvedValue(qResult([]));
    await issueRecoveryCodes('u-1');
    expect(String(mockQuery.mock.calls[0][0])).toContain('DELETE FROM recovery_codes');
  });

  it('stores only hashes', async () => {
    mockQuery.mockResolvedValue(qResult([]));
    const codes = await issueRecoveryCodes('u-1');

    const inserted = mockQuery.mock.calls.slice(1).map((c) => (c[1] as unknown[])[1]);
    for (const code of codes) {
      expect(inserted).toContain(hashRecoveryCode(code));
      expect(inserted).not.toContain(code);
    }
  });
});

describe('redemption', () => {
  it('returns the user id and consumes the code', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([{ id: 'rc-1', user_id: 'u-1' }]))
      // rowCount 1 = one row AFFECTED. The spend is a compare-and-swap on
      // `used_at IS NULL`, so 0 here would mean another caller won the race —
      // see lib/auth/single-use-atomicity.test.ts.
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await expect(redeemRecoveryCode('a@b.com', '4KMPQ-7XR2W')).resolves.toBe('u-1');
    expect(String(mockQuery.mock.calls[1][0])).toContain('used_at = now()');
  });

  it('is SCOPED BY EMAIL — a code is not a bearer token for any account', async () => {
    mockQuery.mockResolvedValueOnce(qResult([])).mockResolvedValueOnce(qResult([]));
    await expect(redeemRecoveryCode('a@b.com', '4KMPQ7XR2W')).rejects.toThrow(RecoveryCodeError);

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('lower(u.email) = lower($2)');
    expect(sql).toContain('used_at IS NULL');
  });

  it('rejects a wrong-length code without touching the database', async () => {
    await expect(redeemRecoveryCode('a@b.com', 'SHORT')).rejects.toThrow(RecoveryCodeError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('gives the SAME message for an unknown account and a wrong code', async () => {
    mockQuery.mockResolvedValue(qResult([]));

    const a = await redeemRecoveryCode('nobody@b.com', '4KMPQ7XR2W').catch((e) => e.message);
    const b = await redeemRecoveryCode('real@b.com', 'WWWWWWWWWW').catch((e) => e.message);

    // Otherwise this endpoint becomes a way to test whether an address is a
    // Relay customer — which, for a product about a parent's credentials, is
    // itself sensitive.
    expect(a).toBe(b);
  });

  it('never echoes the code back in the error', async () => {
    mockQuery.mockResolvedValue(qResult([]));
    const msg = await redeemRecoveryCode('a@b.com', '4KMPQ7XR2W').catch((e) => e.message);
    expect(msg).not.toContain('4KMPQ7XR2W');
  });
});

describe('remaining', () => {
  it('counts only unused codes', async () => {
    mockQuery.mockResolvedValueOnce(qResult([{ n: '5' }]));
    await expect(remainingRecoveryCodes('u-1')).resolves.toBe(5);
    expect(String(mockQuery.mock.calls[0][0])).toContain('used_at IS NULL');
  });

  it('reports zero rather than NaN when there is no row', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(remainingRecoveryCodes('u-1')).resolves.toBe(0);
  });
});
