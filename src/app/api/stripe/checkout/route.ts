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

/**
 * Where somebody lands after paying.
 *
 * 🔴 IT WAS UNCONDITIONALLY `/vault`, AND ONE OF THE TWO BUY PATHS ARRIVES WITH
 * AN EMPTY VAULT. `/caregivers/interest` links `/auth/signup?next=checkout`, and
 * `SignUpForm` posts here immediately after the recovery codes — before any item
 * exists. So a visitor who clicked "Set up my vault now — $119/yr" signed up,
 * paid, and was dropped on a dashboard reading *"Nothing here yet."* J1 step 8
 * names precisely that state as the one to avoid: "lands directly in the setup
 * wizard (J2), never on a dashboard with nothing on it."
 *
 * THE DECISION IS MADE HERE, AT SESSION CREATION, and that is the point rather
 * than a convenience. The browser's return from Stripe races the webhook, so a
 * landing page that decided by reading the subscription could easily read it
 * before the webhook had written anything. How many items an owner has is a
 * fact no race can change, and it is already known at the moment the session is
 * built.
 *
 * A failure to count must not fail the purchase — `/vault` is the safe answer
 * for an owner who has a vault, and the seeded path is by far the more common.
 */
async function landingAfterCheckout(ownerId: string): Promise<string> {
  try {
    const r = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM vault_items WHERE owner_id = $1`,
      [ownerId],
    );
    return Number(r.rows[0]?.count ?? '0') === 0 ? '/start' : '/vault';
  } catch {
    return '/vault';
  }
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

  /*
    🔴 THIS ROUTE NEVER ASKED WHETHER THE CALLER WAS ALREADY PAYING, so a
    subscriber who revisited /start could be charged $119 a second time — and
    the second charge was not the worst of it. The session below used to be
    created with `customer_email` unconditionally, which asks Stripe to MINT A
    NEW CUSTOMER; the webhook's UPDATE then overwrote both Stripe ids with the
    new pair, so the FIRST subscription vanished from the only row pointing at
    it. After that, `POST /api/stripe/portal` opens the portal for the second
    customer (the first is not there to cancel) and `lib/billing/cancellation.ts`
    cancels only the recorded id — leaving somebody's account closed, their
    vault deleted, and the first subscription still billing annually. That is
    the outcome cancellation.ts's own header names as the worst available, and
    /terms promises the opposite of it.

    THE GUARD KEYS ON A REAL STRIPE SUBSCRIPTION ID, not on tier alone, and both
    halves of that are deliberate:

      - a CANCELLED owner keeps their ids on the row, so gating on "has an id"
        would lock a former customer out of ever coming back;
      - a COMPED founding family has tier=paid and status=active with NO Stripe
        ids at all (scripts/grant-founding-tier.ts), and their decision to
        actually pay is the one piece of arms-length demand evidence this
        product is waiting for. Refusing them checkout would refuse the sale
        that matters most.
  */
  const sub = await query<{
    tier: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }>(
    `SELECT tier, status, stripe_customer_id, stripe_subscription_id
       FROM subscriptions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [auth.ownerId],
  );
  const row = sub.rows[0];

  if (row?.tier === 'paid' && row.status === 'active' && row.stripe_subscription_id) {
    return NextResponse.json(
      {
        error: 'AlreadySubscribed',
        message: 'You already have a Relay plan. Manage it from your account page.',
        manageAt: '/account',
      },
      { status: 409 },
    );
  }

  /*
    Name the customer we already know, or let Stripe create one — never both.
    Stripe rejects a session carrying `customer` and `customer_email` together,
    so this is an either/or rather than a merge.
  */
  const customerFields = row?.stripe_customer_id
    ? { customer: row.stripe_customer_id }
    : owner.rows[0]?.email
      ? { customer_email: owner.rows[0].email }
      : {};

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: RELAY_PLAN.priceId, quantity: 1 }],
    ...customerFields,
    // owner_id, not email: the webhook must never depend on matching a string
    // the customer could have typed differently at checkout.
    metadata: { owner_id: auth.ownerId, plan: RELAY_PLAN.slug },
    subscription_data: { metadata: { owner_id: auth.ownerId } },
    success_url: `${siteUrl()}${await landingAfterCheckout(auth.ownerId)}?checkout=success`,
    cancel_url: `${siteUrl()}/start?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
