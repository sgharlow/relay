/**
 * The recipient front door, branch by branch.
 *
 * 🔴 WHY THIS FILE WAS MISSING AND WHY THAT MATTERED. Until 2026-08-21 the only
 * coverage `recipient-code.ts` had came sideways, from
 * `single-use-atomicity.test.ts` and `code-entropy.test.ts` — which exercise the
 * compare-and-swap and the alphabet and nothing else. Every REFUSAL branch was
 * unexecuted: the per-code lockout that bounds guessing at a code somebody
 * already knows, the `closed` reason that drives the graceful-close screen after
 * a re-arm, expiry, and the whole of `recordFailedAttempt`. An off-by-one on
 * `MAX_FAILED_ATTEMPTS` or an increment that hit no row would have shipped green.
 *
 * That lockout is not incidental. `lib/auth/auth-options.ts` argues, in the
 * break-glass provider's header, that no extra rate limit is needed because "the
 * per-code attempt budget bounds repetition" — the same budget shape as this
 * one. It is the reasoning the door is left unbolted on, so it earns a test that
 * runs.
 *
 * Mirrors `verifier-code.test.ts`, plus the rule this file has and that one does
 * not: the code carries the release version it was minted against, and a re-arm
 * must kill it.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../ops/guess-watch', () => ({ recordCodeMiss: vi.fn() }));

import { query } from '../db/connection';
import { recordCodeMiss } from '../ops/guess-watch';
import {
  generateCode,
  normaliseCode,
  formatCode,
  hashCode,
  issueRecipientCode,
  redeemRecipientCode,
  recordFailedAttempt,
  RecipientCodeError,
  RECIPIENT_CODE_LENGTH,
  MAX_FAILED_ATTEMPTS,
} from './recipient-code';

const mockQuery = vi.mocked(query);
const mockCodeMiss = vi.mocked(recordCodeMiss);

const qResult = (rows: unknown[]) =>
  ({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }) as never;
const affected = (n: number) => ({ rows: [], rowCount: n, command: '', oid: 0, fields: [] }) as never;

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

/** A code that is live in every respect, so each test changes exactly one thing. */
function liveRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rc-1',
    recipient_id: 'r-1',
    release_state_id: 'rs-1',
    release_version: '3',
    expires_at: future,
    redeemed_at: null,
    failed_attempts: 0,
    current_version: '3',
    state: 'open',
    ...over,
  };
}

const CODE = '7K4MP2XW';

beforeEach(() => vi.clearAllMocks());

describe('generation and normalisation', () => {
  it('produces a code of the declared length from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(RECIPIENT_CODE_LENGTH);
      expect(c).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTVWXYZ]+$/);
    }
  });

  it.each(['7K4M-P2XW', '7k4m p2xw', ' 7k4mp2xw ', '7K4M–P2XW'])(
    'reads %j back as the same code — people retype what they were read',
    (input) => {
      expect(normaliseCode(input)).toBe(CODE);
      expect(hashCode(input)).toBe(hashCode(CODE));
    },
  );

  it('formats in fours, which is how a code gets spoken', () => {
    expect(formatCode(CODE)).toBe('7K4M-P2XW');
  });
});

describe('issuing', () => {
  it('persists ONLY the hash — a leaked table must not open a vault', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    const code = await issueRecipientCode({
      recipientId: 'r-1',
      releaseStateId: 'rs-1',
      ownerId: 'o-1',
      version: 3,
    });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(hashCode(code));
    expect(JSON.stringify(params)).not.toContain(code);
  });

  it('records the release version the code was minted against', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await issueRecipientCode({
      recipientId: 'r-1',
      releaseStateId: 'rs-1',
      ownerId: 'o-1',
      version: 7n,
    });
    expect((mockQuery.mock.calls[0][1] as unknown[])[4]).toBe('7');
  });
});

