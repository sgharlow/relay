/**
 * Tests for verifier access codes.
 *
 * Two things carry the weight here. First, the code must never be derivable
 * from anything public — the case ID is a deterministic hash of the release id,
 * designed to be read aloud, and confusing the two would hand out confirmation
 * rights to everyone in the phone call. Second, only the hash may be persisted:
 * a database leak must not yield the ability to confirm someone's release.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { formatCaseId } from '../release/case-id';
import {
  generateCode,
  normaliseCode,
  formatCode,
  hashCode,
  issueVerifierCode,
  redeemVerifierCode,
  VerifierCodeError,
  CODE_LENGTH,
  MAX_FAILED_ATTEMPTS,
} from './verifier-code';

const mockQuery = vi.mocked(query);
const qResult = (rows: unknown[]) =>
  ({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }) as never;

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

function liveRow(over: Record<string, unknown> = {}) {
  return {
    id: 'vc-1',
    verifier_id: 'v-1',
    release_state_id: 'rs-1',
    owner_id: 'o-1',
    expires_at: future,
    redeemed_at: null,
    failed_attempts: 0,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('generation', () => {
  it('produces a code of the declared length from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTVWXYZ]+$/);
    }
  });

  it('never emits characters people mishear — no I, O, U, 0 or 1', () => {
    const all = Array.from({ length: 300 }, () => generateCode()).join('');
    expect(all).not.toMatch(/[IOU01]/);
  });

  it('does not repeat across many draws — it is a credential, not an id', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateCode()));
    expect(seen.size).toBe(500);
  });

  it('is NOT derivable from the case ID, which is public and spoken aloud', () => {
    const caseId = formatCaseId('rs-1');
    const codes = Array.from({ length: 100 }, () => generateCode());
    expect(codes).not.toContain(normaliseCode(caseId));
  });
});

describe('normalisation', () => {
  it.each(['7K4M-P2XW', '7k4m-p2xw', '7K4M P2XW', ' 7k4mp2xw ', '7K4M–P2XW'])(
    'accepts %j as the same code',
    (input) => {
      expect(normaliseCode(input)).toBe('7K4MP2XW');
    },
  );

  it('hashes equivalently however it was typed', () => {
    expect(hashCode('7k4m p2xw')).toBe(hashCode('7K4M-P2XW'));
  });

  it('formats in fours, which is how people read digits back', () => {
    expect(formatCode('7K4MP2XW')).toBe('7K4M-P2XW');
  });
});

describe('issuing', () => {
  it('persists ONLY the hash — a leaked table must not confirm releases', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    const code = await issueVerifierCode({ verifierId: 'v-1', releaseStateId: 'rs-1', ownerId: 'o-1' });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(hashCode(code));
    expect(params).not.toContain(code);
    expect(JSON.stringify(params)).not.toContain(code);
  });

  it('returns the plaintext exactly once, for the email', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    const code = await issueVerifierCode({ verifierId: 'v-1', releaseStateId: 'rs-1', ownerId: 'o-1' });
    expect(code).toHaveLength(CODE_LENGTH);
  });
});

describe('redemption', () => {
  it('returns the identity behind a valid code', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow()])).mockResolvedValueOnce(qResult([]));
    await expect(redeemVerifierCode('7K4M-P2XW')).resolves.toEqual({
      verifierId: 'v-1',
      releaseStateId: 'rs-1',
      ownerId: 'o-1',
    });
  });

  it('marks the code redeemed so it cannot be replayed', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow()])).mockResolvedValueOnce(qResult([]));
    await redeemVerifierCode('7K4M-P2XW');
    expect(String(mockQuery.mock.calls[1][0])).toContain('redeemed_at = now()');
  });

  it('rejects a wrong-length code without touching the database', async () => {
    await expect(redeemVerifierCode('7K4M')).rejects.toMatchObject({ reason: 'invalid' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an unknown code', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects an expired code', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ expires_at: past })]));
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toMatchObject({ reason: 'expired' });
  });

  it('tells a verifier their code was already used, rather than hiding it', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ redeemed_at: past })]));
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toMatchObject({ reason: 'used' });
  });

  it('LOCKS a code that has been guessed at too many times', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS })]));
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toMatchObject({ reason: 'locked' });
  });

  it('checks the lock BEFORE anything else — a worn-down code stays dead', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS, redeemed_at: null, expires_at: future })]),
    );
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toThrow(VerifierCodeError);
    // No redemption UPDATE was issued.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('never leaks the code or its hash in an error message', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(redeemVerifierCode('7K4MP2XW')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('7K4MP2XW') }) as never,
    );
  });
});
