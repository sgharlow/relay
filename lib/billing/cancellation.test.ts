/**
 * Tests for subscription cancellation.
 *
 * The defect this closes: nothing in the product could cancel a Stripe
 * subscription. Deleting an account removed the local row and the user, and
 * left the card being charged annually with no account to sign in to. The
 * worst outcome available is "your data is gone AND you are still paying", so
 * the ordering here is deliberate and pinned by test: cancel at Stripe FIRST,
 * and if that fails, the deletion does not happen.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../db/connection', () => ({ query: (...a: unknown[]) => query(...a) }));

import { cancelSubscriptionForOwner } from './cancellation';
import { _setStripeForTesting } from './stripe';

/** Minimal Stripe stand-in — only the surface this module actually touches. */
function stubStripe(cancel: (id: string) => Promise<unknown>) {
  _setStripeForTesting({ subscriptions: { cancel } } as never);
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  _setStripeForTesting(null);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_RELAY_ANNUAL = 'price_x';
});

describe('cancelSubscriptionForOwner', () => {
  it('cancels the subscription recorded for the owner', async () => {
    const cancelled: string[] = [];
    stubStripe(async (id) => {
      cancelled.push(id);
      return { id, status: 'canceled' };
    });
    query.mockResolvedValueOnce({ rows: [{ stripe_subscription_id: 'sub_123' }], rowCount: 1 });

    const result = await cancelSubscriptionForOwner('owner-1');

    expect(cancelled).toEqual(['sub_123']);
    expect(result.cancelled).toBe(true);
  });

  it('is a no-op for an owner who never paid', async () => {
    // The overwhelmingly common case: free-tier accounts close too, and a
    // missing subscription is not an error.
    stubStripe(async () => {
      throw new Error('Stripe must not be called for a free account');
    });
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await cancelSubscriptionForOwner('owner-1');

    expect(result.cancelled).toBe(false);
    expect(result.reason).toBe('no-subscription');
  });

  it('treats an already-cancelled subscription as success', async () => {
    // Cancelling in the Stripe dashboard and then deleting the account is a
    // real sequence. Stripe 404s on the second cancel; that is the desired
    // end state, not a failure, and it must not block the deletion.
    stubStripe(async () => {
      const err = Object.assign(new Error('No such subscription'), {
        statusCode: 404,
        type: 'StripeInvalidRequestError',
      });
      throw err;
    });
    query.mockResolvedValueOnce({ rows: [{ stripe_subscription_id: 'sub_gone' }], rowCount: 1 });

    const result = await cancelSubscriptionForOwner('owner-1');

    expect(result.cancelled).toBe(true);
    expect(result.reason).toBe('already-cancelled');
  });

  it('propagates a real Stripe failure rather than reporting success', async () => {
    // The caller aborts the deletion on this. Swallowing it would produce the
    // exact outcome this module exists to prevent.
    stubStripe(async () => {
      throw Object.assign(new Error('service unavailable'), { statusCode: 503 });
    });
    query.mockResolvedValueOnce({ rows: [{ stripe_subscription_id: 'sub_123' }], rowCount: 1 });

    await expect(cancelSubscriptionForOwner('owner-1')).rejects.toThrow(/service unavailable/);
  });

  it('refuses to claim success when billing is not configured', async () => {
    // A deployment with no Stripe keys must not report "cancelled" — that
    // would let a deletion proceed on a false assurance.
    delete process.env.STRIPE_SECRET_KEY;
    query.mockResolvedValueOnce({ rows: [{ stripe_subscription_id: 'sub_123' }], rowCount: 1 });

    await expect(cancelSubscriptionForOwner('owner-1')).rejects.toThrow(/not.*configured|STRIPE_SECRET_KEY/i);
  });
});
