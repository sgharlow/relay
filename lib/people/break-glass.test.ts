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

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
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
    rows([CODE_ROW], [], [{ email: 'aunt@example.com' }], []);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    const burn = mockQuery.mock.calls[1];
    expect(String(burn[0])).toContain('used_at = now()');
  });

  it('drops the person to CLAIMED, never confirmed — the owner must re-verify', async () => {
    rows([CODE_ROW], [], [{ email: 'aunt@example.com' }], []);

    await redeemBreakGlass({ code: 'ABCD2345EFGH' });

    const bind = String(mockQuery.mock.calls.at(-1)?.[0]);
    expect(bind).toContain("standby_state = 'claimed'");
    expect(bind).not.toContain("'confirmed'");
    expect(bind).toContain('fingerprint_confirmed_at = NULL');
  });

  it('makes noise: a distinct action that flags re-confirmation is needed', async () => {
    rows([CODE_ROW], [], [{ email: 'aunt@example.com' }], []);

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
    rows([CODE_ROW], [], []);

    const out = await redeemBreakGlass({ code: 'ABCD2345EFGH', existingUserId: 'user-77' });

    expect(out.userId).toBe('user-77');
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).not.toContain('INSERT INTO users');
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
