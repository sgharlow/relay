/**
 * Tests for the passkey layer.
 *
 * next-auth v4 on a JWT session with no DB adapter has no first-class passkey
 * provider, so this is WebAuthn implemented directly and handed to a credentials
 * provider. The library does the cryptography; everything tested here is the part
 * we own — where the challenge lives, what gets stored, and what comes back out
 * of Postgres in the wrong type.
 *
 * Two traps have real teeth:
 *
 *   1. A challenge sealed for REGISTRATION must not be openable as an
 *      AUTHENTICATION challenge. Without a purpose claim, a challenge minted for
 *      an authenticated user setting up a passkey could be replayed into the
 *      sign-in path.
 *
 *   2. `counter` is BIGINT, and node-postgres returns BIGINT as a STRING. Passing
 *      it through unconverted hands the library a string where it expects a
 *      number, and the signature-counter check silently stops meaning anything.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'reg-challenge', rp: {} })),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyAuthenticationResponse: vi.fn(),
}));

import { query } from '../db/connection';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  rpConfig,
  sealChallenge,
  openChallenge,
  finishRegistration,
  finishAuthentication,
  CHALLENGE_TTL_SECONDS,
} from './webauthn';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  process.env.NEXTAUTH_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://relaystandby.com';
});

describe('rpConfig — the relying party is the origin, and must never be guessed', () => {
  it('derives the RP id from the host, not the whole URL', () => {
    const c = rpConfig();
    expect(c.rpID).toBe('relaystandby.com');
    expect(c.origin).toBe('https://relaystandby.com');
  });

  it('keeps the port in the origin but never in the RP id, so localhost works', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    const c = rpConfig();
    expect(c.rpID).toBe('localhost');
    expect(c.origin).toBe('http://localhost:3000');
  });
});

describe('challenge sealing — no new table, no cleanup job', () => {
  it('round-trips a challenge', async () => {
    const sealed = await sealChallenge('abc123', 'registration');
    await expect(openChallenge(sealed, 'registration')).resolves.toBe('abc123');
  });

  it('REFUSES a registration challenge presented to the authentication path', async () => {
    const sealed = await sealChallenge('abc123', 'registration');
    await expect(openChallenge(sealed, 'authentication')).rejects.toThrow();
  });

  it('refuses a garbage or tampered seal', async () => {
    await expect(openChallenge('not-a-jwt', 'registration')).rejects.toThrow();
  });

  it('is short-lived by construction', () => {
    expect(CHALLENGE_TTL_SECONDS).toBeLessThanOrEqual(600);
  });
});

describe('finishRegistration', () => {
  it('stores the public key base64url-encoded, with the counter the device reported', async () => {
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-abc',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 7,
          transports: ['internal'],
        },
      },
    } as never);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // insert

    const out = await finishRegistration({
      userId: 'user-1',
      response: {} as never,
      expectedChallenge: 'reg-challenge',
    });

    expect(out.credentialId).toBe('cred-abc');
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO webauthn_credentials');
    expect(params[1]).toBe('cred-abc');
    expect(params[2]).toBe(Buffer.from([1, 2, 3, 4]).toString('base64url'));
    expect(params[3]).toBe(7);
  });

  it('stores nothing when the attestation does not verify', async () => {
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({ verified: false } as never);

    await expect(
      finishRegistration({ userId: 'user-1', response: {} as never, expectedChallenge: 'c' }),
    ).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('finishAuthentication', () => {
  const STORED = {
    id: 'row-1',
    user_id: 'user-1',
    credential_id: 'cred-abc',
    public_key: Buffer.from([9, 9]).toString('base64url'),
    counter: '42', // node-postgres hands BIGINT back as a STRING
    transports: 'internal',
  };

  it('converts the BIGINT counter to a number before the library sees it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED], rowCount: 1 } as never);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 43 },
    } as never);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // counter bump

    const out = await finishAuthentication({
      response: { id: 'cred-abc' } as never,
      expectedChallenge: 'auth-challenge',
    });

    expect(out.userId).toBe('user-1');
    const passed = vi.mocked(verifyAuthenticationResponse).mock.calls[0][0] as {
      credential: { counter: number };
    };
    expect(passed.credential.counter).toBe(42);
    expect(typeof passed.credential.counter).toBe('number');
  });

  it('advances the stored counter, which is what makes a cloned key detectable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED], rowCount: 1 } as never);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 43 },
    } as never);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await finishAuthentication({ response: { id: 'cred-abc' } as never, expectedChallenge: 'c' });

    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE webauthn_credentials');
    expect(sql).toContain('counter');
    expect(params[0]).toBe(43);
  });

  it('refuses an unknown credential without calling the verifier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      finishAuthentication({ response: { id: 'nope' } as never, expectedChallenge: 'c' }),
    ).rejects.toThrow();
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('does not advance the counter when verification fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED], rowCount: 1 } as never);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false } as never);

    await expect(
      finishAuthentication({ response: { id: 'cred-abc' } as never, expectedChallenge: 'c' }),
    ).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledTimes(1); // the lookup only
  });
});
