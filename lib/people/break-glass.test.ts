/**
 * Tests for break-glass.
 *
 * The property that makes a bearer credential defensible here is that using it
 * is LOUD: it burns itself, writes a distinct audit action, and drops the person
 * to `claimed` rather than `confirmed` so the owner is asked to verify the
 * fingerprint again. A break-glass that silently restored `confirmed` would be a
 * standing credential wearing a costume, and the residual risk §8.1 accepts would
 * stop being bounded.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../auth/upsert-user', () => ({
  upsertUser: vi.fn(async () => ({ id: 'user-9', email: 'aunt@example.com', is_demo_account: false })),
}));
vi.mock('../notify/notifications', () => ({ notifyOwnerOfBreakGlass: vi.fn(async () => true) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { notifyOwnerOfBreakGlass } from '../notify/notifications';
import {
  issueBreakGlass,
  redeemBreakGlass,
  formatBreakGlass,
  hashBreakGlass,
  BREAK_GLASS_CODE_LENGTH,
} from './break-glass';
import { ValidationError } from '../validation';
import { CASE_ID_ALPHABET } from '../release/case-id';

const mockQuery = vi.mocked(query);

const CODE_ROW = {
  id: 'bg-1',
  owner_id: 'owner-1',
  person_id: 'ver-1',
  person_type: 'verifier' as const,
  failed_attempts: 0,
};

/** A live, non-revoked roster row — the guard added 2026-08-12 reads this. */
const ROSTER_OK = { standby_state: 'confirmed' };

