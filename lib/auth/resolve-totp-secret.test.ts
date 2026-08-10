/**
 * Tests for per-user TOTP secret resolution.
 *
 * Closes the shared-secret vulnerability: before this, every owner
 * authenticated against process.env.TOTP_SECRET, so any user could mint a valid
 * second factor for any other account. Resolution now prefers the owner's own
 * users.totp_secret and falls back to the env secret ONLY for accounts that
 * predate signup (totp_secret IS NULL).
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  it('falls back to the env secret for a pre-signup account with NULL totp_secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);

    await expect(resolveTotpSecret('legacy@b.com')).resolves.toBe(ENV_SECRET);
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
    delete process.env.TOTP_SECRET;
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
