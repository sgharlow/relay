/**
 * Tests for lib/auth/verifier-token.ts
 *
 * Validates: Requirements 6.3, 17.2
 *
 * Migrated to async 2026-08-08 with the jose swap: jose v6 is WebCrypto-backed
 * and Promise-only, so the module's public interface had to change with it.
 * Only the call shape moved — every assertion, message and vector below is
 * unchanged, which is what makes them a compatibility harness rather than a
 * restatement of the new implementation.
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
  it('round-trips verifierId + releaseStateId', async () => {
    const token = await issueVerifierToken('v-1', 'rs-1');
    const payload = await verifyVerifierToken(token);
    expect(payload.verifierId).toBe('v-1');
    expect(payload.releaseStateId).toBe('rs-1');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a tampered payload', async () => {
    const token = await issueVerifierToken('v-1', 'rs-1');
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ verifierId: 'v-2', releaseStateId: 'rs-1', iat: 0, exp: 9_999_999_999 })).toString('base64url');
    await expect(verifyVerifierToken(`${h}.${forged}.${s}`)).rejects.toThrow(/signature/);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await issueVerifierToken('v-1', 'rs-1');
    process.env.VERIFIER_JWT_SECRET = 'a-different-secret';
    await expect(verifyVerifierToken(token)).rejects.toThrow(/signature/);
  });

  it('throws when the secret is not configured', async () => {
    delete process.env.VERIFIER_JWT_SECRET;
    await expect(issueVerifierToken('v-1', 'rs-1')).rejects.toThrow(/VERIFIER_JWT_SECRET/);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyVerifierToken('not.a.token.at.all')).rejects.toThrow();
    await expect(verifyVerifierToken('only-one-part')).rejects.toThrow();
  });
});
