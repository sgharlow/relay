/**
 * Tests for POST /api/stripe/portal.
 *
 * The gap this closes: a subscriber had no way to stop paying. Cancelling
 * existed only as something done by hand in the Stripe dashboard, which is not
 * a product feature — and for an open self-serve beta driven by ads, "email us
 * to cancel" is both a support burden and, under click-to-cancel rules, not an
 * adequate mechanism.
 *
 * Stripe's hosted portal is the right answer rather than a bespoke cancel
 * button: card updates, invoice history and cancellation are all things Stripe
 * already does correctly, and none of them are worth reimplementing against a
 * shared account.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { NextResponse } from 'next/server';

import { getOwnerSession } from '../../../../../lib/auth/session';
import { query } from '../../../../../lib/db/connection';
import { _setStripeForTesting } from '../../../../../lib/billing/stripe';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);

const req = () => new Request('https://relaystandby.com/api/stripe/portal', { method: 'POST' }) as never;

function stubPortal(create: (args: unknown) => Promise<unknown>) {
  _setStripeForTesting({ billingPortal: { sessions: { create } } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  _setStripeForTesting(null);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_RELAY_ANNUAL = 'price_x';
  mockSession.mockResolvedValue({ ownerId: 'owner-1' } as never);
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('POST /api/stripe/portal', () => {
  it('refuses an unauthenticated caller', async () => {
    // getOwnerSession THROWS a 401 NextResponse rather than returning null —
    // mocking it as null tested the mock, not the route.
    mockSession.mockRejectedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it('returns a portal URL for a subscriber', async () => {
    mockQuery.mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_1' }], rowCount: 1 } as never);
    stubPortal(async () => ({ url: 'https://billing.stripe.com/session/abc' }));

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: 'https://billing.stripe.com/session/abc' });
  });

  it('opens the portal for the caller’s own customer only', async () => {
    // The Stripe account is shared with two other products. The customer id
    // must come from the signed-in owner's row and never from the request.
    mockQuery.mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_mine' }], rowCount: 1 } as never);
    let seen: { customer?: string } = {};
    stubPortal(async (args) => {
      seen = args as { customer?: string };
      return { url: 'https://billing.stripe.com/session/abc' };
    });

    await POST(req());

    expect(seen.customer).toBe('cus_mine');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/owner_id\s*=\s*\$1/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['owner-1']);
  });

  it('tells a free-tier owner there is nothing to manage', async () => {
    // Not a 500. Someone who never paid clicking a billing link should get a
    // plain answer, not an error page.
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'NoSubscription' });
  });

  it('reports unavailable rather than crashing when billing is unconfigured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    mockQuery.mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_1' }], rowCount: 1 } as never);
    const res = await POST(req());
    expect(res.status).toBe(503);
  });
});
