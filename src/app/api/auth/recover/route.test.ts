/**
 * The recovery completion's three consequences.
 *
 * 🔴 RECOVERY USED TO CHANGE THE LOCK AND LEAVE EVERY OLD KEY WORKING. Until
 * 2026-08-14 completing a recovery replaced the authenticator and stopped: no
 * session revocation (bumpSessionEpoch existed with zero callers), no audit
 * entry for the one event that can transfer control of the account, and no
 * word to the owner — who, if the recoverer was an attacker with a leaked
 * code, finds out never. These tests pin all three so none can quietly
 * disappear again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/recovery-code', () => ({
  redeemRecoveryCode: vi.fn(),
  issueRecoveryCodes: vi.fn(async () => ['AAAA1111BBBB2222']),
  replaceTotpSecret: vi.fn(async () => undefined),
  formatRecoveryCode: (c: string) => c,
  RecoveryCodeError: class RecoveryCodeError extends Error {},
}));
vi.mock('../../../../../lib/auth/recovery-enrolment', () => ({
  beginRecoveryEnrolment: vi.fn(() => ({ enrolmentToken: 'T', otpauthUrl: 'otpauth://x' })),
  completeRecoveryEnrolment: vi.fn(() => ({ userId: 'user-1', secret: 'S' })),
}));
vi.mock('../../../../../lib/auth/session-epoch', () => ({
  bumpSessionEpoch: vi.fn(async () => 2),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({
  writeAuditEntry: vi.fn(async () => ({})),
}));
vi.mock('../../../../../lib/notify/notifications', () => ({
  notifyOwnerOfRecovery: vi.fn(async () => true),
}));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { bumpSessionEpoch } from '../../../../../lib/auth/session-epoch';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { notifyOwnerOfRecovery } from '../../../../../lib/notify/notifications';
import { issueRecoveryCodes } from '../../../../../lib/auth/recovery-code';
import { query } from '../../../../../lib/db/connection';
import { POST } from './route';

const mockQuery = vi.mocked(query);

function makeReq(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({
    rows: [{ email: 'owner@example.com' }],
    rowCount: 1,
    command: '',
    oid: 0,
    fields: [],
  } as never);
});

describe('POST /api/auth/recover — completion consequences', () => {
  it('revokes every outstanding session', async () => {
    const res = await POST(makeReq({ enrolmentToken: 'T', code: '123456' }));
    expect(res.status).toBe(200);
    expect(bumpSessionEpoch).toHaveBeenCalledWith('user-1');
  });

  it('writes the takeover-shaped event to the audit chain BEFORE issuing codes', async () => {
    await POST(makeReq({ enrolmentToken: 'T', code: '123456' }));

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ action: 'account_recovered' }),
    );
    // Ordering: the record precedes the reward. A recovery that cannot be
    // recorded must not complete (the audit rule), so the entry goes first.
    const auditOrder = vi.mocked(writeAuditEntry).mock.invocationCallOrder[0];
    const codesOrder = vi.mocked(issueRecoveryCodes).mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(codesOrder);
  });

  it('tells the owner, at the address on the account', async () => {
    await POST(makeReq({ enrolmentToken: 'T', code: '123456' }));
    expect(notifyOwnerOfRecovery).toHaveBeenCalledWith('owner@example.com');
  });

  it('a mail failure does not fail the recovery — the legitimate case wins', async () => {
    vi.mocked(notifyOwnerOfRecovery).mockRejectedValueOnce(new Error('resend down'));
    const res = await POST(makeReq({ enrolmentToken: 'T', code: '123456' }));
    expect(res.status).toBe(200);
    expect((await res.json()).recovered).toBe(true);
  });

  it('a failed audit write DOES fail the recovery — unrecorded takeover must not complete', async () => {
    vi.mocked(writeAuditEntry).mockRejectedValueOnce(new Error('DSQL unavailable'));
    await expect(POST(makeReq({ enrolmentToken: 'T', code: '123456' }))).rejects.toThrow();
    expect(issueRecoveryCodes).not.toHaveBeenCalled();
  });
});
