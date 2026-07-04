/**
 * Negative security vectors for the session-token modules
 * (lib/auth/recipient-token.ts, lib/auth/verifier-token.ts).
 *
 * ADDITIVE ONLY (docs/security-remediation-plan.md, approach item 3): the
 * pre-existing tests in recipient-token.test.ts / verifier-token.test.ts are
 * the compatibility harness and are intentionally untouched. This file pins
 * the attack-shaped rejections the plan calls out explicitly:
 *   - `alg: none` (and other downgraded/foreign algorithms) rejection
 *   - tampered signature / signature stripping
 *   - wrong signing key
 *   - expired token (verifier 72h TTL — recipient expiry already covered)
 *   - cross-token-type confusion (recipient token presented as verifier
 *     token and vice versa), under both same and different secrets
 *
 * Feature: relay-h0-mvp
 * Requirements: 15.2, 6.3, 17.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issueRecipientToken, verifyRecipientToken } from './recipient-token';
import { issueVerifierToken, verifyVerifierToken } from './verifier-token';

const RECIPIENT_SECRET = 'test-recipient-secret-at-least-32-chars!';
const VERIFIER_SECRET = 'test-verifier-secret-at-least-32-chars!!';

beforeEach(() => {
  process.env.RECIPIENT_JWT_SECRET = RECIPIENT_SECRET;
  process.env.VERIFIER_JWT_SECRET = VERIFIER_SECRET;
});

afterEach(() => {
  delete process.env.RECIPIENT_JWT_SECRET;
  delete process.env.VERIFIER_JWT_SECRET;
  vi.restoreAllMocks();
});

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// ---------------------------------------------------------------------------
// alg:none / algorithm-downgrade rejection
// ---------------------------------------------------------------------------

describe('alg:none and algorithm-downgrade rejection', () => {
  const recipientClaims = {
    recipientId: 'rec-1',
    releaseStateId: 'rs-1',
    version: '0',
    iat: 0,
    exp: 9_999_999_999,
  };
  const verifierClaims = {
    verifierId: 'v-1',
    releaseStateId: 'rs-1',
    iat: 0,
    exp: 9_999_999_999,
  };

  it('recipient: rejects an unsigned alg:none token (empty signature)', () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(recipientClaims)}.`;
    expect(() => verifyRecipientToken(token)).toThrow('unsupported algorithm');
  });

  it('verifier: rejects an unsigned alg:none token (empty signature)', () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(verifierClaims)}.`;
    expect(() => verifyVerifierToken(token)).toThrow('unsupported algorithm');
  });

  it.each(['NONE', 'HS512', 'RS256', 'ES256'])(
    'recipient: rejects alg "%s" even with an otherwise well-formed token',
    (alg) => {
      const token = `${b64url({ alg, typ: 'JWT' })}.${b64url(recipientClaims)}.AAAA`;
      expect(() => verifyRecipientToken(token)).toThrow('unsupported algorithm');
    },
  );

  it.each(['NONE', 'HS512', 'RS256', 'ES256'])(
    'verifier: rejects alg "%s" even with an otherwise well-formed token',
    (alg) => {
      const token = `${b64url({ alg, typ: 'JWT' })}.${b64url(verifierClaims)}.AAAA`;
      expect(() => verifyVerifierToken(token)).toThrow('unsupported algorithm');
    },
  );

  it('rejects a header with a missing alg claim', () => {
    const token = `${b64url({ typ: 'JWT' })}.${b64url(recipientClaims)}.AAAA`;
    expect(() => verifyRecipientToken(token)).toThrow('unsupported algorithm');
  });
});

// ---------------------------------------------------------------------------
// Signature stripping / tampering / wrong key
// ---------------------------------------------------------------------------

describe('signature integrity', () => {
  it('recipient: rejects a valid token whose signature segment is emptied', () => {
    const [h, p] = issueRecipientToken('rec-1', 'rs-1', 1n).split('.');
    expect(() => verifyRecipientToken(`${h}.${p}.`)).toThrow(
      'signature verification failed',
    );
  });

  it('verifier: rejects a valid token whose signature segment is emptied', () => {
    const [h, p] = issueVerifierToken('v-1', 'rs-1').split('.');
    expect(() => verifyVerifierToken(`${h}.${p}.`)).toThrow(
      'signature verification failed',
    );
  });

  it('verifier: rejects a single-bit flip in the signature', () => {
    const token = issueVerifierToken('v-1', 'rs-1');
    const [h, p, s] = token.split('.');
    const sig = Buffer.from(s, 'base64url');
    sig[0] ^= 0x01;
    const flipped = `${h}.${p}.${sig.toString('base64url')}`;
    expect(() => verifyVerifierToken(flipped)).toThrow(
      'signature verification failed',
    );
  });

  it('recipient: rejects a token signed with the verifier secret', () => {
    process.env.RECIPIENT_JWT_SECRET = VERIFIER_SECRET;
    const token = issueRecipientToken('rec-1', 'rs-1', 0n);
    process.env.RECIPIENT_JWT_SECRET = RECIPIENT_SECRET;
    expect(() => verifyRecipientToken(token)).toThrow(
      'signature verification failed',
    );
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('expiry enforcement', () => {
  it('verifier: rejects a token older than its 72h TTL', () => {
    const realNow = Date.now.bind(global.Date);
    const token = issueVerifierToken('v-1', 'rs-1');
    vi.spyOn(global.Date, 'now').mockReturnValue(realNow() + 73 * 60 * 60 * 1000);
    try {
      expect(() => verifyVerifierToken(token)).toThrow('expired');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('verifier: still accepts a token 71h after issuance (inside TTL)', () => {
    const realNow = Date.now.bind(global.Date);
    const token = issueVerifierToken('v-1', 'rs-1');
    vi.spyOn(global.Date, 'now').mockReturnValue(realNow() + 71 * 60 * 60 * 1000);
    try {
      expect(verifyVerifierToken(token).verifierId).toBe('v-1');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('recipient: rejects a hand-crafted token with exp exactly equal to now', () => {
    // exp <= now must be rejected (strict inequality on validity)
    const nowSec = Math.floor(Date.now() / 1000);
    vi.spyOn(global.Date, 'now').mockReturnValue(nowSec * 1000);
    const token = issueRecipientToken('rec-1', 'rs-1', 0n);
    // Fast-forward exactly TTL so exp === "now"
    vi.spyOn(global.Date, 'now').mockReturnValue((nowSec + 24 * 60 * 60) * 1000);
    try {
      expect(() => verifyRecipientToken(token)).toThrow('expired');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-token-type confusion
// ---------------------------------------------------------------------------

describe('cross-token-type confusion', () => {
  it('a recipient token is rejected by the verifier verifier (different secrets)', () => {
    const recipientToken = issueRecipientToken('rec-1', 'rs-1', 0n);
    expect(() => verifyVerifierToken(recipientToken)).toThrow(
      'signature verification failed',
    );
  });

  it('a verifier token is rejected by the recipient verifier (different secrets)', () => {
    const verifierToken = issueVerifierToken('v-1', 'rs-1');
    expect(() => verifyRecipientToken(verifierToken)).toThrow(
      'signature verification failed',
    );
  });

  it('even under a shared secret, a recipient token fails verifier claim checks', () => {
    // Worst-case misconfiguration: both token types share one signing secret.
    // The signature then verifies, so the claim schema is the only remaining
    // guard — the verifier payload requires verifierId.
    const shared = 'one-shared-secret-for-both-token-types!!';
    process.env.RECIPIENT_JWT_SECRET = shared;
    process.env.VERIFIER_JWT_SECRET = shared;

    const recipientToken = issueRecipientToken('rec-1', 'rs-1', 0n);
    expect(() => verifyVerifierToken(recipientToken)).toThrow(
      'missing verifierId claim',
    );
  });

  it('even under a shared secret, a verifier token fails recipient claim checks', () => {
    const shared = 'one-shared-secret-for-both-token-types!!';
    process.env.RECIPIENT_JWT_SECRET = shared;
    process.env.VERIFIER_JWT_SECRET = shared;

    const verifierToken = issueVerifierToken('v-1', 'rs-1');
    expect(() => verifyRecipientToken(verifierToken)).toThrow(
      'missing recipientId claim',
    );
  });
});
