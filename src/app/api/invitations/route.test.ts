/**
 * Tests for POST /api/invitations.
 *
 * WHY THIS FILE EXISTS. 0% statements and 0% branches on 2026-08-22, on the
 * route that `ratified.outbound-mail-bounds` names as the audit's TOP finding:
 * "the product was an open mail relay for anyone who signed up". Signup is
 * self-serve, this handler sends a real message per call, and the sender is a
 * Resend account SHARED with another project — so the reputation cost of abuse
 * lands somewhere else, which is what moved it from tidy-up to top finding.
 *
 * The ruling put TWO ceilings in front of it and they are not redundant. The
 * burst limit here is per-instance process memory; the durable one is a
 * 24-hour count read from `audit_log` inside `inviteAndNotify`, reserved there
 * rather than at the route because THREE callers reach the send. A test that
 * only exercised the route's own limiter would report the weaker of the two as
 * the bound, so both refusals are asserted here, and both as 429 with a
 * `Retry-After` — a 500 or a bare 429 gives a client nothing to back off with.
 *
 * The second property is one the response makes and no other route does:
 * `claimCode` comes back to the OWNER in the body. Only a hash is persisted, so
 * this response is the one and only moment the token is readable, and the owner
 * reading it out by voice is the channel this architecture actually trusts. A
 * refusal must therefore mint nothing — a claim code returned on a request that
 * then failed is a live credential nobody has a record of.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../lib/people/invite', () => ({ inviteAndNotify: vi.fn() }));
vi.mock('../../../../lib/db/integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/db/integrity')>();
  return { ...actual, assertOwns: vi.fn() };
});

import { getOwnerSession } from '../../../../lib/auth/session';
import { assertOwns, IntegrityError } from '../../../../lib/db/integrity';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { inviteAndNotify } from '../../../../lib/people/invite';
import {
  InviteBudgetError,
  INVITE_EMAIL_BURST_LIMIT,
} from '../../../../lib/notify/invite-budget';
import { _resetRateLimitForTesting } from '../../../../lib/http/rate-limit';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockAssertOwns = vi.mocked(assertOwns);
const mockAudit = vi.mocked(writeAuditEntry);
const mockInvite = vi.mocked(inviteAndNotify);

const OWNER = 'owner-1';
const PERSON = 'recipient-1';

function makeReq(body: unknown) {
  return { method: 'POST', headers: new Headers(), json: async () => body } as never;
}

const INVITE_RESULT = {
  claimUrl: 'https://relaystandby.com/claim/abc',
  expiresAt: '2026-08-29T00:00:00.000Z',
  emailDelivered: true,
  claimCode: 'TIDE-RIVER-STONE',
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTesting();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockAssertOwns.mockResolvedValue(undefined as never);
  mockInvite.mockResolvedValue(INVITE_RESULT as never);
});

describe('POST /api/invitations — issuing one', () => {
  it('invites, audits, and returns the claim code exactly once', async () => {
    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      ...INVITE_RESULT,
      deliveryChannel: 'email',
    });
    expect(mockInvite).toHaveBeenCalledWith(OWNER, PERSON, 'recipient', 'email');
    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ action: 'invitation_created', entityId: PERSON }),
    );
  });

  it('records the delivery channel, defaulting anything unrecognised to email', async () => {
    // "an invitation with no channel cannot be attributed to an arm, and every
    // invitation the product issued carried none until 2026-08-12" — so the
    // value must always be one of the two, never absent and never passed
    // through raw.
    for (const [sent, expected] of [
      ['owner', 'owner'],
      ['email', 'email'],
      [undefined, 'email'],
      ['carrier-pigeon', 'email'],
      [42, 'email'],
    ] as const) {
      mockInvite.mockClear();
      const res = await POST(
        makeReq({ personId: PERSON, personType: 'recipient', deliveryChannel: sent }),
      );
      expect(mockInvite).toHaveBeenCalledWith(OWNER, PERSON, 'recipient', expected);
      await expect(res.json()).resolves.toMatchObject({ deliveryChannel: expected });
    }
  });

  it('audits a verifier invitation against the verifier entity', async () => {
    await POST(makeReq({ personId: 'verifier-1', personType: 'verifier' }));
    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ entity: 'verifier', entityId: 'verifier-1' }),
    );
  });

  it('reports an undelivered email rather than claiming success', async () => {
    // The claim URL and code are still returned — the owner can read the code
    // out — but `emailDelivered: false` is the only thing that lets the screen
    // say so. Collapsing this to a 500 would lose a usable invitation.
    mockInvite.mockResolvedValueOnce({ ...INVITE_RESULT, emailDelivered: false } as never);

    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ emailDelivered: false });
  });
});

describe('POST /api/invitations — the two ceilings', () => {
  it('refuses a burst past the per-instance limit with 429 and a Retry-After', async () => {
    for (let i = 0; i < INVITE_EMAIL_BURST_LIMIT; i++) {
      expect((await POST(makeReq({ personId: PERSON, personType: 'recipient' }))).status).toBe(201);
    }

    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    await expect(res.json()).resolves.toMatchObject({ error: 'TooManyRequests' });
  });

  it('spends the burst budget before the body is read, so a malformed post is not free', async () => {
    for (let i = 0; i < INVITE_EMAIL_BURST_LIMIT; i++) await POST(makeReq({}));
    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    expect(res.status).toBe(429);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  /*
    The durable ceiling. It is reserved INSIDE inviteAndNotify because three
    callers reach the send, so from here it arrives as a thrown
    InviteBudgetError — and it must surface as a 429 carrying the error's own
    retry hint, not as a 500. A 500 here would read as an outage and invite a
    retry loop against the exact limit being enforced.
  */
  it('surfaces the 24-hour ceiling as 429 with the error’s own Retry-After', async () => {
    mockInvite.mockRejectedValueOnce(
      new InviteBudgetError('You have sent as many invitations as Relay allows today.', 3600),
    );

    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    await expect(res.json()).resolves.toMatchObject({ error: 'TooManyRequests' });
    // Nothing was sent, so nothing may be recorded as sent.
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('meters per owner — a second owner starts with a full burst budget', async () => {
    for (let i = 0; i < INVITE_EMAIL_BURST_LIMIT; i++) {
      await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    }
    expect((await POST(makeReq({ personId: PERSON, personType: 'recipient' }))).status).toBe(429);

    mockSession.mockResolvedValue({ ownerId: 'owner-2' } as never);
    expect((await POST(makeReq({ personId: PERSON, personType: 'recipient' }))).status).toBe(201);
  });
});

