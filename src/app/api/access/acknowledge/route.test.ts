/**
 * The recipient confirms they have read what this access is and is not.
 *
 * This handler executed no test until 2026-08-30. Gate `g2-counsel-opinion` was
 * DECLINED on 2026-08-14, and this record is a named part of what was done
 * instead of obtaining an opinion — which makes an acknowledgement filed against
 * the wrong person worse than no acknowledgement at all.
 *
 * 🔴 TWO IDENTITY PATHS THAT MUST AGREE. An unclaimed recipient presents a
 * scoped token; a claimed one resolves from their session. The route mirrors
 * `/api/access` GET deliberately — "if these two ever disagree about who a
 * recipient is, the acknowledgement would be filed against the wrong person".
 * Both paths are walked below, and each asserts the pair of ids that reaches the
 * recorder.
 *
 * 🔴 THE OWNER IS READ FROM THE RELEASE, NEVER FROM THE CALLER. The record goes
 * on the OWNER'S hash-chained audit log, and the caller is a recipient who must
 * not be able to choose whose chain they write to. Asserted by pinning the
 * lookup and the recorded ownerId to the release row.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/auth/recipient-token', () => ({
  verifyRecipientToken: vi.fn(),
}));
vi.mock('../../../../../lib/access/session-access', () => ({
  resolveReleaseForUser: vi.fn(),
}));
vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/access/acknowledgement', () => ({
  recordLimitsAcknowledgement: vi.fn(async () => undefined),
}));

import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { resolveReleaseForUser } from '../../../../../lib/access/session-access';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { query } from '../../../../../lib/db/connection';
import { recordLimitsAcknowledgement } from '../../../../../lib/access/acknowledgement';
import { POST } from './route';

const mockVerify = vi.mocked(verifyRecipientToken);
const mockResolve = vi.mocked(resolveReleaseForUser);
const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);
const mockRecord = vi.mocked(recordLimitsAcknowledgement);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const RELEASE = 'a1a1a1a1-2222-4333-8444-555566667777';
const RECIPIENT = 'aaaaaaaa-2222-4333-8444-555566667777';
const USER = 'e5e5e5e5-2222-4333-8444-555566667777';

function req(opts: { bearer?: string; queryToken?: string } = {}): NextRequest {
  const url =
    'https://relaystandby.com/api/access/acknowledge' +
    (opts.queryToken ? `?token=${opts.queryToken}` : '');
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest(url, { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue({ recipientId: RECIPIENT, releaseStateId: RELEASE } as never);
  mockResolve.mockResolvedValue({ recipientId: RECIPIENT, releaseStateId: RELEASE } as never);
  mockSession.mockResolvedValue({ ownerId: USER } as never);
  mockQuery.mockResolvedValue({ rows: [{ owner_id: OWNER }] } as never);
  mockRecord.mockResolvedValue(undefined as never);
});

describe('the token path — an unclaimed recipient', () => {
  it('records against the ids inside the token', async () => {
    const res = await POST(req({ bearer: 'tok_abc' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ acknowledged: true });
    expect(mockVerify).toHaveBeenCalledWith('tok_abc');
    expect(mockRecord).toHaveBeenCalledWith({
      ownerId: OWNER,
      recipientId: RECIPIENT,
      releaseStateId: RELEASE,
    });
  });

  it('accepts the token from the query string as well as the header', async () => {
    await POST(req({ queryToken: 'tok_qs' }));
    expect(mockVerify).toHaveBeenCalledWith('tok_qs');
  });

  it('prefers the Authorization header when both are present', async () => {
    await POST(req({ bearer: 'tok_header', queryToken: 'tok_qs' }));
    expect(mockVerify).toHaveBeenCalledWith('tok_header');
  });

  it('refuses an invalid token without touching the session path', async () => {
    mockVerify.mockRejectedValueOnce(new Error('bad signature'));
    const res = await POST(req({ bearer: 'forged' }));
    expect(res.status).toBe(403);
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('the session path — a claimed recipient', () => {
  it('resolves the open release for the signed-in user', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(USER);
    expect(mockRecord).toHaveBeenCalledWith({
      ownerId: OWNER,
      recipientId: RECIPIENT,
      releaseStateId: RELEASE,
    });
  });

  it('refuses when nobody is signed in and no token was presented', async () => {
    mockSession.mockRejectedValueOnce(new Error('no session'));
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('refuses a signed-in user with no open release', async () => {
    // Signed in is not the same as entitled. Somebody with an account and no
    // release must not be able to file an acknowledgement.
    mockResolve.mockResolvedValueOnce(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('whose audit chain it lands on', () => {
  it('reads the owner from the release row, not from the caller', async () => {
    await POST(req({ bearer: 'tok_abc' }));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/FROM release_state WHERE id = \$1/);
    expect(params).toEqual([RELEASE]);
  });

  it('refuses when the release does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST(req({ bearer: 'tok_abc' }));
    expect(res.status).toBe(404);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
