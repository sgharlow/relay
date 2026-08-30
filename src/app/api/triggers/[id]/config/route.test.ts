/**
 * Configuring a trigger's N-of-M quorum — the number that decides whether a
 * release can ever complete.
 *
 * This handler executed no test until 2026-08-30. It is the route where the
 * live system's own most consequential misconfiguration is set: an owner today
 * holds N = 1 against M = 0 eligible verifiers, so a trigger firing reaches
 * GRACE and stops there for good. Three properties keep that from being written
 * on purpose, and none was held:
 *
 * 🔴 M IS WHO CAN ACTUALLY ANSWER, NOT HOW MANY ROSTER ROWS EXIST. A bare
 * `COUNT(*)` permits an unsatisfiable quorum — require 2 from a circle where one
 * person can act, and the release simply never completes, with no error
 * anywhere. `countEligibleVerifiers` is the real implementation here rather than
 * a mock, because the property under test is precisely that the route feeds it
 * the right rows: unconfirmed people, and people who are also recipients on this
 * trigger, must not be counted.
 *
 * 🔴 `estate` IS REFUSED, PERMANENTLY. `g2-counsel-opinion` was DECLINED on
 * 2026-08-14, not met. Configuring an estate trigger's N-of-M is part of arming
 * it, so it is refused with the rest — and the refusal happens before the body
 * is even read.
 *
 * 🔴 A MID-RELEASE CHANGE IS A 409, NOT A 500. Lowering N during a live GRACE
 * used to open the vault on the next hourly sweep with nobody doing anything.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.9, 6.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../../lib/release/provisioning', () => ({
  setRequiredConfirmations: vi.fn(),
}));
vi.mock('../../../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { setRequiredConfirmations } from '../../../../../../lib/release/provisioning';
import { query } from '../../../../../../lib/db/connection';
import { TriggerError } from '../../../../../../lib/release/triggers';
import { PUT } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockSet = vi.mocked(setRequiredConfirmations);
const mockQuery = vi.mocked(query);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const USER_A = 'aaaaaaaa-2222-4333-8444-555566667777';
const USER_B = 'bbbbbbbb-2222-4333-8444-555566667777';

let verifiers: Record<string, unknown>[];
let recipientUsers: Record<string, unknown>[];

function routeQuery(sql: unknown): { rows: Record<string, unknown>[] } {
  const s = String(sql);
  if (/FROM verifiers/.test(s)) return { rows: verifiers };
  if (/FROM recipients/.test(s)) return { rows: recipientUsers };
  throw new Error('unexpected query: ' + s);
}

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/triggers/emergency/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = (id = 'emergency') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  verifiers = [
    { id: 'v-1', claimed_user_id: USER_A, standby_state: 'confirmed' },
    { id: 'v-2', claimed_user_id: USER_B, standby_state: 'confirmed' },
  ];
  recipientUsers = [];
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockQuery.mockImplementation(async (sql: unknown) => routeQuery(sql) as never);
  mockSet.mockResolvedValue({ required_confirmations: 2 } as never);
});

describe('M is who can actually answer', () => {
  it('accepts an N the confirmed verifiers can satisfy', async () => {
    const res = await PUT(req({ required_confirmations: 2 }), ctx());
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(OWNER, 'emergency', 2, 2);
    expect(await res.json()).toEqual({ required_confirmations: 2, verifier_count: 2 });
  });

  it('refuses an N that only unconfirmed people could meet', async () => {
    /*
      The live system's own state, asserted as a rule: two roster rows, neither
      confirmed, so M = 0 and no N above zero is satisfiable. A COUNT(*) would
      have said 2 and written a quorum that can never complete.
    */
    verifiers = [
      { id: 'v-1', claimed_user_id: null, standby_state: 'invited' },
      { id: 'v-2', claimed_user_id: null, standby_state: 'invited' },
    ];
    const res = await PUT(req({ required_confirmations: 1 }), ctx());
    expect(res.status).toBe(400);
    expect(String((await res.json()).message)).toMatch(/only 0 could answer/);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does not count a verifier who is also a recipient on this trigger', async () => {
    // Nobody helps authorize their own access (rule 6). With USER_A excluded,
    // M drops to 1 and a 2-of-2 becomes unsatisfiable.
    recipientUsers = [{ claimed_user_id: USER_A }];
    const res = await PUT(req({ required_confirmations: 2 }), ctx());
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('counts one human once, however many rows they hold', async () => {
    // One person invited at two addresses claims both with the same account.
    // Two rows, one person — a 2-of-2 they could satisfy alone.
    verifiers = [
      { id: 'v-1', claimed_user_id: USER_A, standby_state: 'confirmed' },
      { id: 'v-2', claimed_user_id: USER_A, standby_state: 'confirmed' },
    ];
    const res = await PUT(req({ required_confirmations: 2 }), ctx());
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('scopes the recipient conflict lookup to this owner and trigger', async () => {
    await PUT(req({ required_confirmations: 2 }), ctx());
    const call = mockQuery.mock.calls.find((c) => /FROM recipients/.test(String(c[0])));
    expect(call?.[1]).toEqual([OWNER, 'emergency']);
  });
});

describe('estate is withdrawn, permanently', () => {
  it('refuses to configure it, before reading the body', async () => {
    const res = await PUT(req({ required_confirmations: 1 }), ctx('estate'));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('refuses an unknown trigger type the same way', async () => {
    const res = await PUT(req({ required_confirmations: 1 }), ctx('whatever'));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('refuses without a session', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await PUT(req({ required_confirmations: 1 }), ctx());
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses a zero or negative N', async () => {
    for (const n of [0, -1]) {
      vi.clearAllMocks();
      mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
      mockQuery.mockImplementation(async (sql: unknown) => routeQuery(sql) as never);
      const res = await PUT(req({ required_confirmations: n }), ctx());
      expect(res.status).toBe(400);
      expect(mockSet).not.toHaveBeenCalled();
    }
  });

  it('refuses a non-numeric N rather than coercing it', async () => {
    const res = await PUT(req({ required_confirmations: 'two' }), ctx());
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('refuses a fractional N', async () => {
    const res = await PUT(req({ required_confirmations: 1.5 }), ctx());
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('reports a mid-release change as 409, not as a 500', async () => {
    mockSet.mockRejectedValueOnce(new TriggerError('release in progress', 409));
    const res = await PUT(req({ required_confirmations: 2 }), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'TriggerError' });
  });
});
