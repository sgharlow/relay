/**
 * Tests for J6's session door.
 *
 * The load-bearing properties are negative: it must resolve from the database
 * rather than the token, must not cross owners, and must not resurrect somebody
 * the owner revoked.
 *
 * Feature: relay-standby
 * Requirements: J6-R1, J6-R2, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { resolveRequesterFor } from './requester-session';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('resolveRequesterFor', () => {
  it('returns the roster row this user fills for this owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r-1' }], rowCount: 1 } as never);
    await expect(resolveRequesterFor('u-1', 'o-1')).resolves.toEqual({
      recipientId: 'r-1',
      ownerId: 'o-1',
    });
  });

  it('returns null rather than throwing when the user is not named', async () => {
    // The ordinary answer for an owner, a verifier-only contact, or somebody
    // asking about a vault they are not on. Must never read as an error.
    await expect(resolveRequesterFor('u-1', 'o-1')).resolves.toBeNull();
  });

  it('is scoped to the exact (user, owner) pair', async () => {
    await resolveRequesterFor('u-1', 'o-1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1', 'o-1']);
  });

  it('excludes a revoked recipient in SQL, not in JS', async () => {
    // Revocation is the control behind the coercion risk. A withdrawn person
    // must not be resurrectable by a rendering bug.
    await resolveRequesterFor('u-1', 'o-1');
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/<>\s*'revoked'/);
  });

  it('resolves from claimed_user_id — the row, never the token', async () => {
    // §3.7 rule 1. If this trusted a session claim instead, revocation would be
    // delayed by the token lifetime.
    await resolveRequesterFor('u-1', 'o-1');
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/claimed_user_id = \$1/);
  });

  it('accepts `claimed` and does not require `confirmed` (Steve, 2026-08-12)', async () => {
    // Break-glass redemption sets `claimed`, so a confirmed-only bar would
    // exclude the exact person break-glass exists for. The petition is bounded
    // downstream: 3 per 24h, the owner answers first, and only CONFIRMED
    // verifiers can carry it past them.
    const sql = String(
      (await resolveRequesterFor('u-1', 'o-1'), mockQuery.mock.calls[0][0]),
    );
    expect(sql).not.toMatch(/=\s*'confirmed'/);
  });
});
