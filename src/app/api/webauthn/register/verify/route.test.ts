/**
 * Finishing passkey enrolment.
 *
 * This handler executed no test until 2026-08-30. Two properties carried the
 * weight and neither was held:
 *
 * 🔴 THE CHALLENGE IS OPENED WITH `purpose: 'registration'`. `openChallenge`
 * BURNS the nonce, so a captured assertion cannot be replayed inside its
 * five-minute window — and the purpose argument is what stops a token minted on
 * the sign-in path being spent to enrol a credential. Passing the wrong purpose
 * string, or omitting it, would let one path's token open the other's door while
 * every test asserting `registered: true` stayed green.
 *
 * 🔴 A BAD SIGNATURE AND AN EXPIRED SEAL MUST BE INDISTINGUISHABLE. They arrive
 * as jose errors rather than ValidationErrors, and the handler collapses both
 * into one message. Telling a caller WHICH of the two failed is the difference
 * between "try again" and an oracle for whether a forged token was well-formed.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../../lib/auth/webauthn', () => ({
  finishRegistration: vi.fn(),
  openChallenge: vi.fn(),
}));

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { finishRegistration, openChallenge } from '../../../../../../lib/auth/webauthn';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockFinish = vi.mocked(finishRegistration);
const mockOpen = vi.mocked(openChallenge);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const TOKEN = 'sealed.jwt.token';
const ATTESTATION = { id: 'cred-abc', rawId: 'cred-abc', response: {}, type: 'public-key' };

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/webauthn/register/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockOpen.mockResolvedValue('raw-challenge' as never);
  mockFinish.mockResolvedValue({ credentialId: 'cred-abc' } as never);
});

describe('finishing enrolment', () => {
  it('opens the challenge for REGISTRATION, never any other purpose', async () => {
    const res = await POST(req({ response: ATTESTATION, challengeToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(mockOpen).toHaveBeenCalledWith(TOKEN, 'registration');
  });

  it('registers against the SESSION user, not one named in the body', async () => {
    await POST(req({ response: ATTESTATION, challengeToken: TOKEN, userId: 'somebody-else' }));
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, expectedChallenge: 'raw-challenge' }),
    );
  });

  it('opens the challenge BEFORE finishing, so a spent nonce stops the write', async () => {
    const order: string[] = [];
    mockOpen.mockImplementationOnce(async () => { order.push('openChallenge'); return 'raw-challenge' as never; });
    mockFinish.mockImplementationOnce(async () => { order.push('finishRegistration'); return { credentialId: 'c' } as never; });
    await POST(req({ response: ATTESTATION, challengeToken: TOKEN }));
    expect(order).toEqual(['openChallenge', 'finishRegistration']);
  });

  it('passes an optional label through and omits a non-string one', async () => {
    await POST(req({ response: ATTESTATION, challengeToken: TOKEN, label: 'Work laptop' }));
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ label: 'Work laptop' }));

    vi.clearAllMocks();
    mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
    mockOpen.mockResolvedValue('raw-challenge' as never);
    mockFinish.mockResolvedValue({ credentialId: 'cred-abc' } as never);
    await POST(req({ response: ATTESTATION, challengeToken: TOKEN, label: { evil: true } }));
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ label: undefined }));
  });

  it('returns the credential id that was registered', async () => {
    expect(await (await POST(req({ response: ATTESTATION, challengeToken: TOKEN }))).json()).toEqual({
      registered: true,
      credentialId: 'cred-abc',
    });
  });
});

describe('what it refuses', () => {
  it('refuses without a session', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req({ response: ATTESTATION, challengeToken: TOKEN }));
    expect(res.status).toBe(401);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('refuses a missing challenge token without opening anything', async () => {
    const res = await POST(req({ response: ATTESTATION }));
    expect(res.status).toBe(400);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('refuses a non-string challenge token', async () => {
    const res = await POST(req({ response: ATTESTATION, challengeToken: 123 }));
    expect(res.status).toBe(400);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('refuses a missing or non-object response', async () => {
    for (const bad of [undefined, 'a-string', 0]) {
      vi.clearAllMocks();
      mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
      const res = await POST(req({ response: bad, challengeToken: TOKEN }));
      expect(res.status).toBe(400);
      expect(mockFinish).not.toHaveBeenCalled();
    }
  });

  it('collapses a forged signature and an expired seal into one message', async () => {
    const forged = await POST(req({ response: ATTESTATION, challengeToken: 'forged' }));
    // Both branches produce the same body. Assert by comparing them.
    mockOpen.mockRejectedValueOnce(new Error('signature verification failed'));
    const a = await POST(req({ response: ATTESTATION, challengeToken: 'forged' }));
    mockOpen.mockRejectedValueOnce(new Error('"exp" claim timestamp check failed'));
    const b = await POST(req({ response: ATTESTATION, challengeToken: 'stale' }));

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(JSON.stringify(await a.json())).toBe(JSON.stringify(await b.json()));
    expect(forged.status).toBeGreaterThanOrEqual(200);
  });

  it('does not register when the challenge cannot be opened', async () => {
    mockOpen.mockRejectedValueOnce(new Error('jwt malformed'));
    const res = await POST(req({ response: ATTESTATION, challengeToken: 'nope' }));
    expect(res.status).toBe(400);
    expect(mockFinish).not.toHaveBeenCalled();
  });
});
