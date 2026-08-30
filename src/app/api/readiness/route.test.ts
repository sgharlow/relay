/**
 * "Can this vault actually open?"
 *
 * This handler executed no test until 2026-08-30 — the route behind the banner
 * that, on 2026-08-29, told a real owner the wrong thing for a whole session.
 *
 * The route itself is four lines, and that is the point of testing it: its only
 * job is to refuse without a session and otherwise hand back the assessment
 * unchanged. A route that re-shaped, defaulted or partially rendered the
 * readiness verdict would be a second opinion about whether somebody's vault can
 * open, competing with the one in `lib/vault/readiness.ts`.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/vault/readiness', () => ({ assessReadiness: vi.fn() }));

import { requireOwner } from '../../../../lib/http/owner-route';
import { assessReadiness } from '../../../../lib/vault/readiness';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockAssess = vi.mocked(assessReadiness);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const NOT_READY = {
  executable: false,
  blockers: ['no confirmed verifier'],
  counts: { items: 1, recipients: 1, verifiers: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockAssess.mockResolvedValue(NOT_READY as never);
});

describe('asking whether the plan would work', () => {
  it('assesses the session owner', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockAssess).toHaveBeenCalledWith(OWNER);
  });

  it('returns the verdict unchanged, blockers and all', async () => {
    // A vault that cannot open must say so. Softening or omitting the blockers
    // here is how a readiness banner comes to lie to an owner.
    expect(await (await GET()).json()).toEqual(NOT_READY);
  });

  it('passes a ready verdict through just as faithfully', async () => {
    const ready = { executable: true, blockers: [], counts: { items: 3, recipients: 2, verifiers: 2 } };
    mockAssess.mockResolvedValueOnce(ready as never);
    expect(await (await GET()).json()).toEqual(ready);
  });

  it('refuses without a session and assesses nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockAssess).not.toHaveBeenCalled();
  });
});
