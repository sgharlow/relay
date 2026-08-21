/**
 * The four sign-in doors, executed rather than read.
 *
 * 🔴 WHY THIS FILE EXISTS AT ALL. Until 2026-08-21 this module was 1% covered:
 * no `authorize` and no callback was ever executed by a test. Its only guard was
 * `lib/ops/signin-is-throttled.test.ts`, which `readFileSync`s the source,
 * strips the comments and asserts that certain substrings appear in a certain
 * ORDER. That is a real ratchet against someone deleting the budget check, and
 * it is worth keeping — but it cannot tell whether the code it is reading works.
 * A textual assertion about `checkSigninAllowed(` passes just as happily when
 * the call is inside a branch that never runs.
 *
 * The proof that it mattered: the standby-claim and break-glass providers took
 * `existingUserId` straight off the POST body and handed it to the claim as the
 * resulting identity, so a caller with any valid unclaimed code could name a
 * user id and be issued a session AS that person. The textual guard was green
 * throughout. The first test below is the one that would have caught it.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextAuthOptions } from 'next-auth';

vi.mock('./totp', () => ({ validateTotpCodeFor: vi.fn() }));
vi.mock('./resolve-totp-secret', () => ({ resolveTotpSecret: vi.fn() }));
vi.mock('./upsert-user', () => ({ upsertUser: vi.fn() }));
vi.mock('./webauthn', () => ({ openChallenge: vi.fn(), finishAuthentication: vi.fn() }));
vi.mock('../people/claim', () => ({ claimStandbyRole: vi.fn() }));
vi.mock('../people/break-glass', () => ({ redeemBreakGlass: vi.fn() }));
vi.mock('./session-epoch', () => ({ readSessionEpoch: vi.fn(), isSessionCurrent: vi.fn() }));
vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./signin-throttle', () => ({
  checkSigninAllowed: vi.fn(),
  recordSigninFailure: vi.fn(),
  clearSigninFailures: vi.fn(),
}));
vi.mock('../ops/guess-watch', () => ({ recordCodeMiss: vi.fn() }));
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));

import { getToken } from 'next-auth/jwt';

import { authOptions } from './auth-options';
import { validateTotpCodeFor } from './totp';
import { resolveTotpSecret } from './resolve-totp-secret';
import { upsertUser } from './upsert-user';
import { openChallenge, finishAuthentication } from './webauthn';
import { claimStandbyRole } from '../people/claim';
import { redeemBreakGlass } from '../people/break-glass';
import { readSessionEpoch, isSessionCurrent } from './session-epoch';
import { query } from '../db/connection';
import {
  checkSigninAllowed,
  recordSigninFailure,
  clearSigninFailures,
} from './signin-throttle';
import { recordCodeMiss } from '../ops/guess-watch';

const mockGetToken = vi.mocked(getToken);
const mockValidate = vi.mocked(validateTotpCodeFor);
const mockResolve = vi.mocked(resolveTotpSecret);
const mockUpsert = vi.mocked(upsertUser);
const mockOpenChallenge = vi.mocked(openChallenge);
const mockFinishAuth = vi.mocked(finishAuthentication);
const mockClaim = vi.mocked(claimStandbyRole);
const mockBreakGlass = vi.mocked(redeemBreakGlass);
const mockEpoch = vi.mocked(readSessionEpoch);
const mockCurrent = vi.mocked(isSessionCurrent);
const mockQuery = vi.mocked(query);
const mockGate = vi.mocked(checkSigninAllowed);
const mockRecordFailure = vi.mocked(recordSigninFailure);
const mockClear = vi.mocked(clearSigninFailures);
const mockCodeMiss = vi.mocked(recordCodeMiss);

const rows = (r: unknown[]) =>
  ({ rows: r, rowCount: r.length, command: '', oid: 0, fields: [] }) as never;

/** The shape NextAuth v4 hands `authorize`: query/body/headers/method, no cookies. */
type AuthorizeReq = Parameters<
  NonNullable<Extract<NextAuthOptions['providers'][number], { authorize?: unknown }>['authorize']>
>[1];
const req = (headers: Record<string, string> = {}) =>
  ({ query: {}, body: {}, headers, method: 'POST' }) as unknown as AuthorizeReq;

/**
 * ⚠️ THE REAL `authorize` IS NOT ON THE PROVIDER OBJECT. `CredentialsProvider`
 * in next-auth v4 returns `{ id: 'credentials', …, authorize: () => null,
 * options }` — everything the caller passed is nested under `options` and is
 * merged over the defaults later, by `parseProviders` at init. So reaching for
 * `authOptions.providers[i].authorize` finds the STUB that always returns null:
 * every assertion below would pass against a provider that had been deleted.
 * Resolve through `options`, and fail loudly if the shape ever changes.
 */
