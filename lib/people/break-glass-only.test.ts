/**
 * Tests for the documented exclusion (§8.1).
 *
 * §8.1 asked whether a break-glass-only contact is COVERED or a DOCUMENTED
 * EXCLUSION, and left it open. Ruled 2026-08-12: exclusion. The mechanism was
 * already true — quorum counts `confirmed`, and such a person never claims — so
 * what these pin is the HONESTY layer: the owner can record the choice, and the
 * record cannot outlive its reason.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { setBreakGlassOnly } from './break-glass-only';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

const OWNER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

function personIn(state: string | null) {
  mockQuery.mockResolvedValueOnce({ rows: [{ standby_state: state }], rowCount: 1 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('setBreakGlassOnly', () => {
  it('records the choice for somebody who has not claimed', async () => {
    personIn('invited');

    await setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'verifier', value: true });

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).toContain('UPDATE verifiers SET break_glass_only');
  });

  it('REFUSES somebody who has already claimed', async () => {
    // They demonstrably can hold an account, so the marker would record a
    // falsehood — and it would exclude a person who is able to act.
    personIn('claimed');

    await expect(
      setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'verifier', value: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('REFUSES somebody confirmed — the strongest version of the same case', async () => {
    personIn('confirmed');

    await expect(
      setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'recipient', value: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('REFUSES a revoked person, and says what to do instead', async () => {
    personIn('revoked');

    await expect(
      setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'verifier', value: true }),
    ).rejects.toThrow(/removed that person/i);
  });

  it('refuses a person who is not on this owner’s list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'verifier', value: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows UNDOING the mark whatever state they are in', async () => {
    // Undo must never be blocked: the guard exists to stop a false record being
    // created, not to trap somebody inside one.
    personIn('claimed');

    await setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'verifier', value: false });

    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).toContain('UPDATE verifiers SET break_glass_only');
  });

  it('writes it to the owner’s audit chain as a decision they made', async () => {
    personIn('invited');

    await setBreakGlassOnly({ ownerId: OWNER, personId: PERSON, personType: 'recipient', value: true });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ action: 'standby_marked_break_glass_only' }),
    );
  });
});
