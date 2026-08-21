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

  it('clears the confirmations that can only be reached THROUGH release_state, first', async () => {
    /*
      🔴 verifier_confirmations is keyed on release_state_id and nothing else
      (001_initial.sql) — there is no owner_id to filter on. So it had to be
      reached through release_state, and release_state was the FIRST thing
      deleted, after which those rows are unreachable by any query this product
      can write. Every account closed through DELETE /api/account left its
      verifier attestations on the cluster, including the four purged on
      2026-08-18.

      The fixture scripts knew better than the product: reset-demo.ts and
      family-arc.ts both clear them with this exact subquery before dropping
      release_state.
    */
    await deleteAccount('owner-1');
    const sql = sqlIssued();

    const confirmations = sql.findIndex((s) => /DELETE FROM verifier_confirmations/i.test(s));
    const releaseState = sql.findIndex((s) => /DELETE FROM release_state/i.test(s));

    expect(confirmations, 'verifier_confirmations is never cleared').toBeGreaterThanOrEqual(0);
    expect(sql[confirmations]).toMatch(/release_state_id IN \(SELECT id FROM release_state WHERE owner_id/i);
    expect(
      confirmations < releaseState,
      'release_state is deleted first, which makes the confirmation rows unreachable forever',
    ).toBe(true);
  });

  it('clears the access codes, consent artifacts and auth challenges the account issued', async () => {
    /*
      Each of these was left behind, and each is a live credential or a record
      the privacy page says goes:
        recipient_codes  — an access-code hash, the higher-value of the two code
                           types (it opens the vault rather than asking a
                           question). verifier_codes was cleared; this was not.
        consent_artifacts — no owner_id, so it has to be reached through the
                           delegations row that points at it, BEFORE that row is
                           deleted.
        auth_challenges  — unspent WebAuthn/step-up nonces for a user who no
                           longer exists.
    */
    await deleteAccount('owner-1');
    const sql = sqlIssued();

    expect(sql.some((s) => /DELETE FROM recipient_codes WHERE owner_id/i.test(s))).toBe(true);
    expect(sql.some((s) => /DELETE FROM auth_challenges WHERE user_id/i.test(s))).toBe(true);

    const consent = sql.findIndex((s) => /DELETE FROM consent_artifacts/i.test(s));
    const delegations = sql.findIndex((s) => /DELETE FROM delegations/i.test(s));
    expect(consent, 'consent_artifacts is never cleared').toBeGreaterThanOrEqual(0);
    expect(
      consent < delegations,
      'the delegations row is the only pointer to the consent artifact; deleting it first orphans the artifact',
    ).toBe(true);
  });

  it('aborts before deleting the users row when a delete FAILS rather than being absent', async () => {
    /*
      🔴 The catch around the optional deletes was unconditional — `catch { }`
      with the comment "table absent in this deployment". A 40001 serialization
      failure, a 42501 permission denial of the 031/032 class, or a dropped
      connection was swallowed exactly like a missing table, and then
      `DELETE FROM users` ran anyway. The API returned 200 with a report that
      never counted those tables, and no retry was possible because the owner
      was gone.

      Half-deleted is the one state with no recovery, which is the same
      discipline the Stripe cancellation and the resign step already follow.
    */
    query.mockImplementation(async (sql: string) => {
      if (/DELETE FROM break_glass_codes/i.test(sql)) {
        throw Object.assign(new Error('permission denied for table break_glass_codes'), { code: '42501' });
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAccount('owner-1')).rejects.toThrow(/permission denied/);

    expect(
      sqlIssued().some((s) => /DELETE FROM users/i.test(s)),
      'the users row went while a bearer credential survived — the account cannot be retried',
    ).toBe(false);
  });

  it('still closes the account when an optional table is absent from this deployment', async () => {
    // The one error that IS tolerated, and the only one: 42P01, relation does
    // not exist. Narrowed the way signin-attempts.ts and csp-report-store.ts
    // narrow theirs, rather than by swallowing everything.
    query.mockImplementation(async (sql: string) => {
      if (/DELETE FROM recipient_codes/i.test(sql)) {
        throw Object.assign(new Error('relation "recipient_codes" does not exist'), { code: '42P01' });
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAccount('owner-1')).resolves.toBeTruthy();
    expect(sqlIssued().some((s) => /DELETE FROM users/i.test(s))).toBe(true);
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
