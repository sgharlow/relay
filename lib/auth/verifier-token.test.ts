/**
 * Tests for lib/auth/verifier-token.ts
 *
 * Validates: Requirements 6.3, 17.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { issueVerifierToken, verifyVerifierToken } from './verifier-token';

beforeEach(() => {
  process.env.VERIFIER_JWT_SECRET = 'test-verifier-secret';
});
afterEach(() => {
  delete process.env.VERIFIER_JWT_SECRET;
});

describe('verifier token', () => {
  it('round-trips verifierId + releaseStateId', () => {
    const token = issueVerifierToken('v-1', 'rs-1');
    const payload = verifyVerifierToken(token);
    expect(payload.verifierId).toBe('v-1');
    expect(payload.releaseStateId).toBe('rs-1');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a tampered payload', () => {
    const token = issueVerifierToken('v-1', 'rs-1');
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ verifierId: 'v-2', releaseStateId: 'rs-1', iat: 0, exp: 9_999_999_999 })).toString('base64url');
    expect(() => verifyVerifierToken(`${h}.${forged}.${s}`)).toThrow(/signature/);
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueVerifierToken('v-1', 'rs-1');
    process.env.VERIFIER_JWT_SECRET = 'a-different-secret';
    expect(() => verifyVerifierToken(token)).toThrow(/signature/);
  });

  it('throws when the secret is not configured', () => {
    delete process.env.VERIFIER_JWT_SECRET;
    expect(() => issueVerifierToken('v-1', 'rs-1')).toThrow(/VERIFIER_JWT_SECRET/);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyVerifierToken('not.a.token.at.all')).toThrow();
    expect(() => verifyVerifierToken('only-one-part')).toThrow();
  });
});
