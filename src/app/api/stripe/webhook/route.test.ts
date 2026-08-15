/**
 * Tests for POST /api/stripe/webhook — what gets recorded about the money.
 *
 * 🔴 WHY THIS FILE EXISTS. The subscription INSERT hardcoded the price:
 *
 *     VALUES ($1, $2, $3, 11900, $4, $5, $6)
 *
 * — a second definition of the product's price, written as a SQL literal, in
 * the one place that records what a customer was actually charged.
 *
 * That is not untidiness, and it is about to matter. `PriceCard.tsx` reads
 * `NEXT_PUBLIC_PRICE_YEARLY_USD` at runtime, deliberately: "Runtime-configurable
 * so a price test does not require a deploy (J1-R8)." G1 is a price test — the
 * gate is "click-to-intent AT A REAL PRICE POINT". So the intended, imminent
 * operation is showing somebody a different price, charging it through Stripe,
 * and recording `11900` against it. Every row would agree with each other and
 * with nothing that happened.
 *
 * The fix is not a shared constant. Stripe already tells us what it charged —
 * `amount_total` on the session, `unit_amount` on the subscription's price — so
 * the row records the authority rather than a guess. That is the same move this
 * handler already makes for status: "Re-reading the subscription from Stripe at
 * handling time makes the question disappear instead… idempotent by
 * construction rather than by discipline."
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const constructEvent = vi.fn();
vi.mock('../../../../../lib/billing/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent }, subscriptions: { retrieve: vi.fn() } }),
}));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../../../../../lib/db/connection';
import { PRICE_YEARLY_CENTS } from '../../../../../lib/offer';
import { POST } from './route';

const mockQuery = vi.mocked(query);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    body: '{}',
  });
}

/** No existing subscription row → the handler takes the INSERT path. */
function noExistingRow() {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/^\s*SELECT id FROM subscriptions/.test(sql)) return { rows: [], rowCount: 0 } as never;
    return { rows: [], rowCount: 0 } as never;
  });
}

/** The parameters of the INSERT the handler issued. */
function insertCall() {
  return mockQuery.mock.calls.find(([sql]) => /INSERT INTO subscriptions/.test(String(sql)));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  noExistingRow();
});

describe('what the subscription row records about the money', () => {
  it('records the amount STRIPE charged, not the list price', async () => {
    // The price-test case: the customer was shown and charged $99.
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { owner_id: OWNER },
          amount_total: 9900,
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      },
    });

    await POST(req());

    const call = insertCall();
    expect(call, 'no INSERT was issued').toBeTruthy();
    const [sql, params] = call as [string, unknown[]];

    // The amount must be a bound parameter, never a literal in the statement.
    expect(sql).not.toMatch(/\b11900\b/);
    expect(params, `params were ${JSON.stringify(params)}`).toContain(9900);
  });

  it('falls back to the product price when Stripe sends no amount', async () => {
    // Some sessions carry no total. Recording nothing would be worse than
    // recording the list price, but it must come from the one definition.
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { metadata: { owner_id: OWNER }, amount_total: null, customer: 'cus_1' } },
    });

    await POST(req());

    const [, params] = insertCall() as [string, unknown[]];
    expect(params).toContain(PRICE_YEARLY_CENTS);
  });

  it('records the subscription’s own unit_amount on a subscription event', async () => {
    constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          metadata: { owner_id: OWNER },
          items: { data: [{ price: { unit_amount: 8900 } }] },
        },
      },
    });

    await POST(req());

    const call = insertCall();
    if (call) {
      const [, params] = call as [string, unknown[]];
      expect(params).toContain(8900);
    }
  });
});
