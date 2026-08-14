/**
 * Tests for per-user TOTP secret resolution.
 *
 * Closes the shared-secret vulnerability in two goes, both recorded because the
 * second only happened because the first left a door open and described it as
 * shut.
 *
 * FIRST: every owner authenticated against process.env.TOTP_SECRET, so any user
 * could mint a valid second factor for any other account. Resolution began
 * preferring the owner's own users.totp_secret, keeping the env secret as a
 * fallback said to be "ONLY for accounts that predate signup".
 *
 * SECOND (2026-08-13): that description was wrong. The fallback applied to any
 * NULL secret, and only signup ever writes one — so it covered every contact
 * account in the product, permanently. The fallback is now gone entirely.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { resolveTotpSecret } from './resolve-totp-secret';

const mockQuery = vi.mocked(query);

const ENV_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOTP_SECRET = ENV_SECRET;
});

afterEach(() => {
  delete process.env.TOTP_SECRET;
});

describe('resolveTotpSecret', () => {
  it('returns the per-user secret when the account has one', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ totp_secret: 'MFRGGZDFMZTWQ2LKNNWG23TP' }],
    } as never);

    await expect(resolveTotpSecret('a@b.com')).resolves.toBe('MFRGGZDFMZTWQ2LKNNWG23TP');
  });

  it('never consults the env secret when a per-user secret exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: 'PERUSERSECRET234567' }] } as never);

    const out = await resolveTotpSecret('a@b.com');
    expect(out).not.toBe(ENV_SECRET);
  });

  /*
    🔴 THIS TEST USED TO ASSERT THE OPPOSITE, and the assertion was the bug's
    alibi — the suite was green the whole time a shared master key covered every
    contact account.

    The fallback was described as covering "accounts that predate self-serve
    signup". It covered any row with a NULL secret, and NOTHING writes one except
    signup: `upsertUser` — used by claim, break-glass and the seed — leaves it
    NULL forever. So the covered population was every standby contact, growing
    with the beta, and `TOTP_SECRET` was enough to sign in as any of them given
    only an email address. Five of the six production accounts resolved that way
    on 2026-08-13.
  */
  it('refuses an account with no secret of its own, rather than using a shared one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);

    await expect(resolveTotpSecret('contact@b.com')).resolves.toBeNull();
  });

  it('cannot be re-opened by setting the old environment variable', async () => {
    // The variable may well still be set in a deployment. It must no longer mean
    // anything — a retired secret that a stray env var revives is not retired.
    process.env.TOTP_SECRET = ENV_SECRET;
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);

    await expect(resolveTotpSecret('contact@b.com')).resolves.toBeNull();
  });

  it('reads no shared secret from the environment at all', () => {
    // Asserted on the SOURCE, because the behavioural tests above can only prove
    // the branches they happen to exercise.
    const src = readFileSync('lib/auth/resolve-totp-secret.ts', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    );
    expect(src).not.toContain('process.env');
  });

  /*
    An unknown address and a known address with no own-secret must be
    indistinguishable, or sign-in becomes an account-enumeration oracle. Both
    return null; this pins that they still agree now that one branch has changed.
  */
  it('answers an unknown address exactly as it answers a secretless one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const unknown = await resolveTotpSecret('nobody@b.com');

    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);
    const secretless = await resolveTotpSecret('contact@b.com');

    expect(unknown).toBe(secretless);
  });

  // The env fallback exists for accounts that PREDATE self-serve signup, which
  // by definition have a row. Extending it to an email with no row at all had
  // two consequences, both live on production until 2026-08-09:
  //
  //  1. Sign-in answered differently for a registered address than for an
  //     unregistered one, which is an account-enumeration oracle on a product
  //     whose signup rate limiter was deliberately built so that "a refused
  //     request never reveals whether the email has an account".
  //  2. Anyone holding the shared env secret could authenticate as an arbitrary
  //     NEW address, and `authorize` upserts on success — so the sign-in page
  //     doubled as an unmetered account-creation path.
  it('returns null for an email with no account, instead of the env secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await expect(resolveTotpSecret('nobody@b.com')).resolves.toBeNull();
  });

  it('returns null rather than throwing when no secret is available anywhere', async () => {
    // Throwing is what leaked: NextAuth reflects the message into
    // /api/auth/error?error=..., so the exception text itself became the tell.
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);

    await expect(resolveTotpSecret('legacy@b.com')).resolves.toBeNull();
  });

  it('looks the account up by normalised email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: 'S234567' }] } as never);

    await resolveTotpSecret('  A@B.COM  ');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM users/i);
    expect(params?.[0]).toBe('a@b.com');
  });

  it('two different accounts resolve to two different secrets', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ totp_secret: 'AAAAAAAAAAAAAAAA' }] } as never)
      .mockResolvedValueOnce({ rows: [{ totp_secret: 'BBBBBBBBBBBBBBBB' }] } as never);

    const a = await resolveTotpSecret('alice@b.com');
    const b = await resolveTotpSecret('bob@b.com');

    expect(a).not.toBe(b);
  });
});
