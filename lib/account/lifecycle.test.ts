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

vi.mock('../db/connection', () => ({ query: (...a: unknown[]) => query(...a) }));
vi.mock('../audit/audit-service', () => ({
  writeAuditEntry: (...a: unknown[]) => writeAuditEntry(...a),
}));
vi.mock('../billing/cancellation', () => ({
  cancelSubscriptionForOwner: (...a: unknown[]) => cancelSubscriptionForOwner(...a),
}));

import { deleteAccount } from './lifecycle';

/** Every SQL statement the call issued, in order. */
const sqlIssued = (): string[] =>
  query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ n: '0' }], rowCount: 0 });
  writeAuditEntry.mockReset().mockResolvedValue(undefined);
  cancelSubscriptionForOwner.mockReset().mockResolvedValue({ cancelled: true });
});

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
});
