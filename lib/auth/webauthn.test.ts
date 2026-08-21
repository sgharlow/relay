/**
 * Tests for the passkey layer.
 *
 * next-auth v4 on a JWT session with no DB adapter has no first-class passkey
 * provider, so this is WebAuthn implemented directly and handed to a credentials
 * provider. The library does the cryptography; everything tested here is the part
 * we own — where the challenge lives, what gets stored, and what comes back out
 * of Postgres in the wrong type.
 *
 * Three traps have real teeth:
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
 *   3. 🔴 A SEAL IS NOT SINGLE-USE BY BEING SIGNED. Until 2026-08-15 the seal was
 *      a stateless five-minute JWT and nothing burned it, so a captured assertion
 *      could be replayed for the rest of the window. The signature proves WE
 *      minted it and says nothing about whether it has been spent. Only the nonce
 *      row can say "once".
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./challenge-store', () => ({
  newChallengeId: vi.fn(() => 'nonce-1'),
  recordChallenge: vi.fn(async () => {}),
  burnChallenge: vi.fn(async () => true),
}));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'reg-challenge', rp: {} })),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyAuthenticationResponse: vi.fn(),
}));

import { query } from '../db/connection';
import { newChallengeId, recordChallenge, burnChallenge } from './challenge-store';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  rpConfig,
  sealChallenge,
  openChallenge,
  listCredentialIdsForUser,
  beginRegistration,
  beginAuthentication,
  finishRegistration,
  finishAuthentication,
  CHALLENGE_TTL_SECONDS,
} from './webauthn';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  vi.mocked(newChallengeId).mockReturnValue('nonce-1');
  vi.mocked(recordChallenge).mockResolvedValue(undefined);
  vi.mocked(burnChallenge).mockResolvedValue(true);
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

describe('challenge sealing — signed, purposed, and single-use', () => {
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

  it('records the nonce before the token exists', async () => {
    await sealChallenge('abc123', 'registration', 'user-1');
    expect(recordChallenge).toHaveBeenCalledWith({
      jti: 'nonce-1',
      purpose: 'registration',
      ttlSeconds: CHALLENGE_TTL_SECONDS,
      userId: 'user-1',
    });
  });

  /*
    Sign-in is deliberately identifier-free — the options endpoint takes no email
    and looks nothing up — so there is nobody to attribute its nonce to.
  */
  it('records an unattributed nonce for identifier-free sign-in', async () => {
    await sealChallenge('abc123', 'authentication');
    expect(vi.mocked(recordChallenge).mock.calls[0][0].userId).toBeUndefined();
  });

  it('does not hand out a seal whose nonce could not be recorded', async () => {
    vi.mocked(recordChallenge).mockRejectedValueOnce(new Error('DSQL unavailable'));
    await expect(sealChallenge('abc123', 'registration')).rejects.toThrow();
  });

  /*
    🔴 THE REPLAY. This is the defect the nonce store closes: the same valid,
    unexpired, correctly-purposed seal presented twice.
  */
  it('REFUSES the same seal a second time', async () => {
    const sealed = await sealChallenge('abc123', 'authentication');
    vi.mocked(burnChallenge).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(openChallenge(sealed, 'authentication')).resolves.toBe('abc123');
    await expect(openChallenge(sealed, 'authentication')).rejects.toThrow();
  });

  it('spends the nonce against the purpose it is being opened as', async () => {
    const sealed = await sealChallenge('abc123', 'authentication');
    await openChallenge(sealed, 'authentication');
    expect(burnChallenge).toHaveBeenCalledWith('nonce-1', 'authentication');
  });

  /*
    An unburnable nonce and a replayed one are the same refusal from outside. A
    message that told them apart would tell somebody whether their captured
    assertion was fresh.
  */
  it('refuses without saying whether the nonce was spent or unreachable', async () => {
    const sealed = await sealChallenge('abc123', 'authentication');
    vi.mocked(burnChallenge).mockResolvedValue(false);
    await expect(openChallenge(sealed, 'authentication')).rejects.toThrow(
      /expired or was already used/,
    );
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

/**
 * 🔴 THE HALF OF THE PASSKEY LAYER NO TEST EXECUTED (found 2026-08-21).
 *
 * `finishRegistration` and `finishAuthentication` were covered from the start —
 * they are where the cryptography and the BIGINT trap live. The three functions
 * that OPEN each ceremony were not: `listCredentialIdsForUser`,
 * `beginRegistration`, `beginAuthentication`. Their only callers are the three
 * `/api/webauthn/*` option routes, none of which has a route test either, so the
 * inputs the browser is handed came from nothing that runs.
 *
 * Both option shapes are load-bearing rather than cosmetic. `excludeCredentials`
 * is what stops a person who already registered this device meeting an opaque
 * "InvalidStateError" dead end, and `residentKey: 'preferred'` is what makes the
 * credential DISCOVERABLE — which is the entire [A1] stage-two promise that a
 * contact who acts once in five years types nothing at all. An empty
 * `allowCredentials` on the sign-in side is the same promise from the other end:
 * naming credentials there would both require knowing who is signing in and
 * disclose which ones exist.
 */
describe('beginRegistration — the options the browser is handed', () => {
  it('excludes the passkeys this user already has, so a re-register is not a dead end', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ credential_id: 'cred-a' }, { credential_id: 'cred-b' }],
      rowCount: 2,
    } as never);

    await beginRegistration({ id: 'u-1', email: 'owner@example.com' });

    const opts = vi.mocked(generateRegistrationOptions).mock.calls[0][0];
    expect(opts.excludeCredentials).toEqual([{ id: 'cred-a' }, { id: 'cred-b' }]);
    expect(opts.rpID).toBe('relaystandby.com');
  });

  it('asks for a DISCOVERABLE credential — the whole of "types nothing at all"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await beginRegistration({ id: 'u-1', email: 'owner@example.com' });

    const opts = vi.mocked(generateRegistrationOptions).mock.calls[0][0];
    expect(opts.authenticatorSelection?.residentKey).toBe('preferred');
    // 'preferred', not 'required': a contact holding a device that cannot do
    // user verification must still be able to enrol at all.
    expect(opts.authenticatorSelection?.userVerification).toBe('preferred');
  });

  it('returns the same challenge it puts in the options — one value, not two', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const { options, challenge } = await beginRegistration({ id: 'u-1', email: 'a@b.com' });
    expect(challenge).toBe(options.challenge);
  });

  it('names the user by their address, which is what the passkey manager shows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await beginRegistration({ id: 'u-1', email: 'owner@example.com' });

    const opts = vi.mocked(generateRegistrationOptions).mock.calls[0][0];
    expect(opts.userName).toBe('owner@example.com');
    expect(opts.userDisplayName).toBe('owner@example.com');
  });
});

describe('beginAuthentication — and what it deliberately does NOT say', () => {
  it('names no credentials, so the sign-in page discloses nothing about who exists', async () => {
    const { options, challenge } = await beginAuthentication();

    const opts = vi.mocked(generateAuthenticationOptions).mock.calls[0][0];
    expect(opts.allowCredentials).toBeUndefined();
    expect(opts.rpID).toBe('relaystandby.com');
    expect(challenge).toBe(options.challenge);
  });

  it('asks the database nothing — there is no identifier to look anything up by', async () => {
    await beginAuthentication();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('listCredentialIdsForUser', () => {
  it('is scoped to the one user, and returns bare ids', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ credential_id: 'cred-a' }],
      rowCount: 1,
    } as never);

    expect(await listCredentialIdsForUser('u-1')).toEqual(['cred-a']);
    expect(String(mockQuery.mock.calls[0][0])).toContain('user_id = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1']);
  });

  it('returns an empty list rather than throwing for a user with none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    expect(await listCredentialIdsForUser('u-2')).toEqual([]);
  });
});
