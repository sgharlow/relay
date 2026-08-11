/**
 * Tests for the owner-route guard.
 *
 * `requireOwner` catches whatever `getOwnerSession` throws and hands it back to
 * the caller, who checks `isResponse` and returns it. That works for the 401
 * NextResponse it is designed to throw — but the catch is untyped, so ANY other
 * failure (a thrown TypeError, a session backend outage) came back as a
 * non-Response, `isResponse` said false, and the route carried on with
 * `ownerId: undefined`.
 *
 * That is fail-OPEN on an authentication guard. The queries downstream would
 * mostly return nothing for an undefined owner, so it is a fragility rather
 * than a live hole — but the failure direction is the wrong one, and it is
 * three lines to make it structurally impossible.
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../auth/session', () => ({ getOwnerSession: vi.fn() }));

import { getOwnerSession } from '../auth/session';
import { requireOwner, isResponse, mapError } from './owner-route';

const mockSession = vi.mocked(getOwnerSession);

beforeEach(() => vi.clearAllMocks());

describe('requireOwner', () => {
  it('returns the owner id for a valid session', async () => {
    mockSession.mockResolvedValue({ ownerId: 'owner-1' } as never);
    const out = await requireOwner();
    expect(isResponse(out)).toBe(false);
    expect(out).toMatchObject({ ownerId: 'owner-1' });
  });

  it('passes through the 401 it is designed to throw', async () => {
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const out = await requireOwner();
    expect(isResponse(out)).toBe(true);
    expect((out as NextResponse).status).toBe(401);
  });

  it('denies rather than proceeding when the session layer throws something else', async () => {
    // The important one. An unexpected failure must not become an
    // unauthenticated request carrying `ownerId: undefined`.
    mockSession.mockRejectedValue(new TypeError('cannot destructure'));
    const out = await requireOwner();
    expect(isResponse(out)).toBe(true);
    expect((out as NextResponse).status).toBe(401);
  });
});

/**
 * mapError had no coverage at all, and it rethrows anything it does not
 * recognise — so a malformed identifier became a 500.
 *
 * Found 2026-08-10 by probing POST /api/rules on production with a non-UUID
 * vault_item_id: the driver raised SQLSTATE 22P02 ("invalid input syntax for
 * type uuid"), mapError rethrew it, and Next rendered a 500. Confirmed against
 * live DSQL, which raises 22P02 for every malformed id shape.
 *
 * This is caller input, so it is a 400. It matters beyond one route: 17 routes
 * share this mapper and nothing in the codebase validated UUID shape.
 */
describe('mapError — malformed identifiers are caller errors, not 500s', () => {
  function pgError(code: string, message = 'invalid input syntax for type uuid: "v"') {
    return Object.assign(new Error(message), { code, name: 'error' });
  }

  it('maps SQLSTATE 22P02 to 400 rather than rethrowing', () => {
    const res = mapError(pgError('22P02'));
    expect(res.status).toBe(400);
  });

  it('does not echo the offending value or the driver message back to the caller', async () => {
    const res = mapError(pgError('22P02', 'invalid input syntax for type uuid: "SECRET-PROBE"'));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('SECRET-PROBE');
    expect(JSON.stringify(body)).not.toContain('invalid input syntax');
  });

  it('still rethrows genuine server faults, so real bugs are not masked as 400s', () => {
    expect(() => mapError(pgError('08006', 'connection terminated'))).toThrow();
    expect(() => mapError(new TypeError('undefined is not a function'))).toThrow();
  });
});
