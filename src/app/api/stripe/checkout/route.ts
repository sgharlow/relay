/**
 * POST /api/stripe/checkout — start a subscription.
 *
 * Owner-authenticated, unlike report-bridge's equivalent, because Relay has no
 * pre-signup purchase path: you build a vault first and pay to keep it. That
 * also means the owner id can be carried in metadata, so the webhook never has
 * to match on an email address the customer may have typed differently.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R1
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { getStripe, RELAY_PLAN, billingConfigured } from '../../../../../lib/billing/stripe';
import { query } from '../../../../../lib/db/connection';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://relaystandby.com';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  if (!billingConfigured()) {
    return NextResponse.json(
      { error: 'BillingUnavailable', message: 'Checkout is not set up yet.' },
      { status: 503 },
    );
  }

  const { allowed } = rateLimit(clientKey(req.headers, 'checkout'), 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'RateLimited', message: 'Please wait a moment.' }, { status: 429 });
  }

  const owner = await query<{ email: string; display_name: string | null }>(
    `SELECT email, display_name FROM users WHERE id = $1 LIMIT 1`,
    [auth.ownerId],
  );

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: RELAY_PLAN.priceId, quantity: 1 }],
    ...(owner.rows[0]?.email ? { customer_email: owner.rows[0].email } : {}),
    // owner_id, not email: the webhook must never depend on matching a string
    // the customer could have typed differently at checkout.
    metadata: { owner_id: auth.ownerId, plan: RELAY_PLAN.slug },
    subscription_data: { metadata: { owner_id: auth.ownerId } },
    success_url: `${siteUrl()}/vault?checkout=success`,
    cancel_url: `${siteUrl()}/start?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
