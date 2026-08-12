/**
 * Tests for account export and deletion.
 *
 * Deletion is irreversible and, until now, was untested. The property that
 * matters most is not what it deletes but what it does FIRST: the subscription
 * has to be cancelled at Stripe before any row is removed, because the local
 * subscriptions row was never the thing charging the customer. Get the order
 * wrong and the failure mode is silent and expensive — data gone, card still
 * billed annually, no account left to sign in to.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const writeAuditEntry = vi.fn();
const cancelSubscriptionForOwner = vi.fn();
const resignFromCircle = vi.fn();

vi.mock('../db/connection', () => ({ query: (...a: unknown[]) => query(...a) }));
vi.mock('../audit/audit-service', () => ({
  writeAuditEntry: (...a: unknown[]) => writeAuditEntry(...a),
}));
vi.mock('../billing/cancellation', () => ({
  cancelSubscriptionForOwner: (...a: unknown[]) => cancelSubscriptionForOwner(...a),
}));
vi.mock('../people/resign', () => ({
  resignFromCircle: (...a: unknown[]) => resignFromCircle(...a),
}));

import { deleteAccount } from './lifecycle';

/** Every SQL statement the call issued, in order. */
const sqlIssued = (): string[] =>
  query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());

beforeEach(() => {
  // Empty by default. A blanket one-row answer made the standby-role lookup
  // return a phantom role and call resign with undefined ids — the "unit tests
  // pin phantom objects" trap. Tests that need rows say so explicitly.
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  writeAuditEntry.mockReset().mockResolvedValue(undefined);
  cancelSubscriptionForOwner.mockReset().mockResolvedValue({ cancelled: true });
  resignFromCircle.mockReset().mockResolvedValue({ ownerId: 'other-owner' });
});

/** Make the standby-role lookup return roles this user holds in OTHER circles. */
function standingBy(roles: Array<{ person_id: string; person_type: string }>): void {
  query.mockImplementation(async (sql: string) => {
    if (/FROM recipients WHERE claimed_user_id/i.test(sql)) {
      return { rows: roles, rowCount: roles.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('deleteAccount', () => {
  it('cancels the subscription at Stripe', async () => {
    await deleteAccount('owner-1');
    expect(cancelSubscriptionForOwner).toHaveBeenCalledWith('owner-1');
  });

  it('cancels BEFORE deleting the row that holds the subscription id', async () => {
    // Order is the whole point. Deleting first destroys the only pointer to
    // the Stripe object, making the charge unstoppable from inside the app.
    const order: string[] = [];
    cancelSubscriptionForOwner.mockImplementation(async () => {
      order.push('cancel');
      return { cancelled: true };
    });
    query.mockImplementation(async (sql: string) => {
      if (/DELETE FROM subscriptions/i.test(sql)) order.push('delete-subscriptions');
      return { rows: [{ n: '0' }], rowCount: 0 };
    });

    await deleteAccount('owner-1');

    expect(order).toEqual(['cancel', 'delete-subscriptions']);
  });

  it('deletes nothing when the cancellation fails', async () => {
    // Fail closed. "Your vault is gone and you are still being charged" is
    // strictly worse than "we could not close your account, try again".
    cancelSubscriptionForOwner.mockRejectedValue(new Error('Stripe unavailable'));

    await expect(deleteAccount('owner-1')).rejects.toThrow(/Stripe unavailable/);

    expect(sqlIssued().filter((s) => /^DELETE/i.test(s))).toEqual([]);
  });

  it('still closes a free account that never had a subscription', async () => {
    cancelSubscriptionForOwner.mockResolvedValue({ cancelled: false, reason: 'no-subscription' });

    const report = await deleteAccount('owner-1');

    expect(sqlIssued().some((s) => /DELETE FROM users/i.test(s))).toBe(true);
    expect(report).toBeTruthy();
  });

  it('removes the vault, recipients and verifiers, and retains the audit log', async () => {
    await deleteAccount('owner-1');
    const sql = sqlIssued();
    for (const table of ['vault_items', 'recipients', 'verifiers', 'access_rules', 'users']) {
      expect(sql.some((s) => new RegExp(`DELETE FROM ${table}`, 'i').test(s))).toBe(true);
    }
    // Retained on purpose and stated on the privacy page.
    expect(sql.some((s) => /DELETE FROM audit_log/i.test(s))).toBe(false);
  });

  it('removes emergency codes — a live bearer credential must not outlive the account', async () => {
    // A break-glass code has a one-year life and grants somebody's place once.
    // Found 2026-08-12 while writing the privacy page, which was about to claim
    // these were deleted when they were not.
    await deleteAccount('owner-1');
    expect(sqlIssued().some((s) => /DELETE FROM break_glass_codes/i.test(s))).toBe(true);
  });

  it('removes the passkeys — a public key must not outlive the account', async () => {
    // Proven on production 2026-08-12: webauthn_credentials rows survived the
    // user row. Sign-in still failed safely, but the data was retained against
    // the promise on the privacy page, with nothing left able to delete it.
    await deleteAccount('owner-1');
    expect(sqlIssued().some((s) => /DELETE FROM webauthn_credentials/i.test(s))).toBe(true);
  });

  it('leaves every OTHER circle this person stood by for', async () => {
    // The rows live in other owners' rosters, so `WHERE owner_id = $1` never
    // touched them. Production kept `standby_state = 'claimed'` pointing at a
    // deleted user: the owner is shown a covered circle that is not covered.
    standingBy([{ person_id: 'p-1', person_type: 'recipient' }]);

    const report = await deleteAccount('leaver');

    expect(resignFromCircle).toHaveBeenCalledWith({
      userId: 'leaver',
      personId: 'p-1',
      personType: 'recipient',
    });
    expect(report.standbyRolesReleased).toBe(1);
  });

  it('resigns BEFORE deleting anything, so a failure leaves the account intact', async () => {
    // Same discipline as the Stripe cancellation above: half-deleted is the one
    // state with no recovery. If the other owner's audit write fails, nothing
    // has been destroyed and the user can try again.
    standingBy([{ person_id: 'p-1', person_type: 'recipient' }]);
    resignFromCircle.mockRejectedValue(new Error('audit chain unavailable'));

    await expect(deleteAccount('leaver')).rejects.toThrow(/audit chain unavailable/);

    expect(sqlIssued().filter((s) => /^DELETE/i.test(s))).toEqual([]);
  });

  it('closes an account that stands by for nobody without calling resign', async () => {
    await deleteAccount('owner-1');
    expect(resignFromCircle).not.toHaveBeenCalled();
    expect(sqlIssued().some((s) => /DELETE FROM users/i.test(s))).toBe(true);
  });
});
