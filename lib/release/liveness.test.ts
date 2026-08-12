/**
 * Tests for passive liveness ([A4]).
 *
 * The signal worth having is "is this person still operating", not "did they
 * press a button". Recording it from the actions an owner already takes removes
 * the only recurring friction in the product and is a MORE accurate measure.
 *
 * ⚠️ THE THING THIS MUST NOT DO. If mere traffic counted, a phone left logged in
 * in a hospital drawer — polling, refreshing, doing nothing a human chose —
 * would keep marking its owner alive and **suppress the dead-man's-switch at
 * exactly the moment it exists to fire**. That fails safe rather than open, so it
 * is not a security hole; it is silent feature death, which is the failure mode
 * this codebase produces most often. So only DELIBERATE actions count, and the
 * list of them is explicit rather than "anything that isn't a GET".
 *
 * And §3.7 rule 8: a multi-hat user acting on somebody else's standby dashboard
 * must not extend their OWN liveness.
 *
 * Feature: relay-standby
 * Requirements: 4.2, J5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { recordDeliberateActivity, isDeliberate } from './liveness';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('isDeliberate — what counts as a person choosing to act', () => {
  it('counts writes: the owner changed something', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isDeliberate(m)).toBe(true);
    }
  });

  it('does NOT count reads, however many arrive', () => {
    // A tab left open on a bedside table refreshes forever. That is not a person.
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isDeliberate(m)).toBe(false);
    }
  });

  it('is case-insensitive, because a method is not a promise about casing', () => {
    expect(isDeliberate('post')).toBe(true);
    expect(isDeliberate('get')).toBe(false);
  });

  it('treats an unknown method as NOT deliberate — the safe direction is fewer', () => {
    expect(isDeliberate('WEIRD')).toBe(false);
    expect(isDeliberate('')).toBe(false);
  });
});

describe('recordDeliberateActivity', () => {
  it('stamps last_active_at for the acting user', async () => {
    await recordDeliberateActivity({ userId: 'user-1', method: 'POST' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('last_active_at');
    expect(params[0]).toBe('user-1');
  });

  it('writes nothing at all for a read', async () => {
    await recordDeliberateActivity({ userId: 'user-1', method: 'GET' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does NOT extend liveness for work done in someone else’s context', async () => {
    // §3.7 rule 8. Confirming a release for Margaret says nothing about whether
    // you are still around to look after your own vault.
    await recordDeliberateActivity({
      userId: 'user-1',
      method: 'POST',
      actingForOwnerId: 'someone-else',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does extend it when acting in your own context', async () => {
    await recordDeliberateActivity({
      userId: 'user-1',
      method: 'POST',
      actingForOwnerId: 'user-1',
    });
    expect(mockQuery).toHaveBeenCalled();
  });

  it('never lets a liveness write break the request it rode in on', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordDeliberateActivity({ userId: 'user-1', method: 'POST' }),
    ).resolves.toBeUndefined();
  });
});
