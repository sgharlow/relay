/**
 * Elevation is bound, bounded, and withdrawable.
 *
 * The defect this closes (PROJECT.yaml `deferred:`
 * step-up-reauth-on-sensitive-actions): issuing recovery codes and exporting the
 * vault ran on the ordinary 24-hour session, so a walked-away-from machine
 * became permanent control or a full plaintext export.
 *
 * Four properties carry the whole guarantee, and each has a way of quietly
 * disappearing in a refactor:
 *   - bound to a SUBJECT, or a stolen cookie elevates a different account;
 *   - bound to a SESSION EPOCH, or "sign out everywhere" leaves a window open on
 *     the device somebody just declared compromised;
 *   - bound to a PURPOSE, or a passkey challenge is spendable as elevation;
 *   - backed by a ROW, or it cannot be withdrawn before it expires.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXTAUTH_SECRET = 'test-secret-for-step-up-tests-0123456789';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./session-epoch', () => ({ readSessionEpoch: vi.fn() }));
vi.mock('./challenge-store', () => ({
  newChallengeId: vi.fn(() => 'nonce-1'),
  recordChallenge: vi.fn(async () => {}),
  burnChallenge: vi.fn(async () => true),
  isChallengeLive: vi.fn(async () => true),
  revokeChallenges: vi.fn(async () => 1),
}));

import { SignJWT } from 'jose';
import { NextResponse } from 'next/server';

import { query } from '../db/connection';
import { readSessionEpoch } from './session-epoch';
import {
  newChallengeId,
  recordChallenge,
  burnChallenge,
  isChallengeLive,
  revokeChallenges,
} from './challenge-store';
import {
  mintStepUp,
  hasStepUp,
  spendStepUp,
  revokeStepUp,
  requireStepUp,
  requireStepUpOnce,
  readStepUpCookie,
  attachStepUp,
  clearStepUp,
  availableStepUpFactors,
  stepUpRequired,
  STEP_UP_COOKIE,
  STEP_UP_TTL_SECONDS,
} from './step-up';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const key = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET as string);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSessionEpoch).mockResolvedValue(0);
  vi.mocked(newChallengeId).mockReturnValue('nonce-1');
  vi.mocked(recordChallenge).mockResolvedValue(undefined);
  vi.mocked(burnChallenge).mockResolvedValue(true);
  vi.mocked(isChallengeLive).mockResolvedValue(true);
  vi.mocked(revokeChallenges).mockResolvedValue(1);
  // Default: an owner with a TOTP secret and no passkey.
  vi.mocked(query).mockImplementation((async (sql: string) =>
    /totp_secret/.test(sql) ? { rows: [{ totp_secret: 'ABC' }] } : { rows: [] }) as never);
});

/** A request double carrying (or not carrying) the elevation cookie. */
const reqWith = (token?: string) => ({
  cookies: { get: (n: string) => (n === STEP_UP_COOKIE && token ? { value: token } : undefined) },
});

describe('minting', () => {
  it('records a nonce before handing out a token', async () => {
    await mintStepUp({ userId: OWNER });
    expect(recordChallenge).toHaveBeenCalledWith({
      jti: 'nonce-1',
      purpose: 'step-up',
      ttlSeconds: STEP_UP_TTL_SECONDS,
      userId: OWNER,
    });
  });

  it('is bounded — five minutes, stated on the response', async () => {
    const before = Date.now();
    const grant = await mintStepUp({ userId: OWNER });
    const ms = new Date(grant.expiresAt).getTime() - before;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(STEP_UP_TTL_SECONDS * 1000 + 50);
  });

  /*
    Read here rather than threaded in from the caller, on purpose: an optional
    security parameter is one refactor from being dropped, and this one fails
    OPEN when dropped.
  */
  it('stamps the epoch itself rather than trusting a caller to pass it', async () => {
    vi.mocked(readSessionEpoch).mockResolvedValue(7);
    const { token } = await mintStepUp({ userId: OWNER });
    await expect(hasStepUp(token, OWNER)).resolves.toBe(true);

    vi.mocked(readSessionEpoch).mockResolvedValue(8);
    await expect(hasStepUp(token, OWNER)).resolves.toBe(false);
  });
});

