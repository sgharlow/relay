/**
 * The outbound-mail ceiling, and the reasons it has the shape it does.
 *
 * 🔴 WHAT THIS BOUNDS. Until 2026-08-13 an authenticated free account could name
 * unlimited verifiers and invite each of them without limit, so the product was
 * a relay: attacker-chosen recipients, attacker-chosen subject (the display
 * name) and attacker-chosen opening line (the contact name), sent from a domain
 * with real reputation on a Resend account shared with another project.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  reserveInviteEmail,
  inviteEmailsToday,
  InviteBudgetError,
  INVITE_EMAIL_ACTION,
  INVITE_EMAIL_DAILY_LIMIT,
} from './invite-budget';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

function used(n: number) {
  mockQuery.mockResolvedValueOnce({ rows: [{ n: String(n) }] } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reserveInviteEmail', () => {
  it('allows a send below the ceiling and records it', async () => {
    used(0);
    await expect(reserveInviteEmail('owner-1')).resolves.toBeUndefined();
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][1]).toMatchObject({ action: INVITE_EMAIL_ACTION });
  });

  it('refuses the send that would exceed the ceiling', async () => {
    used(INVITE_EMAIL_DAILY_LIMIT);
    await expect(reserveInviteEmail('owner-1')).rejects.toBeInstanceOf(InviteBudgetError);
  });

  it('allows exactly the last one under the ceiling', async () => {
    // Off-by-one matters here in the direction of refusing a legitimate owner
    // mid-setup, which is the failure a family would actually meet.
    used(INVITE_EMAIL_DAILY_LIMIT - 1);
    await expect(reserveInviteEmail('owner-1')).resolves.toBeUndefined();
  });

  /*
    THE RESERVATION IS THE AUDIT WRITE, so a refusal must not record one — a
    meter that ticks on refusal would lock an owner out for a day after a single
    burst, and would misreport how much mail was actually sent on their behalf.
  */
  it('records nothing when it refuses', async () => {
    used(INVITE_EMAIL_DAILY_LIMIT);
    await expect(reserveInviteEmail('owner-1')).rejects.toThrow();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('counts only this owner, only invitation emails, only the last 24 hours', async () => {
    used(3);
    await inviteEmailsToday('owner-1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM audit_log/i);
    expect(sql).toContain("INTERVAL '24 hours'");
    expect(sql).toMatch(/owner_id = \$1/);
    expect(params).toEqual(['owner-1', INVITE_EMAIL_ACTION]);
  });

  /*
    A ceiling an owner cannot understand is a bug report. It must say that the
    people they named are unaffected — the alarming reading of "we could not send
    your invitations" is that somebody was dropped from the circle.
  */
  it('explains the limit without implying anyone was removed', async () => {
    used(INVITE_EMAIL_DAILY_LIMIT);
    const err = await reserveInviteEmail('owner-1').catch((e: InviteBudgetError) => e);

    expect(err).toBeInstanceOf(InviteBudgetError);
    expect((err as InviteBudgetError).message).toMatch(/nobody has been removed/i);
    expect((err as InviteBudgetError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('uses a distinct action from the AI meter, so the two cannot consume each other', async () => {
    // Both meters count rows in audit_log. Sharing an action string would make
    // sorting a vault eat an owner's invitation budget.
    expect(INVITE_EMAIL_ACTION).not.toBe('ai_intake');
  });
});
