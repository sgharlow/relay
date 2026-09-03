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
  wrapsWithContext: vi.fn(() => false),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({
  writeAuditEntry: vi.fn(async () => ({})),
}));

import { getOwnerSession } from '../../../../../lib/auth/session';
import { generateDataKey, wrapsWithContext } from '../../../../../lib/kms/kms-client';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockGenerate = vi.mocked(generateDataKey);
const mockWrapsWithContext = vi.mocked(wrapsWithContext);
const mockAudit = vi.mocked(writeAuditEntry);

beforeEach(() => {
  vi.clearAllMocks();
  // Phase B: the flag is off, which is what makes this deploy a no-op.
  mockWrapsWithContext.mockReturnValue(false);
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

  it.each([false, true])(
    'sends no EncryptionContext regardless of the flag (KMS_WRAP_WITH_CONTEXT=%s)',
    async (flag) => {
      /*
        Phase B wraps without a context in BOTH flag states, which is what makes
        the flag harmless here: nothing is wrapped with a context and nothing is
        stamped, so every row stays openable by every build. The flag is phase
        C's switch for wrapping AND stamping together — this build has neither,
        so an ON flag is a misconfiguration to report, not a state to honour and
        not an outage to cause.
      */
      mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
      mockWrapsWithContext.mockReturnValue(flag);
      mockGenerate.mockResolvedValueOnce({
        plaintextDataKey: 'P',
        wrappedDataKey: 'W',
        kmsKeyId: 'cmk-1',
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await POST();

      expect(res.status).toBe(200);
      // No argument at all — not an empty context, not undefined-but-passed.
      // The GenerateDataKey call is byte-for-byte the one it has always made.
      expect(mockGenerate).toHaveBeenCalledWith();
      // Reported once when on, silent when off — an ignored flag that says
      // nothing is how a phase C flip gets recorded as done having done nothing.
      expect(warn).toHaveBeenCalledTimes(flag ? 1 : 0);
      if (flag) {
        expect(String(warn.mock.calls[0][0])).toContain('KMS_WRAP_WITH_CONTEXT');
        expect(String(warn.mock.calls[0][0])).toContain('ignored');
      }
      warn.mockRestore();
    },
  );

  it('returns 502 and does not audit when KMS fails', async () => {
    mockSession.mockResolvedValueOnce({ ownerId: 'owner-1', isDemo: false });
    mockGenerate.mockRejectedValueOnce(new Error('kms down'));

    const res = await POST();
    expect(res.status).toBe(502);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
