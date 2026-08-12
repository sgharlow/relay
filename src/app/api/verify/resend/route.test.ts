/**
 * Tests for POST /api/verify/resend.
 *
 * This is an UNAUTHENTICATED endpoint that can cause a credential to be mailed,
 * so most of what matters here is negative: it must not enumerate, must not
 * redirect, must not re-derive who gets a code, and must not resend to somebody
 * whose question is already closed.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2, J8-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/notify/notifications', () => ({ notifyOneVerifier: vi.fn(async () => true) }));
vi.mock('../../../../../lib/notify/verifier-notice-class', () => ({
  classifyOrFailOpen: vi.fn(async () => new Map([['v-1', 'code']])),
}));
vi.mock('../../../../../lib/people/owner-label', () => ({ getOwnerLabel: vi.fn(async () => 'Margaret Chen') }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../../lib/http/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  clientKey: vi.fn(() => 'k'),
}));

import { query } from '../../../../../lib/db/connection';
import { notifyOneVerifier } from '../../../../../lib/notify/notifications';
import { classifyOrFailOpen } from '../../../../../lib/notify/verifier-notice-class';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { rateLimit } from '../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockQuery = vi.mocked(query);
const mockNotify = vi.mocked(notifyOneVerifier);
const mockClassify = vi.mocked(classifyOrFailOpen);

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/verify/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MATCH = {
  verifier_id: 'v-1',
  verifier_name: 'Dr Patel',
  verifier_email: 'onfile@example.com',
  release_state_id: 'rs-1',
  owner_id: 'o-1',
  trigger_type: 'caregiver',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  mockNotify.mockResolvedValue(true);
  mockClassify.mockResolvedValue(new Map([['v-1', 'code']]) as never);
  vi.mocked(rateLimit).mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('the constant response', () => {
  it('answers identically for a match and a miss', async () => {
    const miss = await (await POST(req({ email: 'nobody@example.com' }))).json();

    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    const hit = await (await POST(req({ email: 'onfile@example.com' }))).json();

    // Someone probing addresses learns nothing about who is named on a vault.
    expect(miss).toEqual(hit);
  });

  it('answers identically for an empty address, and asks the database nothing', async () => {
    const res = await POST(req({ email: '' }));
    expect(res.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('never promises a code, because not everyone is sent one', async () => {
    // What a verifier needs depends on how they are set up. "A code is on its
    // way" would be false for a passkey holder, who correctly receives none.
    const body = (await (await POST(req({ email: 'x@example.com' }))).json()) as { message: string };
    expect(body.message).not.toMatch(/code/i);
  });
});

describe('who it will act for', () => {
  it('sends to the address ON FILE, never the one supplied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    await POST(req({ email: 'ONFILE@example.com' }));

    expect(mockNotify.mock.calls[0][0].email).toBe('onfile@example.com');
  });

  it('only considers releases that are already open', async () => {
    await POST(req({ email: 'x@example.com' }));
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/rs\.state IN \('pending', 'grace'\)/);
  });

  it('excludes a revoked verifier in SQL', async () => {
    await POST(req({ email: 'x@example.com' }));
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/<>\s*'revoked'/);
  });

  it('excludes somebody who has already answered', async () => {
    // Their question is closed. Resending would ask it twice, which reads as the
    // product having lost their answer.
    await POST(req({ email: 'x@example.com' }));
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/NOT EXISTS[\s\S]*verifier_confirmations/);
  });

  it('does nothing at all when nobody matches', async () => {
    await POST(req({ email: 'nobody@example.com' }));
    expect(mockNotify).not.toHaveBeenCalled();
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });
});

describe('it reuses the release path decision rather than re-deriving it', () => {
  it('passes the classifier verdict straight through', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    mockClassify.mockResolvedValueOnce(new Map([['v-1', 'sign_in']]) as never);

    await POST(req({ email: 'onfile@example.com' }));

    // A passkey holder asking for a resend gets a sign-in nudge, not a code —
    // and this endpoint does not decide that, the shared classifier does.
    expect(mockNotify.mock.calls[0][1].noticeClass).toBe('sign_in');
  });

  it('uses the release own trigger type, not a hardcoded one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    await POST(req({ email: 'onfile@example.com' }));

    expect(mockNotify.mock.calls[0][1].triggerType).toBe('caregiver');
  });
});

describe('visibility and throttling', () => {
  it('records the send in the owner audit log, with the class', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    await POST(req({ email: 'onfile@example.com' }));

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({
        action: 'verifier_notice_resent',
        detail: expect.objectContaining({ noticeClass: 'code' }),
      }),
    );
  });

  it('does not audit when nothing was actually sent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MATCH], rowCount: 1 } as never);
    mockNotify.mockResolvedValueOnce(false); // a revoked verifier: skip

    await POST(req({ email: 'onfile@example.com' }));
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });

  it('refuses when rate limited, before touching the database', async () => {
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });

    const res = await POST(req({ email: 'onfile@example.com' }));
    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
