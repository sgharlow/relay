/**
 * Cancelling a subscription at Stripe.
 *
 * This closes a defect rather than adding a feature: nothing in the product
 * could cancel a Stripe subscription. `deleteAccount` removed the local
 * subscriptions row and the user record, and left the card being charged
 * annually with no account to sign in to and no button anywhere. The local row
 * was never the thing charging the customer — Stripe was.
 *
 * The rule this module exists to enforce: the worst available outcome is "your
 * data is gone AND you are still paying". So cancellation happens at Stripe
 * FIRST, and a failure here is loud. The caller aborts on it.
 *
 * ⚠️ The Stripe account is SHARED with report-bridge and skillcrossroads. This
 * cancels one subscription by its recorded id and nothing else — it never
 * enumerates, never cancels by customer, and never touches another product's
 * objects.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R2
 */

import { query } from '../db/connection';

import { getStripe, billingConfigured } from './stripe';

export interface CancellationResult {
  /** True when the subscription is, as of this call, not going to bill again. */
  cancelled: boolean;
  /** Why, when the answer needs qualifying. */
  reason?: 'no-subscription' | 'already-cancelled';
}

/** Stripe's shape for "that object isn't there". */
function isMissingAtStripe(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return e?.statusCode === 404 || e?.code === 'resource_missing';
}

export async function cancelSubscriptionForOwner(ownerId: string): Promise<CancellationResult> {
  const row = await query<{ stripe_subscription_id: string | null }>(
    `SELECT stripe_subscription_id FROM subscriptions
     WHERE owner_id = $1 AND stripe_subscription_id IS NOT NULL
     LIMIT 1`,
    [ownerId],
  );

  const subscriptionId = row.rows[0]?.stripe_subscription_id;
  // Free-tier accounts close too, and most accounts are free. Nothing to do is
  // not a failure.
  if (!subscriptionId) return { cancelled: false, reason: 'no-subscription' };

  // There is a subscription to cancel and no way to cancel it. Saying
  // "cancelled" here would let a deletion proceed on a false assurance, which
  // is precisely the bug being fixed.
  if (!billingConfigured()) {
    throw new Error(
      'Billing is not configured, so this subscription cannot be cancelled. ' +
        'Refusing to report success — cancel it in the Stripe dashboard first.',
    );
  }

  try {
    await getStripe().subscriptions.cancel(subscriptionId);
    return { cancelled: true };
  } catch (err) {
    // Cancelling in the dashboard and then closing the account is a real
    // sequence. Stripe 404s on the second attempt, and that is the end state
    // we wanted — not a reason to block someone from leaving.
    if (isMissingAtStripe(err)) return { cancelled: true, reason: 'already-cancelled' };
    throw err;
  }
}
