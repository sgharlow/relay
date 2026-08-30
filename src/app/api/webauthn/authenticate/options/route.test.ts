/**
 * Starting a passkey sign-in — deliberately unauthenticated, deliberately
 * identifier-free.
 *
 * This handler executed no test until 2026-08-30, and it is the one endpoint in
 * this directory whose value is what it does NOT do:
 *
 * 🔴 IT TAKES NO EMAIL, LOOKS NOTHING UP, AND RETURNS THE SAME SHAPE TO
 * EVERYONE. Discoverable credentials mean the browser offers the right passkey
 * and the person types nothing — which matters most for the contact who may act
 * once in five years. It also means there is no account to enumerate. A change
 * that "helpfully" accepted an email and narrowed the allowed credentials would
 * turn this into a membership oracle on an unauthenticated endpoint, and every
 * happy-path test would still pass.
 *
 * 🔴 THE SEAL CARRIES NO USER. Registration attributes its challenge; this must
 * not, because attributing it would mean knowing who is signing in before they
 * have proved anything. Asserted on the argument count, since an extra argument
 * is exactly how the asymmetry would be lost to a copy-paste.
 *
 * 🔴 IT IS RATE LIMITED BECAUSE SEALING NOW WRITES A ROW. Since migration 029
 * challenges are single-use nonces, so this unauthenticated endpoint performs a
 * write. The limit is not a security boundary and does not pretend to be one; it
 * bounds the write.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../../lib/auth/webauthn', () => ({
  beginAuthentication: vi.fn(),
  sealChallenge: vi.fn(async () => 'sealed.auth.token'),
}));
vi.mock('../../../../../../lib/http/rate-limit', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/rate-limit',
  );
  return { ...actual, rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) };
});

import { beginAuthentication, sealChallenge } from '../../../../../../lib/auth/webauthn';
import { rateLimit } from '../../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockBegin = vi.mocked(beginAuthentication);
const mockSeal = vi.mocked(sealChallenge);
const mockRateLimit = vi.mocked(rateLimit);

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', userVerification: 'preferred' };

function req(body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://relaystandby.com/api/webauthn/authenticate/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockBegin.mockResolvedValue({ options: OPTIONS, challenge: 'raw-auth-challenge' } as never);
  mockSeal.mockResolvedValue('sealed.auth.token' as never);
});

describe('it reveals nothing about who exists', () => {
  it('begins authentication with no arguments at all', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    // No identifier reaches the lookup, because there is no lookup.
    expect(mockBegin).toHaveBeenCalledWith();
  });

  it('answers identically whether or not an email is supplied', async () => {
    const anonymous = await POST(req());
    const anonBody = JSON.stringify(await anonymous.json());

    const withEmail = await POST(req({ email: 'someone@example.com' }));
    const emailBody = JSON.stringify(await withEmail.json());

    expect(withEmail.status).toBe(anonymous.status);
    expect(emailBody).toBe(anonBody);
    // And the address was not consulted on the way past.
    expect(mockBegin).toHaveBeenCalledWith();
    expect(mockSeal.mock.calls.every((c) => c.length === 2)).toBe(true);
  });

  it('seals for AUTHENTICATION and attributes the challenge to nobody', async () => {
    await POST(req());
    expect(mockSeal).toHaveBeenCalledWith('raw-auth-challenge', 'authentication');
    // The asymmetry with registration, asserted where it would be lost.
    expect(mockSeal.mock.calls[0]).toHaveLength(2);
  });

  it('returns the options and the sealed token', async () => {
    expect(await (await POST(req())).json()).toEqual({
      options: OPTIONS,
      challengeToken: 'sealed.auth.token',
    });
  });
});

describe('the write is bounded', () => {
  it('refuses over the limit with a Retry-After and seals nothing', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    // The point: no nonce row is written for a refused request.
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockSeal).not.toHaveBeenCalled();
  });

  it('meters on a key scoped to this route', async () => {
    await POST(req());
    expect(String(mockRateLimit.mock.calls[0][0])).toMatch(/^webauthn-auth:/);
  });

  it('meters per client rather than globally', async () => {
    await POST(req(undefined, { 'x-forwarded-for': '203.0.113.9' }));
    expect(String(mockRateLimit.mock.calls[0][0])).toContain('203.0.113.9');
  });
});
