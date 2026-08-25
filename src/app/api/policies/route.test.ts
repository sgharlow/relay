/**
 * Tests for POST /api/policies.
 *
 * WHY THIS FILE EXISTS. The handler read 0% statements and 0% branches on
 * 2026-08-22 — 28 statements, 22 branches, none executed. `policy-predicate.ts`
 * and `policy-materialize.ts` are both well covered; the *door* onto them was
 * not, and this is one of the four doors `ratified.estate-gated-until-counsel`
 * names as enforcing the estate refusal "at the trust boundary, not in the
 * dropdown".
 *
 * 🔴 THE PROPERTY THAT MATTERS MOST HERE IS THAT A BRANCH IS UNREACHABLE.
 * `TRIGGER_TYPES` is `USER_SELECTABLE_TRIGGER_TYPES`, which excludes `estate`
 * permanently (`gates.g2-counsel-opinion.declined`, 2026-08-14). So the
 * type check refuses `estate` before the acknowledgement branch below it can
 * run, and `isEstate` is always false — the dormant path
 * `ratified.policy-edit-routes`' sibling entry describes as "left dormant rather
 * than deleted". That is a deliberate arrangement of two guards where the
 * *first* is load-bearing, and the failure mode is somebody widening
 * `TRIGGER_TYPES` back to `VALID_TRIGGER_TYPES` and finding the acknowledgement
 * branch waiting to make it work. `lib/domain/enums.test.ts` pins the list;
 * these tests pin what this route does with it, which is the half a list test
 * cannot see.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R6, J4-R7, J4-R14, CC6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../lib/rules/policy-materialize', () => ({ materializePolicy: vi.fn() }));
vi.mock('../../../../lib/db/integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/db/integrity')>();
  return { ...actual, assertOwns: vi.fn() };
});

import { getOwnerSession } from '../../../../lib/auth/session';
import { query } from '../../../../lib/db/connection';
import { assertOwns, IntegrityError } from '../../../../lib/db/integrity';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { materializePolicy } from '../../../../lib/rules/policy-materialize';
import { USER_SELECTABLE_TRIGGER_TYPES, VALID_TRIGGER_TYPES } from '../../../../lib/domain/enums';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);
const mockAssertOwns = vi.mocked(assertOwns);
const mockAudit = vi.mocked(writeAuditEntry);
const mockMaterialize = vi.mocked(materializePolicy);

const OWNER = 'owner-1';
const RECIPIENT = 'recipient-1';

function makeReq(body: unknown) {
  return { method: 'POST', headers: new Headers(), json: async () => body } as never;
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    recipient_id: RECIPIENT,
    trigger_type: 'emergency',
    scope: 'view',
    predicate: { categories: ['finance'] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockAssertOwns.mockResolvedValue(undefined as never);
  mockQuery.mockResolvedValue({ rows: [{ id: 'policy-1' }] } as never);
  mockMaterialize.mockResolvedValue({ granted: 3, revoked: 0 } as never);
});

describe('POST /api/policies — the happy path', () => {
  it('inserts a reversible policy and materialises it into access_rules', async () => {
    const res = await POST(makeReq(validBody()));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: 'policy-1', granted: 3, revoked: 0 });

    // `reversible` is the fifth bound parameter and must be TRUE for every type
    // a user can actually choose. The one shape that could set it false is the
    // withdrawn one.
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(OWNER);
    expect(params[1]).toBe(RECIPIENT);
    expect(params[4]).toBe(true);

    // A policy only ever PROPOSES; access_rules is the authority the KMS unwrap
    // path consults (J4-R3), so materialisation is not optional garnish.
    expect(mockMaterialize).toHaveBeenCalledWith(OWNER, 'policy-1');
  });

  it('checks the recipient belongs to this owner before writing anything (DSQL has no FKs)', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'not yours'));

    const res = await POST(makeReq(validBody()));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('stores the validated predicate, not the raw body', async () => {
    await POST(makeReq(validBody({ predicate: { categories: ['finance'], nonsense: 'ignored' } })));

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(JSON.parse(params[5] as string)).not.toHaveProperty('nonsense');
  });

  it('accepts every scope the route declares, and refuses anything else', async () => {
    for (const scope of ['view', 'act']) {
      vi.clearAllMocks();
      mockSession.mockResolvedValue({ ownerId: OWNER } as never);
      mockAssertOwns.mockResolvedValue(undefined as never);
      mockQuery.mockResolvedValue({ rows: [{ id: 'policy-1' }] } as never);
      mockMaterialize.mockResolvedValue({ granted: 0, revoked: 0 } as never);
      expect((await POST(makeReq(validBody({ scope })))).status).toBe(201);
    }

    const res = await POST(makeReq(validBody({ scope: 'admin' })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ field: 'scope' });
  });
});

/*
  ⛔ ESTATE IS WITHDRAWN PERMANENTLY. Not gated, not pending, not conditional on
  an acknowledgement — `gates.g2-counsel-opinion` was CLOSED BY REMOVING THE
  CAPABILITY rather than by satisfying it, and CLAUDE.md's first paragraph says
  in terms: "Do not widen the selectable list and do not build estate."
*/
describe('POST /api/policies — estate is refused at the trust boundary', () => {
  it('refuses trigger_type estate, on the TYPE check rather than the acknowledgement', async () => {
    const res = await POST(makeReq(validBody({ trigger_type: 'estate' })));

    expect(res.status).toBe(400);
    // The field names which guard fired. `acknowledgedIrreversible` here would
    // mean the type check had let it through and the second guard caught it —
    // a different and much weaker arrangement.
    await expect(res.json()).resolves.toMatchObject({
      error: 'ValidationError',
      field: 'trigger_type',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still refuses estate when the caller supplies the acknowledgement it once wanted', async () => {
    const res = await POST(
      makeReq(validBody({ trigger_type: 'estate', acknowledgedIrreversible: true })),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ field: 'trigger_type' });
    expect(mockQuery).not.toHaveBeenCalled();
    // The dormant path writes this row. Nothing must ever reach it.
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'estate_irreversibility_acknowledged' }),
    );
  });

  /*
    The structural half. `estate` is in VALID_TRIGGER_TYPES (the domain still
    supports it — Property 7, heartbeat blocking and grace windows depend on it,
    and production rows exist) and out of USER_SELECTABLE_TRIGGER_TYPES. This
    route must bind the SECOND list. If somebody swaps the import, every type
    below starts being accepted and this test is what says so.
  */
  it('accepts exactly the user-selectable list, and no other domain type', async () => {
    for (const t of USER_SELECTABLE_TRIGGER_TYPES) {
      vi.clearAllMocks();
      mockSession.mockResolvedValue({ ownerId: OWNER } as never);
      mockAssertOwns.mockResolvedValue(undefined as never);
      mockQuery.mockResolvedValue({ rows: [{ id: 'p' }] } as never);
      mockMaterialize.mockResolvedValue({ granted: 0, revoked: 0 } as never);
      expect((await POST(makeReq(validBody({ trigger_type: t })))).status).toBe(201);
    }

    const withdrawn = VALID_TRIGGER_TYPES.filter(
      (t) => !(USER_SELECTABLE_TRIGGER_TYPES as readonly string[]).includes(t),
    );
    // If this ever empties, the two lists have been merged and the refusal this
    // whole block tests has silently stopped existing.
    expect(withdrawn).toContain('estate');

    for (const t of withdrawn) {
      const res = await POST(makeReq(validBody({ trigger_type: t })));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ field: 'trigger_type' });
    }
  });
});

describe('POST /api/policies — refusals', () => {
  it.each([
    ['a missing recipient_id', { recipient_id: undefined }, 'recipient_id'],
    ['a non-string recipient_id', { recipient_id: 42 }, 'recipient_id'],
    ['an unknown trigger_type', { trigger_type: 'weather' }, 'trigger_type'],
    ['a missing trigger_type', { trigger_type: undefined }, 'trigger_type'],
    ['a missing scope', { scope: undefined }, 'scope'],
  ])('refuses %s with 400 and names the field', async (_label, over, field) => {
    const res = await POST(makeReq(validBody(over)));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'ValidationError', field });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before reading the body', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses an invalid predicate rather than storing an unenforceable one', async () => {
    // A predicate that selects nothing checkable is the shape J4-R14/R15 warn
    // about: a grant table written from a rule nobody can evaluate.
    const res = await POST(makeReq(validBody({ predicate: { categories: ['not-a-category'] } })));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
