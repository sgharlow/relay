/**
 * Starting passkey enrolment — stage two of the claim.
 *
 * This handler executed no test until 2026-08-30.
 *
 * 🔴 THE CHALLENGE IS SEALED WITH A PURPOSE AND AN OWNER. `sealChallenge(c,
 * 'registration', userId)` is what stops a token minted on the SIGN-IN path being
 * spent here — the two endpoints mint structurally similar objects and only the
 * purpose claim separates them. The attribution is the other half and it is
 * asymmetric on purpose: registration always knows who is asking, sign-in
 * deliberately does not.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../../lib/auth/webauthn', () => ({
  beginRegistration: vi.fn(),
  sealChallenge: vi.fn(async () => 'sealed.jwt.token'),
}));
vi.mock('../../../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { beginRegistration, sealChallenge } from '../../../../../../lib/auth/webauthn';
import { query } from '../../../../../../lib/db/connection';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockBegin = vi.mocked(beginRegistration);
const mockSeal = vi.mocked(sealChallenge);
const mockQuery = vi.mocked(query);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const EMAIL = 'owner@example.com';
const OPTIONS = { rp: { name: 'Relay' }, challenge: 'Y2hhbGxlbmdl' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockQuery.mockResolvedValue({ rows: [{ email: EMAIL }] } as never);
  mockBegin.mockResolvedValue({ options: OPTIONS, challenge: 'raw-challenge' } as never);
  mockSeal.mockResolvedValue('sealed.jwt.token' as never);
});

describe('starting enrolment', () => {
  it('begins registration for the session owner and their account email', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockBegin).toHaveBeenCalledWith({ id: OWNER, email: EMAIL });
  });

  it('reads the email against the session id alone', async () => {
    await POST();
    expect(mockQuery.mock.calls[0][1]).toEqual([OWNER]);
  });

  it('seals the challenge for REGISTRATION and attributes it to the user', async () => {
    // Both arguments matter. Without the purpose, a sign-in token would be
    // spendable here; without the attribution, the nonce row would not name who
    // is enrolling.
    await POST();
    expect(mockSeal).toHaveBeenCalledWith('raw-challenge', 'registration', OWNER);
  });

  it('returns the options and the sealed token to the client', async () => {
    // The seal goes to the CALLER rather than into a cookie — deliberate, and
    // safe because it is signed and short-lived.
    expect(await (await POST()).json()).toEqual({
      options: OPTIONS,
      challengeToken: 'sealed.jwt.token',
    });
  });
});

describe('what it refuses', () => {
  it('refuses without a session and mints no challenge', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSeal).not.toHaveBeenCalled();
  });

  it('refuses when the session names an account that no longer exists', async () => {
    // A deleted account holding a live session must not be able to enrol a new
    // way back in.
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST();
    expect(res.status).toBe(404);
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockSeal).not.toHaveBeenCalled();
  });

  it('maps an integrity failure rather than leaking it', async () => {
    mockBegin.mockRejectedValueOnce(
      Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }),
    );
    const res = await POST();
    expect(res.status).toBe(400);
  });
});
