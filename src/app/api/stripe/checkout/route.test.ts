/**
 * Tests for POST /api/stripe/checkout — the route that takes money.
 *
 * 🔴 THIS ROUTE HAD NO TESTS AT ALL until 2026-08-21, which is how the defect
 * below survived: it authenticated, rate-limited, and then created a Checkout
 * Session without ever asking whether the caller was already paying.
 *
 * A paying owner who revisited `/start` — or pressed the button twice across
 * two page loads, which the once-per-load memo in `lib/analytics/lane-b.ts`
 * cannot see — could be charged $119 a second time. And the damage did not stop
 * at the double charge. The session was created with `customer_email`, so
 * Stripe MINTS A NEW CUSTOMER each time; the webhook's UPDATE then overwrites
 * `stripe_customer_id` and `stripe_subscription_id` with the new pair
 * (`COALESCE($4, …)` keeps the old value only when the new one is null). The
 * first subscription's identifiers are then gone from the only row that pointed
 * at them, so:
 *
 *   - `POST /api/stripe/portal` opens the portal for the SECOND customer, and
 *     the first subscription is not listed there to cancel;
 *   - `lib/billing/cancellation.ts` cancels the one recorded id, so closing the
 *     account leaves the first one billing annually — the exact outcome its own
 *     header calls the worst available ("your data is gone AND you are still
 *     paying");
 *   - `/terms` promises "Closing your account cancels the subscription too",
 *     which would have become false without anything in the product saying so.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { NextResponse, type NextRequest } from 'next/server';

import { getOwnerSession } from '../../../../../lib/auth/session';
import { query } from '../../../../../lib/db/connection';
import { _setStripeForTesting } from '../../../../../lib/billing/stripe';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);

/** The arguments the route handed to Stripe, or null if it never got there. */
let sessionArgs: Record<string, unknown> | null = null;

function stubCheckout(url = 'https://checkout.stripe.com/c/pay/cs_live_x') {
  sessionArgs = null;
  _setStripeForTesting({
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          sessionArgs = args;
          return { url };
        },
      },
    },
  } as never);
}

/**
 * A fresh client key per test.
 *
 * `rateLimit` keeps per-instance memory keyed on the forwarded-for header, and
 * the route allows five presses a minute — so a shared key would make the sixth
 * test in this file fail for a reason belonging to the first.
 */
let keySeq = 0;
function req(): NextRequest {
  keySeq += 1;
  return new Request('https://relaystandby.com/api/stripe/checkout', {
    method: 'POST',
    headers: { 'x-forwarded-for': `203.0.113.${keySeq}` },
  }) as unknown as NextRequest;
}

/** The owner's user row, their subscription row, and how full their vault is. */
function rows(
  subscription: Record<string, unknown> | null,
  opts: { email?: string | null; items?: number } = {},
) {
  const { email = 'owner@example.org', items = 8 } = opts;
  mockQuery.mockImplementation(async (sql: string) => {
    if (/FROM users/.test(sql)) {
      return email
        ? ({ rows: [{ email, display_name: null }], rowCount: 1 } as never)
        : ({ rows: [], rowCount: 0 } as never);
    }
    if (/FROM subscriptions/.test(sql)) {
      return subscription
        ? ({ rows: [subscription], rowCount: 1 } as never)
        : ({ rows: [], rowCount: 0 } as never);
    }
    if (/FROM vault_items/.test(sql)) {
      return { rows: [{ count: String(items) }], rowCount: 1 } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _setStripeForTesting(null);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_RELAY_ANNUAL = 'price_x';
  mockSession.mockResolvedValue({ ownerId: 'owner-1' } as never);
  rows(null);
  stubCheckout();
});

describe('POST /api/stripe/checkout', () => {
  it('refuses an unauthenticated caller', async () => {
    // getOwnerSession THROWS a 401 NextResponse rather than returning null.
    mockSession.mockRejectedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(sessionArgs, 'no session may be created for a stranger').toBeNull();
  });

  it('returns a checkout URL for a free owner', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' });
  });

  it('carries the owner id in metadata, never an email, for the webhook to match on', async () => {
    await POST(req());
    expect(sessionArgs).toMatchObject({ metadata: { owner_id: 'owner-1' } });
    expect(sessionArgs).toMatchObject({ subscription_data: { metadata: { owner_id: 'owner-1' } } });
  });

  it('reports unavailable rather than crashing when billing is unconfigured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await POST(req());
    expect(res.status).toBe(503);
  });
});

