/**
 * Tests for lib/auth/recipient-token.ts
 *
 * Validates: Requirements 15.2, 17.2
 *
 * Feature: relay-h0-mvp
 *
 * Migrated to async 2026-08-08 with the jose swap. jose v6 is WebCrypto-backed
 * and Promise-only, so `issue`/`verify` became async and every call site here
 * had to move with them. The edits are mechanical on purpose — call shape only.
 * Not one assertion, message, vector, secret or clock mechanism changed, which
 * is what lets this file testify that the new implementation behaves like the
 * old one rather than merely describing itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { issueRecipientToken, verifyRecipientToken, RecipientTokenPayload } from './recipient-token';

// ---------------------------------------------------------------------------
// Test setup — inject a known RECIPIENT_JWT_SECRET for all tests
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-secret-at-least-32-characters-long-for-hs256';

beforeEach(() => {
  process.env.RECIPIENT_JWT_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.RECIPIENT_JWT_SECRET;
});

// ---------------------------------------------------------------------------
// issueRecipientToken — unit tests
// ---------------------------------------------------------------------------

describe('issueRecipientToken', () => {
  it('returns a compact JWS string with three segments', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  it('header declares alg=HS256 and typ=JWT', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const [headerEncoded] = token.split('.');
    const header = JSON.parse(Buffer.from(headerEncoded, 'base64url').toString('utf8'));
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('payload contains the expected claims', async () => {
    const recipientId = 'bf5a3e92-1234-4cfa-bacd-000000000001';
    const releaseStateId = 'a1b2c3d4-5678-4def-9876-000000000002';
    const version = 7n;

    const token = await issueRecipientToken(recipientId, releaseStateId, version);
    const [, payloadEncoded] = token.split('.');
    const payload: RecipientTokenPayload = JSON.parse(
      Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
    );

    expect(payload.recipientId).toBe(recipientId);
    expect(payload.releaseStateId).toBe(releaseStateId);
    expect(payload.version).toBe('7'); // bigint serialised as decimal string
  });

  it('sets iat to approximately current time (within 2 seconds)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const after = Math.floor(Date.now() / 1000);

    const [, payloadEncoded] = token.split('.');
    const { iat } = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));

    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(after + 1);
  });

  it('sets exp to iat + 24 hours', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const [, payloadEncoded] = token.split('.');
    const { iat, exp } = JSON.parse(
      Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
    );
    expect(exp).toBe(iat + 24 * 60 * 60);
  });

  it('serialises bigint version correctly for version 0', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const [, payloadEncoded] = token.split('.');
    const { version } = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
    expect(version).toBe('0');
  });

  it('serialises large bigint version without precision loss', async () => {
    const largeVersion = 9999999999999999999n;
    const token = await issueRecipientToken('rec-1', 'rs-1', largeVersion);
    const [, payloadEncoded] = token.split('.');
    const { version } = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
    expect(version).toBe('9999999999999999999');
  });

  it('throws when RECIPIENT_JWT_SECRET is not set', async () => {
    delete process.env.RECIPIENT_JWT_SECRET;
    await expect(issueRecipientToken('rec-1', 'rs-1', 0n)).rejects.toThrow(
      'RECIPIENT_JWT_SECRET',
    );
  });

  it('throws when RECIPIENT_JWT_SECRET is empty string', async () => {
    process.env.RECIPIENT_JWT_SECRET = '';
    await expect(issueRecipientToken('rec-1', 'rs-1', 0n)).rejects.toThrow(
      'RECIPIENT_JWT_SECRET',
    );
  });
});

// ---------------------------------------------------------------------------
// verifyRecipientToken — unit tests (valid token path)
// ---------------------------------------------------------------------------

describe('verifyRecipientToken — valid token', () => {
  it('returns the payload for a freshly issued token', async () => {
    const recipientId = 'rec-uuid-001';
    const releaseStateId = 'rs-uuid-002';
    const version = 3n;

    const token = await issueRecipientToken(recipientId, releaseStateId, version);
    const payload = await verifyRecipientToken(token);

    expect(payload.recipientId).toBe(recipientId);
    expect(payload.releaseStateId).toBe(releaseStateId);
    expect(payload.version).toBe('3');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('round-trips issueRecipientToken → verifyRecipientToken for version 0', async () => {
    const token = await issueRecipientToken('rec-a', 'rs-b', 0n);
    const payload = await verifyRecipientToken(token);
    expect(payload.version).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// verifyRecipientToken — rejection cases
// ---------------------------------------------------------------------------

describe('verifyRecipientToken — invalid inputs', () => {
  it('throws on a token with only two segments', async () => {
    await expect(verifyRecipientToken('header.payload')).rejects.toThrow(
      'three dot-separated segments',
    );
  });

  it('throws on a token with four segments', async () => {
    await expect(verifyRecipientToken('a.b.c.d')).rejects.toThrow(
      'three dot-separated segments',
    );
  });

  it('throws on an empty string', async () => {
    await expect(verifyRecipientToken('')).rejects.toThrow();
  });

  it('throws when the signature is tampered', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const [h, p] = token.split('.');
    const tamperedToken = `${h}.${p}.invalidsignatureXXXX`;
    await expect(verifyRecipientToken(tamperedToken)).rejects.toThrow(
      'signature verification failed',
    );
  });

  it('throws when the payload is tampered (signature mismatch)', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    const [h, , s] = token.split('.');
    // Replace payload with a different one
    const fakePayload = Buffer.from(
      JSON.stringify({ recipientId: 'attacker', releaseStateId: 'rs-1', version: '0', iat: 0, exp: 9999999999 }),
    ).toString('base64url');
    await expect(verifyRecipientToken(`${h}.${fakePayload}.${s}`)).rejects.toThrow(
      'signature verification failed',
    );
  });

  it('throws when the header specifies a different algorithm', async () => {
    // Build a manually crafted token with alg: RS256 but signed with HMAC
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({ recipientId: 'rec', releaseStateId: 'rs', version: '0', iat: 0, exp: 9999999999 }),
    ).toString('base64url');
    // Signature won't matter because alg check comes first
    const token = `${fakeHeader}.${payload}.fakesig`;
    await expect(verifyRecipientToken(token)).rejects.toThrow('unsupported algorithm');
  });

  it('throws for an expired token', async () => {
    // Mock Date.now to return a time 25 hours in the future during verification
    const realDateNow = Date.now.bind(global.Date);
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);

    // Advance time 25 hours
    vi.spyOn(global.Date, 'now').mockReturnValue(realDateNow() + 25 * 60 * 60 * 1000);
    try {
      await expect(verifyRecipientToken(token)).rejects.toThrow('expired');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('throws when issued with a different secret', async () => {
    const token = await issueRecipientToken('rec-1', 'rs-1', 0n);
    // Switch secret before verification
    process.env.RECIPIENT_JWT_SECRET = 'a-completely-different-secret-that-wont-match';
    await expect(verifyRecipientToken(token)).rejects.toThrow('signature verification failed');
  });

  it('throws on a token with a non-base64url header', async () => {
    await expect(verifyRecipientToken('not!!!valid.payload.sig')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// **Validates: Requirements 15.2, 17.2**
// Feature: relay-h0-mvp
// ---------------------------------------------------------------------------

describe('recipient-token — property tests', () => {
  /**
   * Property: issue → verify round-trip preserves all payload claims
   * For any valid recipientId, releaseStateId, and version, the verified
   * payload must exactly match what was issued.
   */
  it('property: issue→verify round-trip preserves all claims', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),                    // recipientId
        fc.uuid(),                    // releaseStateId
        fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }), // version
        async (recipientId, releaseStateId, version) => {
          const token = await issueRecipientToken(recipientId, releaseStateId, version);
          const payload = await verifyRecipientToken(token);

          return (
            payload.recipientId === recipientId &&
            payload.releaseStateId === releaseStateId &&
            payload.version === version.toString(10)
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property: exp is always iat + 24 hours (86400 seconds) — Requirement 17.2
   */
  it('property: exp is always iat + 86400 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.bigInt({ min: 0n, max: 999n }),
        async (recipientId, releaseStateId, version) => {
          const token = await issueRecipientToken(recipientId, releaseStateId, version);
          const [, payloadEncoded] = token.split('.');
          const { iat, exp } = JSON.parse(
            Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
          );
          return exp === iat + 86400;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: version bigint is always serialised as a decimal string
   * without scientific notation or precision loss — Requirement 15.2
   */
  it('property: version is serialised as a plain decimal string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: 2n ** 53n }), // range that could trigger float precision issues
        async (version) => {
          const token = await issueRecipientToken('rec', 'rs', version);
          const [, payloadEncoded] = token.split('.');
          const { version: versionStr } = JSON.parse(
            Buffer.from(payloadEncoded, 'base64url').toString('utf8'),
          );
          // Must be a plain decimal string — no 'e', no dots
          return (
            typeof versionStr === 'string' &&
            /^\d+$/.test(versionStr) &&
            BigInt(versionStr) === version
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property: a tampered payload always fails verification
   * For any valid token, appending or changing any byte in the payload
   * segment must cause verifyRecipientToken to throw.
   */
  it('property: any modification to a valid token causes verification to fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.bigInt({ min: 0n, max: 100n }),
        // A non-empty string to append to the payload segment
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Za-z0-9]+$/.test(s)),
        async (recipientId, releaseStateId, version, extraBytes) => {
          const token = await issueRecipientToken(recipientId, releaseStateId, version);
          const [h, p, s] = token.split('.');
          const tamperedToken = `${h}.${p}${extraBytes}.${s}`;

          let threw = false;
          try {
            await verifyRecipientToken(tamperedToken);
          } catch {
            threw = true;
          }
          return threw;
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property: tokens issued with different secrets are always invalid
   * under a different secret — Requirement 17.2 (scoped tokens)
   */
  it('property: tokens from one secret are always rejected by a different secret', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.bigInt({ min: 0n, max: 100n }),
        // Two distinct non-empty secrets
        fc.tuple(
          fc.string({ minLength: 8, maxLength: 32 }),
          fc.string({ minLength: 8, maxLength: 32 }),
        ).filter(([a, b]) => a !== b),
        async (recipientId, releaseStateId, version, [secretA, secretB]) => {
          process.env.RECIPIENT_JWT_SECRET = secretA;
          const token = await issueRecipientToken(recipientId, releaseStateId, version);

          process.env.RECIPIENT_JWT_SECRET = secretB;
          let threw = false;
          try {
            await verifyRecipientToken(token);
          } catch {
            threw = true;
          }
          // Restore
          process.env.RECIPIENT_JWT_SECRET = TEST_SECRET;
          return threw;
        },
      ),
      { numRuns: 100 },
    );
  });
});