type ProviderShape = {
  options?: {
    id?: string;
    authorize?: (
      credentials: Record<string, string> | undefined,
      request: AuthorizeReq,
    ) => Promise<{ id: string; email: string } | null>;
  };
};

function providerNamed(id: string) {
  const p = authOptions.providers.find((x) => (x as ProviderShape).options?.id === id) as
    | ProviderShape
    | undefined;
  const authorize = p?.options?.authorize;
  if (!authorize) throw new Error(`no provider ${id} with an authorize()`);
  return { id, authorize };
}

const userRow = { id: 'u-1', email: 'owner@example.com', is_demo_account: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGate.mockResolvedValue({ allowed: true } as never);
  mockGetToken.mockResolvedValue(null as never);
  // A cookie that opens belongs to a live session unless a test says otherwise.
  mockCurrent.mockResolvedValue(true);
  mockQuery.mockResolvedValue(rows([userRow]));
});

// ---------------------------------------------------------------------------
// The takeover
// ---------------------------------------------------------------------------

describe('a client cannot assert who it is', () => {
  const victim = '00000000-0000-4000-8000-000000000victim'.slice(0, 36);

  it('standby-claim ignores an existingUserId posted in the body', async () => {
    mockClaim.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: false,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ', existingUserId: victim },
      req(),
    );

    expect(mockClaim).toHaveBeenCalledWith({ token: 'ABCDE-FGHIJ', existingUserId: undefined });
  });

  it('break-glass ignores an existingUserId posted in the body', async () => {
    mockBreakGlass.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: false,
    } as never);

    await providerNamed('break-glass').authorize(
      { code: 'ABCD2345EFGH', existingUserId: victim },
      req(),
    );

    expect(mockBreakGlass).toHaveBeenCalledWith({
      code: 'ABCD2345EFGH',
      existingUserId: undefined,
    });
  });

  it('takes the link identity from the session cookie instead — §3.7 rule 2', async () => {
    mockGetToken.mockResolvedValue({ ownerId: 'signed-in-1' } as never);
    mockClaim.mockResolvedValue({
      userId: 'signed-in-1',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: true,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ', existingUserId: victim },
      req({ cookie: '__Secure-next-auth.session-token=abc.def' }),
    );

    expect(mockClaim).toHaveBeenCalledWith({
      token: 'ABCDE-FGHIJ',
      existingUserId: 'signed-in-1',
    });
    // Read with the name that actually arrived, not one guessed from the env.
    expect(mockGetToken).toHaveBeenCalledWith(
      expect.objectContaining({ cookieName: '__Secure-next-auth.session-token' }),
    );
  });

  /*
    🔴 A COOKIE THAT OPENS IS NOT A SESSION THAT IS STILL GOOD, and the first fix
    here stopped at "opens". `callerUserId` decoded the JWE and returned
    `ownerId ?? sub` with nothing consulted afterwards, while every other reader
    of a Relay session goes through `getOwnerSession`, which also asks
    `isSessionCurrent` — the revocation lever built after the 2026-08-12
    incident, where a DELETED user's cookie was answered 200.

    So the takeover survived in the one dimension the fix claimed to close.
    Hold a stolen cookie; the owner presses "sign out everywhere" and the epoch
    is bumped; POST any valid unclaimed invitation to the claim callback with
    that dead cookie. `callerUserId` still returned the victim's id, the roster
    row bound to it, and the `jwt` callback below stamps a FRESH `sessionEpoch`
    read live from the database — laundering a revoked cookie into a current
    session. A code to spend is obtainable by signing up and inviting yourself.
  */
  it('a REVOKED session cookie claims as a NEW identity — sign-out-everywhere is honoured here too', async () => {
    mockGetToken.mockResolvedValue({ ownerId: 'signed-in-1', sessionEpoch: 3 } as never);
    mockCurrent.mockResolvedValue(false); // The owner has since bumped the epoch.
    mockClaim.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: false,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ' },
      req({ cookie: 'next-auth.session-token=stolen' }),
    );

    expect(mockCurrent).toHaveBeenCalledWith('signed-in-1', 3);
    expect(mockClaim).toHaveBeenCalledWith({ token: 'ABCDE-FGHIJ', existingUserId: undefined });
  });

  // break-glass is the sharper of the two: it had no session-derived caller at
  // all before 2026-08-21, and it is redeemed mid-emergency, disproportionately
  // on a device somebody else was last signed in on.
  it('break-glass honours the revocation too', async () => {
    mockGetToken.mockResolvedValue({ ownerId: 'signed-in-1', sessionEpoch: 0 } as never);
    mockCurrent.mockResolvedValue(false);
    mockBreakGlass.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'verifier',
      linkedExisting: false,
    } as never);

    await providerNamed('break-glass').authorize(
      { code: 'ABCD2345EFGH' },
      req({ cookie: 'next-auth.session-token=stolen' }),
    );

    expect(mockBreakGlass).toHaveBeenCalledWith({
      code: 'ABCD2345EFGH',
      existingUserId: undefined,
    });
  });

  /*
    The other direction, and it is not decoration: a check that refuses
    everything would pass the two tests above while breaking §3.7 rule 2 for
    every legitimate multi-hat claimant — which mints the second `users` row
    that severs every standby link they hold.
  */
  it('a session minted BEFORE the epoch shipped still links, rather than being refused', async () => {
    mockGetToken.mockResolvedValue({ ownerId: 'signed-in-1' } as never); // no sessionEpoch
    mockCurrent.mockResolvedValue(true);
    mockClaim.mockResolvedValue({
      userId: 'signed-in-1',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: true,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ' },
      req({ cookie: 'next-auth.session-token=old' }),
    );

    expect(mockCurrent).toHaveBeenCalledWith('signed-in-1', undefined);
    expect(mockClaim).toHaveBeenCalledWith({
      token: 'ABCDE-FGHIJ',
      existingUserId: 'signed-in-1',
    });
  });

  /*
    The revocation read is a DATABASE call, so it can fail — and the direction it
    fails in is the whole argument of `callerUserId`'s header. A blip must not be
    able to hand the claim an identity it could not verify.
  */
  it('a revocation lookup that throws claims as a NEW identity, not as the cookie', async () => {
    mockGetToken.mockResolvedValue({ ownerId: 'signed-in-1', sessionEpoch: 1 } as never);
    mockCurrent.mockRejectedValue(new Error('DSQL unreachable'));
    mockClaim.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: false,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ' },
      req({ cookie: 'next-auth.session-token=fine' }),
    );

    expect(mockClaim).toHaveBeenCalledWith({ token: 'ABCDE-FGHIJ', existingUserId: undefined });
  });

  it('a session cookie that cannot be opened claims as a NEW identity, never someone else', async () => {
    mockGetToken.mockRejectedValue(new Error('decryption failed'));
    mockClaim.mockResolvedValue({
      userId: 'u-new',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'verifier',
      linkedExisting: false,
    });

    await providerNamed('standby-claim').authorize(
      { token: 'ABCDE-FGHIJ', existingUserId: victim },
      req({ cookie: 'next-auth.session-token=broken' }),
    );

    expect(mockClaim).toHaveBeenCalledWith({ token: 'ABCDE-FGHIJ', existingUserId: undefined });
  });
});

