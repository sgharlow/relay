/**
 * Tests for POST /api/kms/wrap
 *
 * Validates: Requirements 2.2, 17.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({
  getOwnerSession: vi.fn(),
}));
vi.mock('../../../../../lib/kms/kms-client', () => ({
  generateDataKey: vi.fn(),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({
  writeAuditEntry: vi.fn(async () => ({})),
}));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { generateDataKey } from '../../../../../lib/kms/kms-client';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockGenerate = vi.mocked(generateDataKey);
const mockAudit = vi.mocked(writeAuditEntry);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/kms/wrap', () => {
  it('returns 401 response when there is no owner session', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockRejectedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns the wrapped + plaintext key and audits the request', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockGenerate.mockResolvedValueOnce({
      plaintextDataKey: 'PLAINTEXT_B64',
      wrappedDataKey: 'WRAPPED_B64',
      kmsKeyId: 'cmk-1',
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      plaintext_data_key: 'PLAINTEXT_B64',
      wrapped_data_key: 'WRAPPED_B64',
      kms_key_id: 'cmk-1',
    });

    // audited without leaking key material
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [ownerArg, entryArg] = mockAudit.mock.calls[0];
    expect(ownerArg).toBe('owner-1');
    expect(entryArg.action).toBe('kms_wrap_requested');
    const auditStr = JSON.stringify(entryArg);
    expect(auditStr).not.toContain('PLAINTEXT_B64');
    expect(auditStr).not.toContain('WRAPPED_B64');
  });

  it('returns 502 and does not audit when KMS fails', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockGenerate.mockRejectedValueOnce(new Error('kms down'));

    const res = await POST();
    expect(res.status).toBe(502);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
