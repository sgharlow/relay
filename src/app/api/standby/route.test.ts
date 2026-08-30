/**
 * Rung 0 — "what am I on standby for?", answered by looking.
 *
 * This handler executed no test until 2026-08-30. It is the rung every channel
 * above it is allowed to fail against: if the email never arrives, this screen
 * is how a contact still finds out. Three properties had nothing holding them:
 *
 * 🔴 MEMBERSHIP IS RESOLVED FROM THE DATABASE, NEVER FROM THE SESSION TOKEN
 * (§3.7 rule 1). The JWT is a snapshot; authorizing from it would delay
 * revocation by the token lifetime. Pinned by asserting what `resolveStandbyFor`
 * receives — the session user id and nothing else.
 *
 * 🔴 THE DRILL READ MUST NOT ACKNOWLEDGE. `pendingDrillsFor` looks and
 * `acknowledgePendingDrills` answers, and they are separate functions because a
 * dashboard that acknowledged on render would manufacture the very evidence the
 * fire drill exists to earn from a human pressing a button. This asserts the
 * READ function is the one called — the strongest form available here, since the
 * writing function must not appear on this path at all.
 *
 * 🔴 `requireOwner` IS A MISNOMER ON THIS ROUTE. It authenticates a USER; whether
 * they own a vault is a separate question this handler answers with a count. A
 * contact who owns nothing must still get a 200 with `hasOwnVault: false` — that
 * is [A6]'s whole conversion surface, and a handler that refused them would look
 * exactly like a working auth guard.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/access/standby-resolve', () => ({
  resolveStandbyFor: vi.fn(),
}));
vi.mock('../../../../lib/auth/webauthn', () => ({
  listCredentialIdsForUser: vi.fn(async () => []),
}));
vi.mock('../../../../lib/db/connection', () => ({
  query: vi.fn(async () => ({ rows: [{ n: '0' }] })),
}));
vi.mock('../../../../lib/release/fire-drill', () => ({
  pendingDrillsFor: vi.fn(async () => []),
}));

import { requireOwner } from '../../../../lib/http/owner-route';
import { resolveStandbyFor } from '../../../../lib/access/standby-resolve';
import { listCredentialIdsForUser } from '../../../../lib/auth/webauthn';
import { query } from '../../../../lib/db/connection';
import { pendingDrillsFor } from '../../../../lib/release/fire-drill';
import { IntegrityError } from '../../../../lib/db/integrity';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockResolve = vi.mocked(resolveStandbyFor);
const mockCreds = vi.mocked(listCredentialIdsForUser);
const mockQuery = vi.mocked(query);
const mockDrills = vi.mocked(pendingDrillsFor);

const USER = '9510683f-af55-4265-8840-b2986824a2e1';
const RESOLUTION = { roles: [{ ownerId: 'o-1', personType: 'verifier' }], openReleases: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: USER });
  mockResolve.mockResolvedValue(RESOLUTION as never);
  mockCreds.mockResolvedValue([]);
  mockQuery.mockResolvedValue({ rows: [{ n: '0' }] } as never);
  mockDrills.mockResolvedValue([]);
});

describe('resolving what somebody stands by for', () => {
  it('resolves from the database against the session user', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    // §3.7 rule 1 — the id comes from the session, and the lookup is a live read.
    expect(mockResolve).toHaveBeenCalledWith({ userId: USER });
  });

  it('returns the resolution alongside the three derived flags', async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      ...RESOLUTION,
      hasOwnVault: false,
      hasPasskey: false,
      drillPending: false,
    });
  });

  it('serves a contact who owns no vault at all', async () => {
    // [A6]'s conversion surface. Refusing here would be indistinguishable from
    // a working auth guard while quietly breaking rung 0 for exactly the people
    // it exists for.
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).hasOwnVault).toBe(false);
  });

  it('reports hasOwnVault once the same person holds items', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '4' }] } as never);
    expect((await (await GET()).json()).hasOwnVault).toBe(true);
  });

  it('counts the vault against the caller, never a broader query', async () => {
    await GET();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/owner_id = \$1/);
    expect(params).toEqual([USER]);
  });

  it('treats an absent count row as no vault rather than throwing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).hasOwnVault).toBe(false);
  });

  it('reports hasPasskey from the credential list for the same user', async () => {
    mockCreds.mockResolvedValueOnce(['cred-1']);
    expect((await (await GET()).json()).hasPasskey).toBe(true);
    expect(mockCreds).toHaveBeenCalledWith(USER);
  });
});

describe('the fire drill is read, never answered', () => {
  it('reports drillPending when somebody is waiting to hear', async () => {
    mockDrills.mockResolvedValueOnce([{ ownerId: 'o-1', verifierId: 'v-1' }]);
    expect((await (await GET()).json()).drillPending).toBe(true);
    expect(mockDrills).toHaveBeenCalledWith(USER);
  });

  it('reduces the pending list to a boolean, exposing no owner ids', async () => {
    // The flag says "somebody is waiting". WHO is waiting is not this screen's
    // to disclose, and the raw rows carry other owners' ids.
    mockDrills.mockResolvedValueOnce([
      { ownerId: 'o-1', verifierId: 'v-1' },
      { ownerId: 'o-2', verifierId: 'v-2' },
    ]);
    const body = await (await GET()).json();
    expect(body.drillPending).toBe(true);
    expect(JSON.stringify(body)).not.toContain('o-2');
  });
});

describe('what it refuses', () => {
  it('refuses without a session and reads nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockDrills).not.toHaveBeenCalled();
  });

  it('maps an integrity failure to 403 rather than a 500', async () => {
    mockResolve.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('maps a malformed identifier to 400, not to a 500', async () => {
    mockResolve.mockRejectedValueOnce(
      Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }),
    );
    const res = await GET();
    expect(res.status).toBe(400);
    // The driver's text embeds the offending value; reflecting caller input
    // back is how probes get confirmed.
    expect(JSON.stringify(await res.json())).not.toContain('invalid input syntax');
  });

  it('lets an unrecognised failure propagate instead of swallowing it', async () => {
    // `mapError` re-throws what it does not recognise, on purpose. A database
    // outage must surface as a failure the framework reports — turning it into
    // a calm 200 with an empty resolution would tell a contact they are on
    // standby for nobody, which is the false green this codebase keeps finding.
    mockDrills.mockRejectedValueOnce(new Error('relation "verifiers" does not exist'));
    await expect(GET()).rejects.toThrow('relation "verifiers" does not exist');
  });
});
