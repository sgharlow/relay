/**
 * In-flight token compatibility across the jose migration (2026-08-08).
 *
 * WHY THIS EXISTS. The swap changed how tokens are PRODUCED. It must not change
 * what counts as a valid token, because at the moment it deploys there are
 * already-issued tokens sitting in people's inboxes: recipient links live 24
 * hours, verifier links 72. If the wire format moved even slightly, every one
 * of those breaks — and it breaks for someone who is, by definition, in the
 * middle of an emergency and holding the only link they were sent.
 *
 * The suite could not have caught that on its own: every other test issues and
 * verifies with the same implementation, so both sides would move together and
 * agree with each other perfectly while agreeing with nothing already sent.
 * These tests deliberately issue with the OLD hand-rolled algorithm and verify
 * with the new one.
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.2, 6.3, 17.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

import { verifyRecipientToken } from './recipient-token';
import { verifyVerifierToken } from './verifier-token';

const RECIPIENT_SECRET = 'test-recipient-secret-at-least-32-chars!';
const VERIFIER_SECRET = 'test-verifier-secret-at-least-32-chars!!';

beforeEach(() => {
  process.env.RECIPIENT_JWT_SECRET = RECIPIENT_SECRET;
  process.env.VERIFIER_JWT_SECRET = VERIFIER_SECRET;
});

afterEach(() => {
  delete process.env.RECIPIENT_JWT_SECRET;
  delete process.env.VERIFIER_JWT_SECRET;
});

/**
 * The pre-migration issuer, reproduced verbatim from the implementation this
 * replaced. Kept here rather than imported because the point is to encode a
 * token the way the deployed-yesterday code did, independently of whatever the
 * module does now.
 */
function legacyIssue(claims: Record<string, unknown>, secret: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const signingInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(signingInput).digest();
  return `${signingInput}.${sig.toString('base64url')}`;
}

describe('tokens issued before the jose migration', () => {
  const now = Math.floor(Date.now() / 1000);

  it('a legacy recipient token still verifies, with every claim intact', async () => {
    const token = legacyIssue(
      {
        recipientId: 'rec-legacy',
        releaseStateId: 'rs-legacy',
        version: '4',
        iat: now - 60,
        exp: now + 24 * 60 * 60,
      },
      RECIPIENT_SECRET,
    );

    const payload = await verifyRecipientToken(token);

    expect(payload.recipientId).toBe('rec-legacy');
    expect(payload.releaseStateId).toBe('rs-legacy');
    // The version claim gates stale sessions. A string that came back as a
    // number here would silently defeat the staleness check downstream.
    expect(payload.version).toBe('4');
  });

  it('a legacy verifier token still verifies', async () => {
    const token = legacyIssue(
      { verifierId: 'v-legacy', releaseStateId: 'rs-legacy', iat: now - 60, exp: now + 72 * 60 * 60 },
      VERIFIER_SECRET,
    );

    const payload = await verifyVerifierToken(token);

    expect(payload.verifierId).toBe('v-legacy');
    expect(payload.releaseStateId).toBe('rs-legacy');
  });

  it('an expired legacy token is still refused', async () => {
    const token = legacyIssue(
      { recipientId: 'rec-legacy', releaseStateId: 'rs-legacy', version: '1', iat: now - 100, exp: now - 1 },
      RECIPIENT_SECRET,
    );

    await expect(verifyRecipientToken(token)).rejects.toThrow('expired');
  });

  it('a legacy token signed with the wrong secret is still refused', async () => {
    const token = legacyIssue(
      { recipientId: 'rec-legacy', releaseStateId: 'rs-legacy', version: '1', iat: now, exp: now + 3600 },
      'a-secret-that-is-not-the-configured-one!!',
    );

    await expect(verifyRecipientToken(token)).rejects.toThrow('signature verification failed');
  });
});
