/**
 * Tests for PATCH /api/account and POST /api/account/recovery-codes.
 *
 * Both close gaps of the same shape: a capability that exists and works in
 * `lib/`, with no way for a signed-in owner to reach it.
 *
 * The display name is what every recipient sees — "Margaret Chen set something
 * up for you" — and it was write-once at signup, so a typo was permanent in the
 * one place it is read by the people who matter.
 *
 * Recovery codes were worse. `issueRecoveryCodes` had exactly one caller,
 * `/auth/recover`, which requires consuming a recovery code to get in. An owner
 * who lost the sheet but still held their authenticator had no path back, and
 * the NEXT lost phone would have been terminal — on a product whose entire
 * promise is that access survives.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1, 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/auth/recovery-code', () => ({
  issueRecoveryCodes: vi.fn(),
  formatRecoveryCode: (c: string) => c,
}));
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { query } from '../../../../lib/db/connection';
import { issueRecoveryCodes } from '../../../../lib/auth/recovery-code';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { PATCH } from './route';
import { POST as regenerate } from './recovery-codes/route';

const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);
const mockIssue = vi.mocked(issueRecoveryCodes);
const mockAudit = vi.mocked(writeAuditEntry);

function req(body: unknown): NextRequest {
  return new Request('https://relaystandby.com/api/account', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('PATCH /api/account — display name', () => {
  it('401s without a session', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await PATCH(req({ displayName: 'Margaret Chen' }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('updates the name, scoped to the caller and nobody else', async () => {
    const res = await PATCH(req({ displayName: 'Margaret Chen' }));

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE users/i);
    // The owner id comes from the session, never from the body — otherwise
    // renaming somebody else's account is a single crafted request away.
    expect(params).toContain('owner-1');
    expect(params).toContain('Margaret Chen');
  });

  it('rejects a name longer than the limit rather than silently truncating', async () => {
    const res = await PATCH(req({ displayName: 'x'.repeat(200) }));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lets an owner clear the name back to their email', async () => {
    const res = await PATCH(req({ displayName: '' }));

    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain(null);
  });
});

describe('POST /api/account/recovery-codes — regeneration', () => {
  it('401s without a session', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await regenerate();

    expect(res.status).toBe(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('returns a fresh set, for the session owner only', async () => {
    mockIssue.mockResolvedValueOnce(['aaaa-bbbb', 'cccc-dddd']);

    const res = await regenerate();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] });
    expect(mockIssue).toHaveBeenCalledWith('owner-1');
  });

  it('audits the regeneration — it invalidates the previous sheet', async () => {
    mockIssue.mockResolvedValueOnce(['aaaa-bbbb']);

    await regenerate();

    // Someone regenerating codes has either lost the old ones or believes they
    // were exposed. Both are worth a line in a log the owner can read back.
    expect(mockAudit).toHaveBeenCalled();
    const [ownerId, entry] = mockAudit.mock.calls[0];
    expect(ownerId).toBe('owner-1');
    expect(entry.action).toBe('recovery_codes_regenerated');
  });

  it('never returns the codes twice — the response is the only copy', async () => {
    mockIssue.mockResolvedValueOnce(['aaaa-bbbb']);
    const first = await regenerate();
    expect((await first.json()).recoveryCodes).toEqual(['aaaa-bbbb']);

    // A second call must mint a NEW set rather than re-showing the old one,
    // because only hashes are stored and the plaintext is genuinely gone.
    mockIssue.mockResolvedValueOnce(['eeee-ffff']);
    const second = await regenerate();
    expect((await second.json()).recoveryCodes).toEqual(['eeee-ffff']);
  });
});
