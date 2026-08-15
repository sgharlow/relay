/**
 * A nonce can be spent exactly once.
 *
 * That is the whole property, and it is the one a signed token cannot provide —
 * which is why the WebAuthn seal was replayable for its whole five-minute window
 * despite a perfectly good signature.
 *
 * The tests drive the mocked `query` rather than a database because what is
 * being asserted lives in the SQL: the burn is a CONDITIONAL update, and the
 * decision about whether it won is `rowCount`, not a prior read. A test that
 * mocked the store would assert nothing about that.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  recordChallenge,
  burnChallenge,
  isChallengeLive,
  revokeChallenges,
  sweepExpiredChallenges,
  newChallengeId,
  CHALLENGE_PURPOSES,
} from './challenge-store';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nonce identity', () => {
  it('mints values that do not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newChallengeId()));
    expect(seen.size).toBe(500);
  });

  it('names step-up alongside the two WebAuthn ceremonies', () => {
    expect([...CHALLENGE_PURPOSES]).toEqual(['registration', 'authentication', 'step-up']);
  });
});

describe('recordChallenge', () => {
  it('writes an expiry computed by the database, not by the caller', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    await recordChallenge({ jti: 'n1', purpose: 'step-up', ttlSeconds: 300, userId: 'u1' });

    const [sql, params] = mockQuery.mock.calls[0];
    // now() in SQL rather than a JS timestamp: a client clock that is wrong
    // would otherwise mint a nonce that is already expired or never expires.
    expect(sql).toMatch(/now\(\)\s*\+\s*make_interval/);
    expect(params).toEqual(['n1', 'step-up', 'u1', 300]);
  });

  it('records an unattributed nonce for identifier-free sign-in', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    await recordChallenge({ jti: 'n2', purpose: 'authentication', ttlSeconds: 300 });
    expect(mockQuery.mock.calls[0][1]).toEqual(['n2', 'authentication', null, 300]);
  });

  /*
    Deliberately NOT swallowed. A ceremony whose nonce was never recorded would
    be refused at the end by the burn, and telling somebody their perfectly good
    passkey failed is worse than refusing to start.
  */
  it('throws when the nonce cannot be recorded', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DSQL unavailable'));
    await expect(
      recordChallenge({ jti: 'n3', purpose: 'registration', ttlSeconds: 300 }),
    ).rejects.toThrow();
  });
});

describe('burnChallenge — the once-ness', () => {
  it('is a single conditional UPDATE, never a read then a write', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    await burnChallenge('n1', 'step-up');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE auth_challenges/);
    expect(sql).toMatch(/consumed_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
    expect(sql).toMatch(/purpose = \$2/);
  });

  it('returns true for the caller that won the update', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    await expect(burnChallenge('n1', 'authentication')).resolves.toBe(true);
  });

  it('returns false for a second presentation of the same nonce', async () => {
    // The row is already consumed, so the predicate matches nothing.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(burnChallenge('n1', 'authentication')).resolves.toBe(false);
  });

  it('refuses a nonce presented against a different purpose', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(burnChallenge('n1', 'step-up')).resolves.toBe(false);
  });

  /*
    Two requests racing for the same nonce is exactly the case this exists for,
    and on DSQL that surfaces as SQLSTATE 40001. The retry is not merely
    tolerated — it produces the RIGHT answer, because the second attempt reads
    the row the winner already consumed.
  */
  it('retries a serialization failure and then reports the nonce as spent', async () => {
    const conflict = Object.assign(new Error('serialization failure'), { code: '40001' });
    mockQuery.mockRejectedValueOnce(conflict);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(burnChallenge('n1', 'step-up')).resolves.toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('fails CLOSED when the database cannot be reached', async () => {
    mockQuery.mockRejectedValue(new Error('DSQL unavailable'));
    await expect(burnChallenge('n1', 'step-up')).resolves.toBe(false);
  });

  it('treats a driver that reports no rowCount as a failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(burnChallenge('n1', 'step-up')).resolves.toBe(false);
  });
});

describe('isChallengeLive — checking without spending', () => {
  it('does not consume the nonce', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 } as never);
    await expect(isChallengeLive('n1', 'step-up')).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][0]).toMatch(/^\s*SELECT/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/UPDATE|DELETE/);
  });

  it('applies the same expiry and consumption predicates as the burn', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await isChallengeLive('n1', 'step-up');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/consumed_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
  });

  it('fails closed', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    await expect(isChallengeLive('n1', 'step-up')).resolves.toBe(false);
  });
});

describe('revokeChallenges — what makes elevation withdrawable', () => {
  it('ends every live nonce of one purpose for one user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 } as never);
    await expect(revokeChallenges('u1', 'step-up')).resolves.toBe(3);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/user_id = \$1/);
    expect(sql).toMatch(/consumed_at IS NULL/);
    expect(params).toEqual(['u1', 'step-up']);
  });

  it('does not throw when revocation cannot be written', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    await expect(revokeChallenges('u1', 'step-up')).resolves.toBe(0);
  });
});

describe('sweepExpiredChallenges — housekeeping, not a guard', () => {
  it('only ever removes rows that are already past their expiry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 12 } as never);
    await sweepExpiredChallenges();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM auth_challenges/);
    expect(sql).toMatch(/expires_at < now\(\)/);
    // Never predicated on consumed_at: a spent nonce inside its window must stay
    // put, because deleting it would make a replay of it succeed again.
    expect(sql).not.toMatch(/consumed_at/);
  });

  /*
    It rides the heartbeat cron. Housekeeping that can fail the sweep it rides on
    would turn a space-reclaiming nicety into an outage in the release scheduler.
  */
  it('swallows its own failure rather than failing the job it rides on', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    await expect(sweepExpiredChallenges()).resolves.toBe(0);
  });
});