describe('POST /api/invitations — refusals mint nothing', () => {
  it.each([
    ['a missing personId', { personType: 'recipient' }, 'personId'],
    ['a non-string personId', { personId: 7, personType: 'recipient' }, 'personId'],
    ['a missing personType', { personId: PERSON }, 'personType'],
    ['an unknown personType', { personId: PERSON, personType: 'neighbour' }, 'personType'],
    ['a null body', null, 'personId'],
  ])('refuses %s with 400 and sends no mail', async (_label, body, field) => {
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'ValidationError', field });
    expect(mockInvite).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('checks the person belongs to this owner before sending anything', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'not yours'));

    const res = await POST(makeReq({ personId: 'someone-elses', personType: 'recipient' }));

    expect(res.status).toBe(403);
    // The open-mail-relay finding in one assertion: without this, an attacker
    // names any address as a "person" and Relay emits SPF/DKIM-valid mail to it.
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('looks the person up in the table their type names', async () => {
    await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'recipients', PERSON);

    mockAssertOwns.mockClear();
    await POST(makeReq({ personId: 'v-1', personType: 'verifier' }));
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'verifiers', 'v-1');
  });

  it('refuses an unauthenticated caller before spending any budget', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeReq({ personId: PERSON, personType: 'recipient' }));
    expect(res.status).toBe(401);
    expect(mockInvite).not.toHaveBeenCalled();
  });
});
