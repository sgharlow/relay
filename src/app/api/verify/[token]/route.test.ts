/**
 * Tests for GET /api/verify/[token].
 *
 * The case that matters here is a token that is genuinely OURS — correctly
 * signed, unexpired — naming a release state that no longer exists. Verifier
 * links live 72 hours and a release state disappears when an owner deletes
 * their account, so this is not a hypothetical: it is a doctor opening the link
 * from their email during an emergency, after the situation has moved on.
 *
 * They must get the same plain refusal a forged link gets. A 500 tells a
 * stressed non-technical person that the product is broken, when the truthful
 * answer is that the link is simply no longer good.
 *
 * Found by probing production 2026-08-08.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('../../../../../lib/auth/verifier-token', () => ({
  verifyVerifierToken: vi.fn(),
}));
vi.mock('../../../../../lib/release/verifier-context', () => ({
  buildVerifierContext: vi.fn(),
}));

import { verifyVerifierToken } from '../../../../../lib/auth/verifier-token';
import { buildVerifierContext } from '../../../../../lib/release/verifier-context';
import { TriggerError } from '../../../../../lib/release/triggers';
import { GET } from './route';

const mockVerify = vi.mocked(verifyVerifierToken);
const mockContext = vi.mocked(buildVerifierContext);

const ctx = { params: { token: 'a.valid.token' } };
const req = {} as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue({
    verifierId: 'v-1',
    releaseStateId: 'rs-gone',
    iat: 0,
    exp: 9e9,
  });
});

describe('GET /api/verify/[token]', () => {
  it('403s a valid token whose release state is gone, instead of throwing', async () => {
    mockContext.mockRejectedValueOnce(new TriggerError('Release state not found', 404));

    const res = await GET(req, ctx);

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('This link is no longer valid');
  });

  it('says nothing different than it says to a forged link', async () => {
    // Deliberate: the response must not let a holder distinguish "this release
    // was deleted" from "this signature is bad". Same status, same words.
    mockVerify.mockReset();
    mockVerify.mockRejectedValueOnce(new Error('Invalid token: signature verification failed'));
    const forged = await GET(req, ctx);

    mockVerify.mockResolvedValue({ verifierId: 'v-1', releaseStateId: 'rs-gone', iat: 0, exp: 9e9 });
    mockContext.mockRejectedValueOnce(new TriggerError('Release state not found', 404));
    const stale = await GET(req, ctx);

    expect(stale.status).toBe(forged.status);
    expect(await stale.json()).toEqual(await forged.json());
  });

  it('still lets a real database failure surface as a failure', async () => {
    // The narrow catch is the point. Swallowing every error into a friendly
    // 403 would turn an outage into a silent "your link expired" shown to
    // every verifier at once, and nothing would page anyone.
    mockContext.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    await expect(GET(req, ctx)).rejects.toThrow('connection terminated');
  });

  it('returns the context for a token whose release state is present', async () => {
    const context = {
      caseId: 'RLY-1234-ABCD',
      triggerType: 'emergency',
      itemCount: 4,
      categories: ['financial'],
      requiredConfirmations: 1,
      receivedConfirmations: 0,
      graceEndsAt: null,
      reversible: true,
      escalationHistory: [],
    };
    mockContext.mockResolvedValueOnce(context);

    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(context);
  });
});