function rows(...batches: unknown[][]) {
  for (const b of batches) mockQuery.mockResolvedValueOnce({ rows: b, rowCount: b.length } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('issueBreakGlass', () => {
  it('retires any live code for that person before minting a new one', async () => {
    await issueBreakGlass({ ownerId: 'owner-1', personId: 'ver-1', personType: 'verifier' });

    const first = String(mockQuery.mock.calls[0][0]);
    expect(first).toContain('UPDATE break_glass_codes');
    expect(first).toContain('used_at = now()');
    expect(String(mockQuery.mock.calls[1][0])).toContain('INSERT INTO break_glass_codes');
  });

  it('stores only a hash, so a database read cannot mint a working code', async () => {
    const { code } = await issueBreakGlass({
      ownerId: 'owner-1',
      personId: 'ver-1',
      personType: 'verifier',
    });

    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(params).toContain(hashBreakGlass(code));
    expect(params).not.toContain(code);
  });

  it('mints a long, voice-safe code — it lives in a drawer for a year', async () => {
    const { code } = await issueBreakGlass({
      ownerId: 'owner-1',
      personId: 'ver-1',
      personType: 'verifier',
    });

    expect(code).toHaveLength(BREAK_GLASS_CODE_LENGTH);
    for (const ch of code) expect(CASE_ID_ALPHABET).toContain(ch);
  });

  it('formats in groups people can transcribe', () => {
    expect(formatBreakGlass('ABCD2345EFGH')).toBe('ABCD-2345-EFGH');
  });
});

describe('redeemBreakGlass', () => {
  it('burns the code BEFORE binding, so a partial redeem cannot be replayed', async () => {
    rows([CODE_ROW], [ROSTER_OK], [], [{ email: 'aunt@example.com' }], []);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    // Located by CONTENT, not by index: the guard added on 2026-08-12 inserted a
    // query ahead of these and broke three positional assertions that were never
    // about ordering with it. What this test actually claims is that the burn
    // happens before the bind, so that is what it now asserts.
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    const burnAt = sqls.findIndex((s) => /UPDATE break_glass_codes SET used_at = now\(\)\s+WHERE id/.test(s));
    const bindAt = sqls.findIndex((s) => s.includes('claimed_user_id = $1'));

    expect(burnAt).toBeGreaterThanOrEqual(0);
    expect(bindAt).toBeGreaterThanOrEqual(0);
    expect(burnAt).toBeLessThan(bindAt);
  });

  it('drops the person to CLAIMED, never confirmed — the owner must re-verify', async () => {
    rows([CODE_ROW], [ROSTER_OK], [], [{ email: 'aunt@example.com' }], []);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    const bind =
      mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('claimed_user_id = $1')) ?? '';
    expect(bind).toContain("standby_state = 'claimed'");
    expect(bind).not.toContain("'confirmed'");
    expect(bind).toContain('fingerprint_confirmed_at = NULL');
    // §8.1: the marker records that somebody will never hold an account, and
    // they just did. Cleared in the SAME statement as the binding — a separate
    // write could be forgotten by the next path that binds, leaving an
    // exclusion still excluding a person who can now act.
    expect(bind).toContain('break_glass_only = false');
  });

  it('makes noise: a distinct action that flags re-confirmation is needed', async () => {
    rows([CODE_ROW], [ROSTER_OK], [], [{ email: 'aunt@example.com' }], []);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        action: 'break_glass_redeemed',
        detail: expect.objectContaining({ requiresReconfirmation: true }),
      }),
    );
  });

  it('links an already-signed-in user rather than minting a second account', async () => {
    rows([CODE_ROW], [ROSTER_OK], [], []);

    const out = await redeemBreakGlass({ code: 'ABCD2345EFGH', existingUserId: 'user-77' });

    expect(out.userId).toBe('user-77');
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('INSERT INTO users');
  });

  it('TELLS THE OWNER — the alert is what makes a year-old code defensible', async () => {
    // §3.6 requires redemption to notify the owner, and nothing did until
    // 2026-08-12: the audit entry recorded it for anyone who went looking, which
    // is not the same as telling the one person who needs to know. §8.1 accepts
    // this bearer credential only because using it is LOUD.
    rows([CODE_ROW], [ROSTER_OK], [], [{ email: 'aunt@example.com' }], [], [
      { name: 'Aunt Jo', email: 'margaret@example.com' },
    ]);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    expect(vi.mocked(notifyOwnerOfBreakGlass)).toHaveBeenCalledWith({
      to: 'margaret@example.com',
      personName: 'Aunt Jo',
      personType: 'verifier',
    });
  });

  it('still redeems when the owner cannot be emailed — they are mid-emergency', async () => {
    // Alerting is allowed to fail (principle 5). The audit entry is the durable
    // record; a mail outage must not strand somebody trying to get in.
    rows([CODE_ROW], [ROSTER_OK], [], [{ email: 'aunt@example.com' }], [], [
      { name: 'Aunt Jo', email: 'margaret@example.com' },
    ]);
    vi.mocked(notifyOwnerOfBreakGlass).mockRejectedValueOnce(new Error('resend down'));

    await expect(redeemBreakGlass({ code: 'ABCD2345EFGH' })).resolves.toMatchObject({
      personId: 'ver-1',
    });
  });

  it('REFUSES a revoked person — revocation outranks a code in a drawer', async () => {
    // The hole this closes, found 2026-08-12 while building the redeem endpoint:
    // nothing retires a break-glass code when an owner revokes somebody, and this
    // function did not read `standby_state`. A revoked contact — plausibly the
    // controlling household member of Risk 3, who is exactly who an owner removes
    // in a hurry — could redeem a year-old code and set themselves back to
    // `claimed`. A bearer credential that survives revocation makes revocation
    // decorative.
    rows([CODE_ROW], [{ standby_state: 'revoked' }]);

    await expect(redeemBreakGlass({ code: 'ABCD2345EFGH' })).rejects.toBeInstanceOf(ValidationError);

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('claimed_user_id = $1');
  });

  it('does NOT burn the code when it refuses a revoked person', async () => {
    // Otherwise one attempt against a revoked row would destroy a legitimate
    // holder's only way in. The attempt budget is what bounds repetition.
    rows([CODE_ROW], [{ standby_state: 'revoked' }]);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' }).catch(() => undefined);

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('used_at = now()');
  });

  it('refuses when the roster row is gone — there is nothing left to bind to', async () => {
    rows([CODE_ROW], []);
    await expect(redeemBreakGlass({ code: 'ABCD2345EFGH' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a revoked person with the SAME words as an unknown code', async () => {
    // Distinguishable refusals would let someone probe which codes were real and
    // which people had been removed.
    const refusal = async (code: string): Promise<ValidationError> => {
      try {
        await redeemBreakGlass({ code });
        throw new Error('expected a refusal');
      } catch (e) {
        return e as ValidationError;
      }
    };

    rows([CODE_ROW], [{ standby_state: 'revoked' }]);
    const revoked = await refusal('ABCD2345EFGH');

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const unknown = await refusal('NOPENOPENOPE');

    expect(revoked.message).toBe(unknown.message);
  });

  it('refuses unknown, expired and already-used identically', async () => {
    rows([]); // all three are filtered in SQL
    await expect(redeemBreakGlass({ code: 'NOPENOPENOPE' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses once the attempt budget is spent, without binding anything', async () => {
    rows([{ ...CODE_ROW, failed_attempts: 10 }]);

    await expect(redeemBreakGlass({ code: 'ABCD2345EFGH' })).rejects.toBeInstanceOf(ValidationError);

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('claimed_user_id = $1');
  });
});
