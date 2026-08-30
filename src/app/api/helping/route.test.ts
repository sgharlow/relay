/**
 * The helper's own screen — the vaults they help with, and what they have done.
 *
 * This handler executed no test until 2026-08-30. It exists because an
 * appointment used to achieve nothing: an owner could name somebody and record
 * consent, and the person on the other end had no screen, no notification and no
 * way to discover it.
 *
 * 🔴 THE RESPONSE IS SHAPED BY WHAT A HELPER MAY SEE, NOT BY FILTERING WHAT AN
 * OWNER SEES (J3-R4). It carries the items this delegation entered and the
 * proposals it made — never the vault, the circle, the triggers or the release
 * state, because those are not narrowed views of this data, they are different
 * questions this route does not ask. A future change that "enriched" this
 * response by reaching for an owner-shaped read would widen a helper's view with
 * no visible symptom.
 *
 * 🔴 `requireOwner()` WITHOUT `req`, DELIBERATELY (§3.7 rule 8). Tidying somebody
 * else's vault must not extend the HELPER'S own dead-man's switch — the same
 * choice `/api/verify` makes, and the same reason. Asserted here too, because
 * this is the second of the two routes where the codebase-wide convention is
 * inverted and a consistency pass would break both.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R4, J3-R6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/people/delegate-workspace', () => ({
  listVaultsIHelp: vi.fn(async () => []),
  listItemsIEntered: vi.fn(async () => []),
  listMyPendingProposals: vi.fn(async () => []),
}));

import { requireOwner } from '../../../../lib/http/owner-route';
import {
  listVaultsIHelp,
  listItemsIEntered,
  listMyPendingProposals,
} from '../../../../lib/people/delegate-workspace';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockVaults = vi.mocked(listVaultsIHelp);
const mockItems = vi.mocked(listItemsIEntered);
const mockProposals = vi.mocked(listMyPendingProposals);

const HELPER = '9510683f-af55-4265-8840-b2986824a2e1';
const OWNER_A = 'aaaaaaaa-2222-4333-8444-555566667777';
const OWNER_B = 'bbbbbbbb-2222-4333-8444-555566667777';

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: HELPER });
  mockVaults.mockResolvedValue([]);
  mockItems.mockResolvedValue([]);
  mockProposals.mockResolvedValue([]);
});

describe('helping must not count as the helper checking in', () => {
  it('does not pass the request to requireOwner', async () => {
    await GET();
    expect(mockRequireOwner.mock.calls[0][0]).toBeUndefined();
  });
});

describe('the helper’s workspace', () => {
  it('lists the vaults this person helps with, keyed on their own id', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockVaults).toHaveBeenCalledWith(HELPER);
  });

  it('scopes items and proposals to the OWNER and the DELEGATION together', async () => {
    // Either half alone is wrong: the owner alone would show everything in that
    // vault, the delegation alone would not be scoped to a vault at all.
    mockVaults.mockResolvedValueOnce([
      { ownerId: OWNER_A, delegationId: 'd-1' },
      { ownerId: OWNER_B, delegationId: 'd-2' },
    ] as never);
    await GET();
    expect(mockItems).toHaveBeenCalledWith(OWNER_A, 'd-1');
    expect(mockItems).toHaveBeenCalledWith(OWNER_B, 'd-2');
    expect(mockProposals).toHaveBeenCalledWith(OWNER_A, 'd-1');
    expect(mockProposals).toHaveBeenCalledWith(OWNER_B, 'd-2');
  });

  it('returns one entry per vault, each carrying its own two lists', async () => {
    mockVaults.mockResolvedValueOnce([{ ownerId: OWNER_A, delegationId: 'd-1' }] as never);
    mockItems.mockResolvedValueOnce([{ id: 'i-1', title: 'Utilities' }] as never);
    mockProposals.mockResolvedValueOnce([{ id: 'p-1' }] as never);
    const body = await (await GET()).json();
    expect(body.vaults).toHaveLength(1);
    expect(body.vaults[0]).toMatchObject({
      ownerId: OWNER_A,
      delegationId: 'd-1',
      items: [{ id: 'i-1', title: 'Utilities' }],
      proposals: [{ id: 'p-1' }],
    });
  });

  it('answers with an empty list when this person helps with nothing', async () => {
    const body = await (await GET()).json();
    expect(body).toEqual({ vaults: [] });
    expect(mockItems).not.toHaveBeenCalled();
  });

  it('carries no vault, circle, trigger or release state (J3-R4)', async () => {
    mockVaults.mockResolvedValueOnce([{ ownerId: OWNER_A, delegationId: 'd-1' }] as never);
    const body = await (await GET()).json();
    // Named explicitly rather than checked loosely: these are the four questions
    // this route deliberately does not answer.
    expect(body.vaults[0]).not.toHaveProperty('recipients');
    expect(body.vaults[0]).not.toHaveProperty('verifiers');
    expect(body.vaults[0]).not.toHaveProperty('triggers');
    expect(body.vaults[0]).not.toHaveProperty('releaseState');
    expect(Object.keys(body)).toEqual(['vaults']);
  });
});

describe('what it refuses', () => {
  it('refuses without a session and reads nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockVaults).not.toHaveBeenCalled();
  });
});
