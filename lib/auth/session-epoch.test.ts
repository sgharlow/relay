/**
 * Tests for session invalidation.
 *
 * THE DEFECT THIS CLOSES, proven on production 2026-08-12: a browser holding a
 * session for a user that had been DELETED from `users` was still accepted —
 * `/api/standby` answered 200 rather than 401 — because the session is a
 * self-contained JWT and nothing checked that the id still existed. "Delete my
 * account" did not mean "signed out", and there was no way to revoke a session
 * at all.
 *
 * That is §3.7 rule 1 made real: the token is a snapshot, and the gap between
 * snapshot and truth is exactly where revocation lives.
 *
 * The direction of failure is deliberate. A lookup that cannot run DENIES. That
 * turns a database blip into sign-outs rather than into a silently-accepted stale
 * session — and every route behind this guard queries the database anyway, so a
 * blip was already going to fail; the only question was whether it failed loudly
 * or quietly.
 *
 * Feature: relay-standby
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { readSessionEpoch, isSessionCurrent, bumpSessionEpoch } from './session-epoch';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('readSessionEpoch', () => {
  it('reads the current epoch for a user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 3 }], rowCount: 1 } as never);
    await expect(readSessionEpoch('user-1')).resolves.toBe(3);
  });

  it('treats NULL as 0, so migration 025 needs no backfill', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: null }], rowCount: 1 } as never);
    await expect(readSessionEpoch('user-1')).resolves.toBe(0);
  });

  it('returns null for a user that no longer exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(readSessionEpoch('deleted')).resolves.toBeNull();
  });
});

describe('isSessionCurrent', () => {
  it('accepts a token whose epoch matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 2 }], rowCount: 1 } as never);
    await expect(isSessionCurrent('user-1', 2)).resolves.toBe(true);
  });

  it('REJECTS a session for a deleted user — the defect this exists to close', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(isSessionCurrent('deleted', 0)).resolves.toBe(false);
  });

  it('rejects a token minted before the epoch was bumped', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 5 }], rowCount: 1 } as never);
    await expect(isSessionCurrent('user-1', 4)).resolves.toBe(false);
  });

  it('accepts a legacy token with no epoch claim against an unbumped user', async () => {
    // Sessions minted before this shipped carry no epoch. Rejecting them would
    // sign out every existing user on deploy, which is a worse outcome than
    // honouring them until they expire or the epoch is bumped once.
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 0 }], rowCount: 1 } as never);
    await expect(isSessionCurrent('user-1', undefined)).resolves.toBe(true);
  });

  it('rejects a legacy token once that user HAS been bumped', async () => {
    // Which is what makes "sign out everywhere" actually work on old sessions.
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 1 }], rowCount: 1 } as never);
    await expect(isSessionCurrent('user-1', undefined)).resolves.toBe(false);
  });

  it('DENIES when the lookup fails — a blip signs people out rather than trusting a stale token', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(isSessionCurrent('user-1', 1)).resolves.toBe(false);
  });
});

describe('bumpSessionEpoch', () => {
  it('advances the epoch, invalidating every session that user holds', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_epoch: 4 }], rowCount: 1 } as never);

    await bumpSessionEpoch('user-1');

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('session_epoch');
    // coalesce, because the column is nullable and NULL + 1 is NULL.
    expect(sql).toContain('coalesce');
  });
});
