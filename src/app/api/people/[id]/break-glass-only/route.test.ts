/**
 * Tests for POST /api/people/[id]/break-glass-only.
 *
 * WHY THIS FILE EXISTS. 0% statements and 0% branches on 2026-08-22, and the
 * handler opens by naming its own failure mode:
 *
 *   ⚠️ THIS ROUTE DELIBERATELY ANSWERS WITH THE CONSEQUENCE, not just `ok`.
 *   The failure mode of this feature is converting a nagging red light into a
 *   comfortable silence: an owner marks two of three verifiers as paper-only,
 *   the nagging stops, and the plan is now impossible with nothing saying so.
 *
 * A stated intention with nothing checking it is a comment. `blocker` coming
 * back in the response IS the feature — remove it and the route still returns
 * 200, the exclusion still records, every other test still passes, and an owner
 * quietly ends up with a plan that cannot execute. So the tests below assert the
 * consequence travels, in the case where it exists and in the case where it does
 * not, rather than asserting the write happened.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../../lib/people/break-glass-only', () => ({
  setBreakGlassOnly: vi.fn(async () => undefined),
}));
vi.mock('../../../../../../lib/vault/readiness', () => ({ assessReadiness: vi.fn() }));
vi.mock('../../../../../../lib/db/integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/db/integrity')>();
  return { ...actual, assertOwns: vi.fn() };
});

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { setBreakGlassOnly } from '../../../../../../lib/people/break-glass-only';
import { assessReadiness } from '../../../../../../lib/vault/readiness';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockSet = vi.mocked(setBreakGlassOnly);
const mockAssess = vi.mocked(assessReadiness);
const mockAssertOwns = vi.mocked(assertOwns);

const OWNER = 'owner-1';
const PERSON = 'verifier-2';
const ctx = { params: Promise.resolve({ id: PERSON }) };

function makeReq(body: unknown) {
  return { method: 'POST', headers: new Headers(), json: async () => body } as never;
}

/** Readiness with no fatal blocker: the plan still works. */
function healthy() {
  return {
    blockers: [{ fatal: false, message: 'One recipient has not claimed yet.', href: '/circle' }],
    circle: { light: 'amber', executable: true },
  } as never;
}

/** Readiness where the plan can no longer execute. */
function broken() {
  return {
    blockers: [
      { fatal: false, message: 'A cosmetic one, listed first.', href: '/circle' },
      { fatal: true, message: 'Only 1 of the 2 verifiers you require can answer.', href: '/circle' },
    ],
    circle: { light: 'red', executable: false },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockAssertOwns.mockResolvedValue(undefined as never);
  mockAssess.mockResolvedValue(healthy());
});

describe('POST /api/people/[id]/break-glass-only — the consequence comes back', () => {
  /*
    🔴 THE LOAD-BEARING TEST. Mark a verifier paper-only, and if that makes the
    quorum unsatisfiable the owner learns NOW — in the response to the click —
    rather than on whatever page load happens to render the banner next. Delete
    the `blocker:` field from the handler and only this goes red.
  */
  it('returns the fatal blocker the exclusion just created', async () => {
    mockAssess.mockResolvedValueOnce(broken());

    const res = await POST(makeReq({ personType: 'verifier', value: true }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      breakGlassOnly: true,
      blocker: {
        message: 'Only 1 of the 2 verifiers you require can answer.',
        href: '/circle',
      },
      circle: { light: 'red', executable: false },
    });
  });

  it('picks the FATAL blocker, not merely the first one', async () => {
    // `broken()` lists a cosmetic blocker first on purpose. A `blockers[0]` here
    // would return the harmless one and the red light would still read green
    // enough to ignore.
    mockAssess.mockResolvedValueOnce(broken());
    const body = (await (await POST(makeReq({ personType: 'verifier' }), ctx)).json()) as {
      blocker: { message: string };
    };
    expect(body.blocker.message).toMatch(/verifiers you require/);
  });

  it('returns blocker null when the plan still works', async () => {
    const res = await POST(makeReq({ personType: 'verifier', value: true }), ctx);
    await expect(res.json()).resolves.toMatchObject({ blocker: null });
  });

  it('re-reads readiness AFTER the write, so the answer reflects the change', async () => {
    const order: string[] = [];
    mockSet.mockImplementationOnce(async () => {
      order.push('write');
    });
    mockAssess.mockImplementationOnce(async () => {
      order.push('assess');
      return healthy();
    });

    await POST(makeReq({ personType: 'verifier', value: true }), ctx);
    // Reversed, the response would describe the plan as it was a moment ago —
    // which is precisely the comfortable silence the header warns about.
    expect(order).toEqual(['write', 'assess']);
  });
});

describe('POST /api/people/[id]/break-glass-only — what it writes', () => {
  it.each([
    ['an explicit true', true, true],
    ['an omitted value', undefined, true],
    ['a truthy non-boolean', 'yes', true],
    ['an explicit false', false, false],
  ])('treats %s as breakGlassOnly=%s', async (_label, value, expected) => {
    mockSet.mockClear();
    const res = await POST(makeReq({ personType: 'verifier', value }), ctx);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER, personId: PERSON, value: expected }),
    );
    await expect(res.json()).resolves.toMatchObject({ breakGlassOnly: expected });
  });

  it('checks the person belongs to this owner before writing', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'not yours'));

    const res = await POST(makeReq({ personType: 'verifier' }), ctx);

    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockAssess).not.toHaveBeenCalled();
  });

  it('looks the person up in the table their type names', async () => {
    await POST(makeReq({ personType: 'recipient' }), ctx);
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'recipients', PERSON);

    mockAssertOwns.mockClear();
    await POST(makeReq({ personType: 'verifier' }), ctx);
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'verifiers', PERSON);
  });

  it.each([
    ['an unknown personType', { personType: 'neighbour' }],
    ['a missing personType', { value: true }],
    ['a null body', null],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const res = await POST(makeReq(body), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ field: 'personType' });
    expect(mockAssertOwns).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq({ personType: 'verifier' }), ctx);
    expect(res.status).toBe(401);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
