/**
 * Tests for the session door on POST /api/access-requests.
 *
 * The token door is unchanged and stays — an unclaimed recipient holding a live
 * access code is still a legitimate requester. What is asserted here is that the
 * new door refuses everything it should, and that adding it did not weaken the
 * old one.
 *
 * Feature: relay-standby
 * Requirements: J6-R1, J6-R2, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../lib/http/owner-route');
  return { ...actual, requireOwner: vi.fn() };
});
vi.mock('../../../../lib/access/requester-session', () => ({ resolveRequesterFor: vi.fn() }));
vi.mock('../../../../lib/auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../lib/notify/notifications', () => ({
  notifyOwnerOfAccessRequest: vi.fn(async () => true),
  notifyCircleOfRequest: vi.fn(async () => 0),
}));

import { query } from '../../../../lib/db/connection';
import { requireOwner } from '../../../../lib/http/owner-route';
import { resolveRequesterFor } from '../../../../lib/access/requester-session';
import { verifyRecipientToken } from '../../../../lib/auth/recipient-token';
import { POST } from './route';

const mockQuery = vi.mocked(query);
const mockAuth = vi.mocked(requireOwner);
const mockResolve = vi.mocked(resolveRequesterFor);
const mockToken = vi.mocked(verifyRecipientToken);

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://relaystandby.com/api/access-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** The queries the happy path makes, in order, after the requester resolves. */
function seedInsertPath() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ owner_id: 'o-1' }], rowCount: 1 } as never) // owner lookup
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // velocity read
    .mockResolvedValueOnce({ rows: [{ id: 'ar-1' }], rowCount: 1 } as never) // insert
    .mockResolvedValue({ rows: [{ email: 'o@example.com', name: 'Jordan' }], rowCount: 1 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  mockAuth.mockResolvedValue({ ownerId: 'u-1' } as never);
  mockResolve.mockResolvedValue({ recipientId: 'r-1', ownerId: 'o-1' });
});

describe('the session door — J6 had no entry point at all before this', () => {
  it('accepts a signed-in recipient asking about a vault they are named on', async () => {
    seedInsertPath();
    const res = await POST(req({ owner_id: 'o-1', trigger_type: 'emergency', reason: 'in hospital' }));
    expect(res.status).toBe(201);
    expect(mockResolve).toHaveBeenCalledWith('u-1', 'o-1');
  });

  it('REFUSES a signed-in user who is not named on that vault', async () => {
    // The whole point of resolving from the roster: a session proves who you
    // are, not what you may ask about.
    mockResolve.mockResolvedValueOnce(null);
    const res = await POST(req({ owner_id: 'somebody-elses', trigger_type: 'emergency' }));
    expect(res.status).toBe(403);
  });

  it('refuses without an owner_id rather than guessing which vault is meant', async () => {
    // Somebody may stand by for two people. Picking one would be a coin flip
    // that starts an emergency on the wrong person's account.
    const res = await POST(req({ trigger_type: 'emergency' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('refuses when there is no session and no token', async () => {
    // Must be a NextResponse: `isResponse` is an instanceof check, so a plain
    // Response would fall through and be treated as a successful auth.
    mockAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const res = await POST(req({ owner_id: 'o-1', trigger_type: 'emergency' }));
    expect(res.status).toBe(401);
  });

  it('still validates the trigger type on the session path', async () => {
    const res = await POST(req({ owner_id: 'o-1', trigger_type: 'not_a_trigger' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the token door is unchanged', () => {
  it('still accepts a recipient token and never consults the session', async () => {
    mockToken.mockResolvedValueOnce({ recipientId: 'r-9' } as never);
    seedInsertPath();

    const res = await POST(req({ recipient_token: 'tok', trigger_type: 'emergency' }));

    expect(res.status).toBe(201);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('still rejects an invalid token with 403, not a fallthrough to the session', async () => {
    // A bad token must NOT quietly fall through to "maybe they are signed in" —
    // that would turn a forged credential into a different privilege check.
    mockToken.mockRejectedValueOnce(new Error('bad'));
    const res = await POST(req({ recipient_token: 'forged', trigger_type: 'emergency' }));
    expect(res.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('accepts the token in an Authorization header as before', async () => {
    mockToken.mockResolvedValueOnce({ recipientId: 'r-9' } as never);
    seedInsertPath();

    const res = await POST(
      req({ trigger_type: 'emergency' }, { authorization: 'Bearer tok' }),
    );
    expect(res.status).toBe(201);
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