describe('an owner who is already paying cannot be charged twice', () => {
  it('refuses with 409 when an active paid subscription is on record', async () => {
    rows({
      tier: 'paid',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
    }, {});

    const res = await POST(req());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'AlreadySubscribed' });
    expect(sessionArgs, 'no second Checkout Session may be opened').toBeNull();
  });

  /*
    A CANCELLED SUBSCRIBER MUST BE ABLE TO COME BACK. The row survives
    cancellation carrying both Stripe ids, so a guard that keyed on "has a
    stripe_subscription_id" would lock a former customer out of paying again —
    turning a double-charge bug into a cannot-buy bug, which is worse.
  */
  it('lets a cancelled owner subscribe again', async () => {
    rows({
      tier: 'free',
      status: 'cancelled',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_old',
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(sessionArgs).not.toBeNull();
  });

  /*
    🔴 AND A COMPED FAMILY MUST BE ABLE TO PAY. A founding-family grant writes
    tier=paid, status=active and NO Stripe identifiers
    (`scripts/grant-founding-tier.ts`). A guard reading only tier and status
    would refuse them checkout — and that conversion, a hand-onboarded family
    choosing at arm's length to pay, is the single piece of evidence
    `g1-arms-length-demand` is waiting for. The guard therefore requires a real
    Stripe subscription id, not merely a paid-looking row.
  */
  it('lets a COMPED owner buy a real subscription', async () => {
    rows({
      tier: 'paid',
      status: 'active',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(sessionArgs).not.toBeNull();
  });
});

describe('one Stripe customer per owner', () => {
  /*
    `customer_email` asks Stripe to CREATE a customer. Every checkout a returning
    owner starts would mint another one, scattering their invoice history across
    customers the portal cannot show together — and the portal opens exactly one.
    When we already know their customer, we name it.
  */
  it('reuses the recorded customer instead of minting a new one', async () => {
    rows({
      tier: 'free',
      status: 'cancelled',
      stripe_customer_id: 'cus_known',
      stripe_subscription_id: 'sub_old',
    });

    await POST(req());

    expect(sessionArgs).toMatchObject({ customer: 'cus_known' });
    // Stripe rejects a session carrying both. Sending both would 400 the
    // purchase outright, which is why this is asserted rather than assumed.
    expect(sessionArgs).not.toHaveProperty('customer_email');
  });

  it('falls back to the email when no customer has ever been recorded', async () => {
    rows(null);

    await POST(req());

    expect(sessionArgs).toMatchObject({ customer_email: 'owner@example.org' });
    expect(sessionArgs).not.toHaveProperty('customer');
  });
});

describe('where a new subscriber lands after paying', () => {
  /*
    🔴 THE BUY-INTENT PATH PAID FIRST AND LANDED ON "Nothing here yet."
    `/caregivers/interest` links `/auth/signup?next=checkout`, and
    `SignUpForm` posts to this route straight after the recovery codes — before
    any vault exists. `success_url` was unconditionally `/vault?checkout=success`,
    so somebody handed over $119 and arrived at an empty dashboard. J1 step 8
    names that exact state as the thing not to do: "lands directly in the setup
    wizard (J2), never on a dashboard with nothing on it."

    The destination is decided HERE, at session creation, rather than by a
    redirect on arrival: the webhook and the browser race after checkout, so a
    page that decided by reading entitlement could read it before the webhook
    landed. The vault count is a fact about the owner that no race can change.
  */
  it('sends a buyer with an empty vault into the setup flow, not the dashboard', async () => {
    rows(null, { items: 0 });

    await POST(req());

    expect(sessionArgs?.success_url).toMatch(/\/start\?checkout=success/);
  });

  it('sends a buyer who already seeded a vault to that vault', async () => {
    rows(null, { items: 8 });

    await POST(req());

    expect(sessionArgs?.success_url).toMatch(/\/vault\?checkout=success/);
  });

  it('cancelling returns to the price surface, not to a dead end', async () => {
    rows(null, { items: 8 });

    await POST(req());

    expect(sessionArgs?.cancel_url).toMatch(/\/start\?checkout=cancelled/);
  });
});