// ---------------------------------------------------------------------------
// email + TOTP — the order the textual ratchet can only assert as text
// ---------------------------------------------------------------------------

describe('email-totp authorize', () => {
  const creds = { email: ' Owner@Example.com ', totpCode: ' 123456 ' };

  it('refuses with no credentials and asks the database nothing', async () => {
    expect(await providerNamed('email-totp').authorize({ email: '' }, req())).toBeNull();
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('a refused budget costs no lookup — the door is checked before the query', async () => {
    mockGate.mockResolvedValue({ allowed: false, refusedBy: 'email' } as never);

    expect(await providerNamed('email-totp').authorize(creds, req())).toBeNull();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('buckets by the left-most x-forwarded-for entry, and null when there is none', async () => {
    mockResolve.mockResolvedValue(null);
    await providerNamed('email-totp').authorize(
      creds,
      req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
    );
    expect(mockGate).toHaveBeenCalledWith('owner@example.com', '203.0.113.7');

    vi.clearAllMocks();
    mockGate.mockResolvedValue({ allowed: true } as never);
    mockResolve.mockResolvedValue(null);
    await providerNamed('email-totp').authorize(creds, req());
    expect(mockGate).toHaveBeenCalledWith('owner@example.com', null);
  });

  it('a lookup failure is OURS: it returns null and does NOT spend the budget', async () => {
    mockResolve.mockRejectedValue(new Error('DSQL unreachable'));

    expect(await providerNamed('email-totp').authorize(creds, req())).toBeNull();
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockCodeMiss).not.toHaveBeenCalled();
  });

  it('an unknown address and a wrong code are the same null, and both are counted', async () => {
    mockResolve.mockResolvedValue(null);
    expect(await providerNamed('email-totp').authorize(creds, req())).toBeNull();
    expect(mockRecordFailure).toHaveBeenCalledWith('owner@example.com');
    expect(mockCodeMiss).toHaveBeenCalledWith('totp');

    vi.clearAllMocks();
    mockGate.mockResolvedValue({ allowed: true } as never);
    mockResolve.mockResolvedValue('SECRET');
    mockValidate.mockReturnValue(false);
    expect(await providerNamed('email-totp').authorize(creds, req())).toBeNull();
    expect(mockRecordFailure).toHaveBeenCalledWith('owner@example.com');
    expect(mockCodeMiss).toHaveBeenCalledWith('totp');
  });

  it('a right code clears the budget BEFORE the upsert, so our failure cannot spend theirs', async () => {
    mockResolve.mockResolvedValue('SECRET');
    mockValidate.mockReturnValue(true);
    mockUpsert.mockRejectedValue(new Error('DB down'));

    expect(await providerNamed('email-totp').authorize(creds, req())).toBeNull();
    expect(mockClear).toHaveBeenCalledWith('owner@example.com');
  });

  it('a valid code upserts on the credentials auth_sub and returns the owner', async () => {
    mockResolve.mockResolvedValue('SECRET');
    mockValidate.mockReturnValue(true);
    mockUpsert.mockResolvedValue({
      id: 'u-1',
      email: 'owner@example.com',
      is_demo_account: false,
    } as never);

    const user = await providerNamed('email-totp').authorize(creds, req());
    expect(mockValidate).toHaveBeenCalledWith('SECRET', '123456');
    expect(mockUpsert).toHaveBeenCalledWith('credentials:owner@example.com', 'owner@example.com');
    expect(user).toMatchObject({ id: 'u-1', ownerId: 'u-1', isDemo: false });
  });
});

// ---------------------------------------------------------------------------
// The other three doors return the same null for every reason
// ---------------------------------------------------------------------------

describe('uniform refusals', () => {
  it('standby-claim: a rejected code and an unknown user id are indistinguishable', async () => {
    mockClaim.mockRejectedValue(new Error('that code is not valid'));
    expect(await providerNamed('standby-claim').authorize({ token: 'X' }, req())).toBeNull();

    mockClaim.mockResolvedValue({
      userId: 'ghost',
      ownerId: 'o-1',
      personId: 'p-1',
      personType: 'recipient',
      linkedExisting: false,
    });
    mockQuery.mockResolvedValue(rows([]));
    expect(await providerNamed('standby-claim').authorize({ token: 'X' }, req())).toBeNull();
  });

  it('break-glass: a rejected code returns null', async () => {
    mockBreakGlass.mockRejectedValue(new Error('spent'));
    expect(await providerNamed('break-glass').authorize({ code: 'X' }, req())).toBeNull();
  });

  it('passkey: a sealed challenge for the wrong purpose returns null', async () => {
    mockOpenChallenge.mockRejectedValue(new Error('purpose mismatch'));
    expect(
      await providerNamed('passkey').authorize({ response: '{}', challengeToken: 't' }, req()),
    ).toBeNull();
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it('passkey: a valid assertion resolves the user row it names', async () => {
    mockOpenChallenge.mockResolvedValue('challenge');
    mockFinishAuth.mockResolvedValue({ userId: 'u-1' } as never);

    const user = await providerNamed('passkey').authorize(
      { response: '{"id":"cred"}', challengeToken: 't' },
      req(),
    );
    expect(mockOpenChallenge).toHaveBeenCalledWith('t', 'authentication');
    expect(user).toMatchObject({ id: 'u-1', ownerId: 'u-1' });
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe('jwt and session callbacks', () => {
  it('stamps the session epoch once, at sign-in', async () => {
    mockEpoch.mockResolvedValue(7);
    const jwt = authOptions.callbacks!.jwt!;
    const token = await jwt({
      token: {},
      user: { id: 'u-1', ownerId: 'u-1', isDemo: false },
    } as never);
    expect(token).toMatchObject({ ownerId: 'u-1', sub: 'u-1', sessionEpoch: 7 });
  });

  it('treats an unreadable epoch as 0 rather than leaving it absent', async () => {
    mockEpoch.mockResolvedValue(null);
    const jwt = authOptions.callbacks!.jwt!;
    const token = await jwt({
      token: {},
      user: { id: 'u-1', ownerId: 'u-1', isDemo: true },
    } as never);
    expect(token).toMatchObject({ sessionEpoch: 0, isDemo: true });
  });

  it('copies ownerId onto the session for getOwnerSession to read', async () => {
    const session = authOptions.callbacks!.session!;
    const out = (await session({
      session: {},
      token: { ownerId: 'u-1', isDemo: false, sessionEpoch: 3 },
    } as never)) as unknown as Record<string, unknown>;
    expect(out.ownerId).toBe('u-1');
    expect(out.isDemo).toBe(false);
  });
});