describe('every way redemption refuses', () => {
  it('rejects a wrong-length code without touching the database', async () => {
    await expect(redeemRecipientCode('7K4M')).rejects.toMatchObject({ reason: 'invalid' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCodeMiss).not.toHaveBeenCalled();
  });

  it('a code matching NO row is counted as a guess, because no row can count it', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'invalid' });
    expect(mockCodeMiss).toHaveBeenCalledWith('recipient');
    // The counter above is the ONLY trace of a keyspace walk; recordFailedAttempt
    // cannot see it, since there is no row to increment.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it(`LOCKS at exactly ${MAX_FAILED_ATTEMPTS} failures — the boundary, not one past it`, async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS })]));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'locked' });

    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce(qResult([liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS - 1 })]))
      .mockResolvedValueOnce(affected(1));
    await expect(redeemRecipientCode(CODE)).resolves.toMatchObject({ recipientId: 'r-1' });
  });

  it('checks the lock FIRST — a worn-down code stays dead even if it is otherwise valid', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS + 5 })]),
    );
    await expect(redeemRecipientCode(CODE)).rejects.toThrow(RecipientCodeError);
    expect(mockQuery).toHaveBeenCalledTimes(1); // no redemption UPDATE was issued
  });

  it('tells a recipient their code was already used rather than hiding it', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ redeemed_at: past })]));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'used' });
  });

  it('rejects an expired code, judged against the clock it is given', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ expires_at: past })]));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'expired' });

    // …and the same row is live when the caller's clock says so, which is what
    // makes the injected `now` a real parameter rather than decoration.
    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce(qResult([liveRow({ expires_at: past })]))
      .mockResolvedValueOnce(affected(1));
    await expect(
      redeemRecipientCode(CODE, new Date(Date.parse(past) - 60_000)),
    ).resolves.toMatchObject({ recipientId: 'r-1' });
  });

  it('a re-arm CLOSES the code, and says so distinctly — the recipient did nothing wrong', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow({ current_version: '4' })]));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'closed' });
  });

  it('compares versions as text, so 3 and "3" are the same version', async () => {
    mockQuery
      .mockResolvedValueOnce(qResult([liveRow({ current_version: 3, release_version: '3' })]))
      .mockResolvedValueOnce(affected(1));
    await expect(redeemRecipientCode(CODE)).resolves.toMatchObject({ version: '3' });
  });

  it('loses the compare-and-swap race as "used", not as a success', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow()])).mockResolvedValueOnce(affected(0));
    await expect(redeemRecipientCode(CODE)).rejects.toMatchObject({ reason: 'used' });
  });

  it('never leaks the code or its hash in any refusal message', async () => {
    for (const row of [
      liveRow({ failed_attempts: MAX_FAILED_ATTEMPTS }),
      liveRow({ redeemed_at: past }),
      liveRow({ expires_at: past }),
      liveRow({ current_version: '9' }),
    ]) {
      vi.clearAllMocks();
      mockQuery.mockResolvedValueOnce(qResult([row]));
      await expect(redeemRecipientCode(CODE)).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(CODE),
        }) as never,
      );
    }
  });
});

describe('redemption of a live code', () => {
  it('returns the identity and the version the code stands for', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow()])).mockResolvedValueOnce(affected(1));
    await expect(redeemRecipientCode('7k4m-p2xw')).resolves.toEqual({
      recipientId: 'r-1',
      releaseStateId: 'rs-1',
      version: '3',
    });
  });

  it('stamps redeemed_at under the null predicate that makes it single use', async () => {
    mockQuery.mockResolvedValueOnce(qResult([liveRow()])).mockResolvedValueOnce(affected(1));
    await redeemRecipientCode(CODE);
    const sql = String(mockQuery.mock.calls[1][0]);
    expect(sql).toContain('redeemed_at = now()');
    expect(sql).toContain('redeemed_at IS NULL');
  });
});

describe('recordFailedAttempt', () => {
  it('increments the counter on the row the HASH names, never the plaintext', async () => {
    mockQuery.mockResolvedValueOnce(affected(1));
    await recordFailedAttempt('7k4m p2xw');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('failed_attempts = failed_attempts + 1');
    expect(params).toEqual([hashCode(CODE)]);
    expect(JSON.stringify(params)).not.toContain(CODE);
  });

  it('is silent when the code matches nothing — a miss on no row is not an error', async () => {
    mockQuery.mockResolvedValueOnce(affected(0));
    await expect(recordFailedAttempt(CODE)).resolves.toBeUndefined();
  });
});
