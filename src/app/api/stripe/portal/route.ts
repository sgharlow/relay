/**
 * POST /api/stripe/portal — manage or cancel a subscription.
 *
 * Closes a real gap: a paying subscriber had no way to stop paying. Cancelling
 * existed only as something done by hand in the Stripe dashboard, which is not
 * a product feature — and for an open self-serve beta driven by ads, "email us
 * to cancel" is a support burden and, under click-to-cancel rules, not an
 * adequate mechanism.
 *
 * Stripe's hosted portal rather than a bespoke cancel button: card updates,
 * invoice history and cancellation are things Stripe already does correctly,
 * and none of them are worth reimplementing against an account shared with two
 * other products.
 *
 * The customer id comes from the signed-in owner's own row and never from the
 * request body — on a shared account, a caller-supplied customer id would be a
 * cross-product account-takeover.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R2
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { getStripe, billingConfigured } from '../../../../../lib/billing/stripe';
import { query } from '../../../../../lib/db/connection';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://relaystandby.com';
}

export async function POST(_req: Request): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const row = await query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM subscriptions
     WHERE owner_id = $1 AND stripe_customer_id IS NOT NULL
     LIMIT 1`,
    [auth.ownerId],
  );

  const customer = row.rows[0]?.stripe_customer_id;
  // Someone who never paid clicking a billing link deserves a plain answer,
  // not an error page.
  if (!customer) {
    return NextResponse.json(
      { error: 'NoSubscription', message: 'There is no subscription to manage on this account.' },
      { status: 404 },
    );
  }

  if (!billingConfigured()) {
    return NextResponse.json(
      { error: 'BillingUnavailable', message: 'Billing is not available right now.' },
      { status: 503 },
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${siteUrl()}/account`,
  });

  return NextResponse.json({ url: session.url });
}
