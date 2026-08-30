/**
 * Redeeming an invitation — where a named contact becomes a person the system
 * knows, and the one route on which a stranger arrives holding only a token.
 *
 * This handler executed no test until 2026-08-30. The property with the worst
 * failure mode had nothing asserting it:
 *
 * 🔴 A VERIFIER MUST NEVER SEE VAULT SHAPE (R6.8). A recipient's response
 * carries `standby` — counts and categories of what they would one day reach. A
 * verifier holds no grant and gets a deliberately smaller object. Both branches
 * return `claimed: true` and HTTP 200, so a handler that fell through to the
 * recipient branch for a verifier would look identical to a working one from
 * every angle except the body — which is exactly why the assertions below read
 * the body and check for ABSENCE.
 *
 * 🔴 AN EXISTING SESSION LINKS, IT DOES NOT REPLACE (§3.7 rule 2). Somebody who
 * is already an owner, or already standing by for another family, must have this
 * claim added to who they are. Minting a new account would sever every standby
 * link they already hold — silently, at the moment they were trying to help.
 * `getOwnerSession` is allowed to reject and that is the NORMAL case, not an
 * error, so the `.catch(() => null)` is load-bearing and is asserted directly.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/people/invitations', () => ({
  buildStandbyView: vi.fn(),
}));
vi.mock('../../../../../lib/people/claim', () => ({
  claimStandbyRole: vi.fn(),
}));
vi.mock('../../../../../lib/auth/session', () => ({
  getOwnerSession: vi.fn(),
}));

import { buildStandbyView } from '../../../../../lib/people/invitations';
import { claimStandbyRole } from '../../../../../lib/people/claim';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { ValidationError } from '../../../../../lib/validation';
import { POST } from './route';

const mockView = vi.mocked(buildStandbyView);
const mockClaim = vi.mocked(claimStandbyRole);
const mockSession = vi.mocked(getOwnerSession);

const TOKEN = 'inv_5t7cptqn9wke';
const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const PERSON = 'b1b1b1b1-2222-4333-8444-555566667777';
const EXISTING = 'e5e5e5e5-2222-4333-8444-555566667777';

const STANDBY_VIEW = {
  totals: { items: 7 },
  byCategory: [{ category: 'finance', n: 3 }],
};

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/invitations/' + TOKEN, { method: 'POST' });
}
const ctx = { params: Promise.resolve({ token: TOKEN }) };

beforeEach(() => {
  vi.clearAllMocks();
  // The normal case: nobody is signed in. getOwnerSession REJECTS.
  mockSession.mockRejectedValue(new Error('no session'));
  mockClaim.mockResolvedValue({
    personType: 'recipient',
    ownerId: OWNER,
    personId: PERSON,
    linkedExisting: false,
  } as never);
  mockView.mockResolvedValue(STANDBY_VIEW as never);
});

describe('a recipient claims', () => {
  it('redeems the token from the path and returns the standby shape', async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith({ token: TOKEN, existingUserId: undefined });
    expect(await res.json()).toEqual({
      personType: 'recipient',
      claimed: true,
      linkedExisting: false,
      standby: STANDBY_VIEW,
    });
  });

  it('builds the view against the pair the CLAIM returned, not the request', async () => {
    await POST(req(), ctx);
    expect(mockView).toHaveBeenCalledWith(OWNER, PERSON);
  });
});

describe('a verifier claims', () => {
  beforeEach(() => {
    mockClaim.mockResolvedValue({
      personType: 'verifier',
      ownerId: OWNER,
      personId: PERSON,
      linkedExisting: false,
    } as never);
  });

  it('never builds a standby view for them', async () => {
    // R6.8. The cheapest possible guarantee: the function that computes vault
    // shape is not reached at all on this branch.
    await POST(req(), ctx);
    expect(mockView).not.toHaveBeenCalled();
  });

  it('returns a body carrying no vault shape', async () => {
    const body = await (await POST(req(), ctx)).json();
    expect(body).toEqual({ personType: 'verifier', claimed: true, linkedExisting: false });
    expect(body).not.toHaveProperty('standby');
    expect(JSON.stringify(body)).not.toContain('finance');
  });
});

describe('an existing person claims a second relationship', () => {
  it('links against the signed-in user rather than minting a new account', async () => {
    // §3.7 rule 2. Minting here would sever every standby link they hold.
    mockSession.mockResolvedValueOnce({ ownerId: EXISTING } as never);
    await POST(req(), ctx);
    expect(mockClaim).toHaveBeenCalledWith({ token: TOKEN, existingUserId: EXISTING });
  });

  it('reports linkedExisting so the screen can say what happened', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: EXISTING } as never);
    mockClaim.mockResolvedValueOnce({
      personType: 'recipient',
      ownerId: OWNER,
      personId: PERSON,
      linkedExisting: true,
    } as never);
    expect((await (await POST(req(), ctx)).json()).linkedExisting).toBe(true);
  });

  it('treats an absent session as normal, not as a failure', async () => {
    // getOwnerSession throws a 401 by design when nobody is signed in. If that
    // rejection escaped, no stranger could ever claim an invitation.
    mockSession.mockRejectedValueOnce(new Error('Unauthorized'));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith({ token: TOKEN, existingUserId: undefined });
  });
});

describe('what it refuses', () => {
  it('renders an expired, spent or unknown token as a 400 with no detail', async () => {
    // All three refusals are deliberately indistinguishable — they are filtered
    // in SQL so the row never reaches JS.
    mockClaim.mockRejectedValueOnce(new ValidationError('Invalid invitation', 'token'));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ValidationError', field: 'token' });
    expect(mockView).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure propagate rather than reporting a claim', async () => {
    // Returning `claimed: true` after a failed write is the worst available
    // answer here: the contact believes they are standing by and no row says so.
    mockClaim.mockRejectedValueOnce(new Error('DSQL unavailable'));
    await expect(POST(req(), ctx)).rejects.toThrow('DSQL unavailable');
  });
});
