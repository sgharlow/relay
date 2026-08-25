/**
 * Tests for DELETE /api/rules/[id].
 *
 * WHY THIS FILE EXISTS. `access_rules` is the SOLE authority the KMS unwrap path
 * consults — a recipient decrypts only when a row here links them to the item
 * (Property 6) — so this is the door that removes a grant, and it read 0%
 * statements and 0% branches on 2026-08-22. Five statements is not a reason to
 * leave it uncovered; it is a reason it takes ten lines to cover.
 *
 * The whole handler is one property: the owner id from the SESSION reaches
 * `deleteRule` alongside the id from the PATH. Aurora DSQL has no foreign keys
 * and no row-level security, so `WHERE id = $1 AND owner_id = $2` is the entire
 * mechanism keeping one owner out of another's grant table — and this route is
 * where the second half of that predicate is supplied. `access-rules.test.ts`
 * proves the statement is scoped; only a test here proves the route scopes it.
 *
 * ⚠️ PUT is deliberately absent (retired 2026-08-13,
 * `ratified.policy-edit-routes`' sibling reasoning: a rule is changed by removing
 * it and writing another). The last test asserts it stayed gone, because
 * "unreachable" is a claim about the module's exports, not about intent.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.3, 3.5, 3.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/rules/access-rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/rules/access-rules')>();
  return { ...actual, deleteRule: vi.fn(async () => undefined) };
});

import { getOwnerSession } from '../../../../../lib/auth/session';
import { deleteRule } from '../../../../../lib/rules/access-rules';
import * as routeModule from './route';
import { DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockDelete = vi.mocked(deleteRule);

const OWNER = 'owner-1';
const RULE = 'rule-7';
const ctx = { params: Promise.resolve({ id: RULE }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
});

describe('DELETE /api/rules/[id]', () => {
  it('deletes the rule scoped to the signed-in owner', async () => {
    const res = await DELETE({} as never, ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    // Both arguments, in this order. DSQL has no FKs and no RLS; the owner id
    // travelling with the path id IS the cross-owner guard.
    expect(mockDelete).toHaveBeenCalledWith(OWNER, RULE);
  });

  it('refuses an unauthenticated caller without deleting anything', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await DELETE({} as never, ctx);
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  /*
    A rule id nobody owns and a rule id belonging to somebody else are the same
    request from outside, and both must answer identically: the scoped DELETE
    matches nothing and the caller is told the same thing as an owner deleting
    their own. Reporting "not found" here would turn this route into an oracle
    for which rule ids exist.
  */
  it('answers the same when the scoped delete matches nothing', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    const res = await DELETE({} as never, { params: Promise.resolve({ id: 'someone-elses' }) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    expect(mockDelete).toHaveBeenCalledWith(OWNER, 'someone-elses');
  });

  it('PUT stays retired — the module exports DELETE and nothing else', async () => {
    // Asserted on the exports rather than on a comment. `updateRule` survives in
    // lib/rules/access-rules.ts with its tests; what was retired is the DOOR.
    expect(Object.keys(routeModule).sort()).toEqual(['DELETE']);
  });
});