describe('the four bindings', () => {
  it('elevates the subject it was minted for, and nobody else', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    await expect(hasStepUp(token, OWNER)).resolves.toBe(true);
    await expect(hasStepUp(token, OTHER)).resolves.toBe(false);
  });

  it('dies when the account signs out everywhere', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    vi.mocked(readSessionEpoch).mockResolvedValue(1); // bumped
    await expect(hasStepUp(token, OWNER)).resolves.toBe(false);
  });

  it('refuses elevation for an account that no longer exists', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    vi.mocked(readSessionEpoch).mockResolvedValue(null);
    await expect(hasStepUp(token, OWNER)).resolves.toBe(false);
  });

  it('refuses a token minted for a different purpose', async () => {
    const foreign = await new SignJWT({ purpose: 'authentication', epoch: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setJti('nonce-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key());
    await expect(hasStepUp(foreign, OWNER)).resolves.toBe(false);
  });

  it('refuses a forged or tampered token', async () => {
    const forged = await new SignJWT({ purpose: 'step-up', epoch: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setJti('nonce-1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-different-secret-entirely-0123456789'));
    await expect(hasStepUp(forged, OWNER)).resolves.toBe(false);
  });

  it('refuses an expired token', async () => {
    const stale = await new SignJWT({ purpose: 'step-up', epoch: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setJti('nonce-1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key());
    await expect(hasStepUp(stale, OWNER)).resolves.toBe(false);
  });

  it('refuses a missing cookie without touching the store', async () => {
    await expect(hasStepUp(undefined, OWNER)).resolves.toBe(false);
    expect(isChallengeLive).not.toHaveBeenCalled();
  });

  /*
    The signature is not the guarantee. A perfectly-signed, unexpired, correctly
    bound token whose ROW has been revoked must not elevate — that is the whole
    reason elevation is a row and not a claim.
  */
  it('refuses a valid token whose row has been revoked', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    vi.mocked(isChallengeLive).mockResolvedValue(false);
    await expect(hasStepUp(token, OWNER)).resolves.toBe(false);
  });
});

describe('spending', () => {
  it('checking does not consume, spending does', async () => {
    const { token } = await mintStepUp({ userId: OWNER });

    await hasStepUp(token, OWNER);
    expect(burnChallenge).not.toHaveBeenCalled();

    await spendStepUp(token, OWNER);
    expect(burnChallenge).toHaveBeenCalledWith('nonce-1', 'step-up');
  });

  it('a second spend of the same grant fails', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    vi.mocked(burnChallenge).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(spendStepUp(token, OWNER)).resolves.toBe(true);
    await expect(spendStepUp(token, OWNER)).resolves.toBe(false);
  });

  it('revoking ends every grant this user holds', async () => {
    await revokeStepUp(OWNER);
    expect(revokeChallenges).toHaveBeenCalledWith(OWNER, 'step-up');
  });
});

describe('the route guards', () => {
  it('403 with StepUpRequired, never 401 — the session is valid', async () => {
    const res = stepUpRequired();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpRequired' });
  });

  it('lets an elevated request through', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    await expect(requireStepUp(reqWith(token), OWNER)).resolves.toBeNull();
  });

  it('refuses an unelevated request from an account that HAS a factor', async () => {
    const out = await requireStepUp(reqWith(undefined), OWNER);
    expect(out?.status).toBe(403);
  });

  it('the irreversible guard consumes the elevation it accepted', async () => {
    const { token } = await mintStepUp({ userId: OWNER });
    await expect(requireStepUpOnce(reqWith(token), OWNER)).resolves.toBeNull();
    expect(burnChallenge).toHaveBeenCalledWith('nonce-1', 'step-up');
  });

  /*
    A guard nobody can satisfy is a lockout. A contact who claimed a standby role
    holds neither factor — no TOTP secret, and passkeys are stage two and
    deferrable — and the privacy page promises anybody can close their account.
  */
  it('stands down for an account that holds no re-presentable factor', async () => {
    vi.mocked(query).mockImplementation((async () => ({ rows: [] })) as never);
    await expect(requireStepUp(reqWith(undefined), OWNER)).resolves.toBeNull();
    await expect(requireStepUpOnce(reqWith(undefined), OWNER)).resolves.toBeNull();
  });

  it('engages the moment that account registers a passkey', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      /webauthn_credentials/.test(sql) ? { rows: [{ one: 1 }] } : { rows: [{}] }) as never);
    const out = await requireStepUp(reqWith(undefined), OWNER);
    expect(out?.status).toBe(403);
  });

  it('demands elevation rather than waiving it when the factor list is unreadable', async () => {
    vi.mocked(query).mockRejectedValue(new Error('DSQL unavailable'));
    const out = await requireStepUp(reqWith(undefined), OWNER);
    expect(out?.status).toBe(403);
  });
});

describe('the cookie', () => {
  it('is httpOnly, same-site strict, and expires with the window', () => {
    const res = attachStepUp(NextResponse.json({ ok: true }), 'tok');
    const set = res.cookies.get(STEP_UP_COOKIE);
    expect(set?.value).toBe('tok');
    expect(set?.httpOnly).toBe(true);
    expect(set?.sameSite).toBe('strict');
    expect(set?.maxAge).toBe(STEP_UP_TTL_SECONDS);
  });

  it('clears to an immediate expiry', () => {
    const res = clearStepUp(NextResponse.json({ ok: true }));
    expect(res.cookies.get(STEP_UP_COOKIE)?.maxAge).toBe(0);
  });

  it('reads nothing from a request that has no cookie jar', () => {
    expect(readStepUpCookie({})).toBeUndefined();
    expect(readStepUpCookie(reqWith(undefined))).toBeUndefined();
    expect(readStepUpCookie(reqWith('abc'))).toBe('abc');
  });
});

describe('which factors the prompt can offer', () => {
  it('reports TOTP for an owner and passkey for anyone who registered one', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      /webauthn_credentials/.test(sql)
        ? { rows: [{ one: 1 }] }
        : { rows: [{ totp_secret: 'ABC' }] }) as never);
    await expect(availableStepUpFactors(OWNER)).resolves.toEqual({ totp: true, passkey: true });
  });

  it('reports neither for a freshly-claimed standby contact', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      /webauthn_credentials/.test(sql) ? { rows: [] } : { rows: [{ totp_secret: null }] }) as never);
    await expect(availableStepUpFactors(OWNER)).resolves.toEqual({ totp: false, passkey: false });
  });
});
