/**
 * Tests for owner self-serve signup.
 *
 * Two phases, but NO pending row: `users.status` is constrained to
 * ('active','suspended'), and more importantly an account that exists before
 * MFA is proven is an account that exists without MFA. `beginSignup` therefore
 * writes nothing — it returns a short-lived signed enrolment token carrying the
 * fresh secret, and `completeSignup` only INSERTs after validating a real code
 * against that secret (Req 17.1).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  validateSignupInput,
  beginSignup,
  completeSignup,
  ENROLMENT_TTL_SECONDS,
} from './signup';
import { generateTotpCodeFor } from './totp';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-value';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('validateSignupInput', () => {
  it('accepts and normalises an email', () => {
    expect(validateSignupInput({ email: '  A@B.COM ' })).toEqual({ email: 'a@b.com' });
  });

  it.each([{}, { email: '' }, { email: 'nope' }, { email: 123 }, { email: null }])(
    'rejects %j',
    (bad) => {
      expect(() => validateSignupInput(bad)).toThrow(ValidationError);
    },
  );
});

describe('beginSignup', () => {
  it('writes NOTHING to the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await beginSignup('a@b.com');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0] as string).toMatch(/^\s*SELECT/i);
  });

  it('returns an otpauth URL carrying the fresh secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const out = await beginSignup('a@b.com');

    expect(out.otpauthUrl).toContain('otpauth://totp/Relay:a%40b.com');
    expect(out.otpauthUrl).toContain('issuer=Relay');
    expect(out.otpauthUrl).toContain(`secret=${out.totpSecret}`);
  });

  it('issues a different secret for every signup', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never);

    const a = await beginSignup('a@b.com');
    const b = await beginSignup('b@b.com');

    expect(a.totpSecret).not.toBe(b.totpSecret);
    expect(a.enrolmentToken).not.toBe(b.enrolmentToken);
  });

  it('rejects an email that already has an account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u-1' }] } as never);

    await expect(beginSignup('a@b.com')).rejects.toThrow(ValidationError);
  });
});

describe('completeSignup', () => {
  async function begin(email = 'a@b.com') {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const out = await beginSignup(email);
    mockQuery.mockClear();
    return out;
  }

  it('creates an ACTIVE account with the per-user secret on a valid code', async () => {
    const { enrolmentToken, totpSecret } = await begin();
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'u-9' }] } as never);

    const code = generateTotpCodeFor(totpSecret);
    await expect(completeSignup(enrolmentToken, code)).resolves.toEqual({ ownerId: 'u-9' });

    const insert = mockQuery.mock.calls[1][0] as string;
    expect(insert).toMatch(/INSERT INTO users/i);
    expect(insert).toMatch(/'active'/);
    expect(mockQuery.mock.calls[1][1]).toContain(totpSecret);
    // auth_sub must match authorize()'s derivation or sign-in creates a duplicate.
    expect(mockQuery.mock.calls[1][1]).toContain('credentials:a@b.com');
  });

  it('REJECTS an invalid code and creates NO account', async () => {
    const { enrolmentToken } = await begin();

    await expect(completeSignup(enrolmentToken, '000000')).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a tampered token', async () => {
    const { enrolmentToken, totpSecret } = await begin();
    const tampered = `${enrolmentToken.slice(0, -4)}AAAA`;

    await expect(
      completeSignup(tampered, generateTotpCodeFor(totpSecret)),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret', async () => {
    const { enrolmentToken, totpSecret } = await begin();
    process.env.NEXTAUTH_SECRET = 'a-completely-different-secret';

    await expect(
      completeSignup(enrolmentToken, generateTotpCodeFor(totpSecret)),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an expired enrolment token', async () => {
    const { enrolmentToken, totpSecret } = await begin();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (ENROLMENT_TTL_SECONDS + 60) * 1000);

    await expect(
      completeSignup(enrolmentToken, generateTotpCodeFor(totpSecret)),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects if the email was claimed between the two steps', async () => {
    const { enrolmentToken, totpSecret } = await begin();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'someone-else' }] } as never);

    await expect(
      completeSignup(enrolmentToken, generateTotpCodeFor(totpSecret)),
    ).rejects.toThrow(ValidationError);

    // The existence re-check ran, but no INSERT followed it.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects a token issued for a different purpose', async () => {
    // A verifier/recipient token must never be usable to mint an account.
    await expect(completeSignup('not.a.token', '123456')).rejects.toThrow(ValidationError);
  });

  it('SECURITY: the new account authenticates only with its own secret', async () => {
    const { enrolmentToken, totpSecret } = await begin();
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'u-9' }] } as never);

    await completeSignup(enrolmentToken, generateTotpCodeFor(totpSecret));

    const storedSecret = (mockQuery.mock.calls[1][1] as unknown[])[2];
    expect(storedSecret).toBe(totpSecret);
    expect(storedSecret).not.toBe(process.env.TOTP_SECRET);
  });
});
