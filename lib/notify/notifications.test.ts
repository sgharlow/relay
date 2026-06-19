/**
 * Tests for lib/notify/notifications.ts + email best-effort behaviour.
 *
 * Validates: Requirements 4.4, 6.2, 6.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';
import { _setResendClientForTesting } from './email';
import { notifyVerifiersForTrigger, notifyOwnerReleasePendingGrace, notifyRecipientsOfRelease } from './notifications';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);

const sent: Array<{ to: string; subject: string; text: string }> = [];

function stubResend(opts: { fail?: boolean } = {}): Resend {
  return {
    emails: {
      send: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
        if (opts.fail) throw new Error('resend down');
        sent.push(msg);
        return { data: { id: 'mail-1' }, error: null };
      }),
    },
  } as unknown as Resend;
}

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => {
  sent.length = 0;
  mockQuery.mockReset();
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.VERIFIER_JWT_SECRET = 'test-secret';
  process.env.RECIPIENT_JWT_SECRET = 'test-recipient-secret';
  process.env.NEXTAUTH_URL = 'https://relay.test';
});
afterEach(() => {
  _setResendClientForTesting(null);
});

describe('notifyVerifiersForTrigger', () => {
  it('emails each verifier a scoped confirmation link and counts successes', async () => {
    _setResendClientForTesting(stubResend());
    const n = await notifyVerifiersForTrigger(
      [
        { id: 'v1', name: 'Lee', email: 'lee@example.com' },
        { id: 'v2', name: 'Sam', email: 'sam@example.com' },
      ],
      'emergency',
      'rs-1',
    );
    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0].text).toContain('/confirm?token=');
    // verifiers must never receive secret material
    expect(sent[0].text).not.toContain('ciphertext');
  });

  it('best-effort: a Resend failure does not throw (returns 0 sent)', async () => {
    _setResendClientForTesting(stubResend({ fail: true }));
    const n = await notifyVerifiersForTrigger([{ id: 'v1', name: 'Lee', email: 'lee@example.com' }], 'emergency', 'rs-1');
    expect(n).toBe(0);
  });
});

describe('notifyRecipientsOfRelease', () => {
  it('emails each scoped recipient a personal /access link and counts successes', async () => {
    _setResendClientForTesting(stubResend());
    mockQuery.mockResolvedValueOnce(
      qResult([
        { id: 'r1', name: 'Jordan', email: 'jordan@example.com' },
        { id: 'r2', name: 'Pat', email: 'pat@example.com' },
      ]),
    );
    const n = await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'owner-1', triggerType: 'emergency', version: 3 });
    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0].text).toContain('/access?token=');
    // scoped query joins access_rules on owner + trigger
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('JOIN access_rules');
  });

  it('returns 0 when no recipients are scoped', async () => {
    _setResendClientForTesting(stubResend());
    mockQuery.mockResolvedValueOnce(qResult([]));
    expect(await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 1 })).toBe(0);
  });
});

describe('notifyOwnerReleasePendingGrace', () => {
  it('sends the owner a grace-pending notice', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'emergency');
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toContain('grace window');
  });
});
