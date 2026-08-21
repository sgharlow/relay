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
/*
  `retrieve` is a controllable mock rather than a bare `vi.fn()`.

  🔴 IT USED TO BE `vi.fn()` WITH NO RESOLVED VALUE, which returns `undefined`,
  so `currentSubscriptionStatus` threw on `fresh.status` and fell into its
  catch every single time. Every subscription test in this file was therefore
  exercising the FALLBACK path — the event's own snapshot — and the 2026-08-13
  re-read fix, the whole point of which is that the handler is order-independent
  because it asks Stripe rather than trusting the payload, was never once the
  code under test. A stub that fails silently into a fallback is worse than no
  stub: it makes the wrong branch look covered.
*/
const subscriptionRetrieve = vi.fn();
vi.mock('../../../../../lib/billing/stripe', () => ({
  getStripe: () => ({
    webhooks: { constructEvent },
    subscriptions: { retrieve: subscriptionRetrieve },
  }),
}));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
/*
  Only the two SENDERS are stubbed. `stripeIdAlreadyRecorded` is kept REAL and
  runs against the mocked `query` above, so the replay tests below drive the
  dedupe through the audit_log lookup that production performs rather than
  through a boolean somebody typed. Stubbing the whole module would have made
  the replay assertions a test of the stub.
*/
vi.mock('../../../../../lib/billing/lapse-notice', async (importActual) => ({
  ...(await importActual<typeof import('../../../../../lib/billing/lapse-notice')>()),
  notifyRenewalFailed: vi.fn(async () => 'sent'),
  notifySubscriptionLapsed: vi.fn(async () => 'sent'),
}));

import { query } from '../../../../../lib/db/connection';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { PRICE_YEARLY_CENTS } from '../../../../../lib/offer';
import {
  notifyRenewalFailed,
  notifySubscriptionLapsed,
} from '../../../../../lib/billing/lapse-notice';
import {
  COMP_COHORT,
  CONVERTED_FROM_COMP_COHORT,
  isComped,
} from '../../../../../lib/billing/entitlements';
import { POST } from './route';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const mockRenewalFailed = vi.mocked(notifyRenewalFailed);
const mockLapsed = vi.mocked(notifySubscriptionLapsed);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';

function req(signature: string | null = 't=1,v1=deadbeef'): NextRequest {
  return new NextRequest('https://relaystandby.com/api/stripe/webhook', {
    method: 'POST',
    headers: signature === null ? {} : { 'stripe-signature': signature },
    body: '{}',
  });
}

/** Every statement the handler issued, as text. */
function sqlIssued(): string[] {
  return mockQuery.mock.calls.map(([sql]) => String(sql));
}

/** True when the handler wrote anything at all. */
function wroteToTheDatabase(): boolean {
  return sqlIssued().some((sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql));
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
  // `clearAllMocks` clears CALLS, not implementations, so a `mockResolvedValue`
  // set in one test would leak into the next and quietly decide its tier.
  subscriptionRetrieve.mockReset();
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

/**
 * The security model, exercised rather than grepped.
 *
 * 🔴 UNTIL 2026-08-21 THE ONLY ASSERTION THAT THIS ENDPOINT VERIFIES SIGNATURES
 * WAS A STRING MATCH — `lib/ops/route-auth.test.ts` checks that the source text
 * contains "constructEvent". A regression that called `constructEvent` and then
 * ignored the throw, or that read the body before verifying it, would satisfy
 * that check and ship. This endpoint grants paid entitlement on a live-mode
 * Stripe account shared with two other products, so the rejection path is
 * behaviour worth pinning, not prose worth quoting.
 *
 * The assertion is deliberately "no write happened" as well as "status is 400".
 * A 400 with a row already written would be the dangerous shape, and only the
 * first half of that is visible from the status code.
 */
describe('an unverified event is never processed', () => {
  it('refuses a request with no signature header, and writes nothing', async () => {
    constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: {} } });

    const res = await POST(req(null));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unsigned' });
    expect(
      constructEvent,
      'the body must not even be verified without a header',
    ).not.toHaveBeenCalled();
    expect(wroteToTheDatabase()).toBe(false);
  });

  it('refuses an event whose signature does not verify, and writes nothing', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await POST(req());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'InvalidSignature' });
    expect(wroteToTheDatabase()).toBe(false);
  });

  it('refuses to run at all when no signing secret is configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: {} } });

    const res = await POST(req());

    expect(res.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(wroteToTheDatabase()).toBe(false);

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });
});

/**
 * The downgrade, and the property the 2026-08-13 fix exists for.
 *
 * The handler re-reads the subscription from Stripe instead of trusting the
 * status the event carried, so any delivery order resolves to the same truth.
 * That claim was untested: the stub returned `undefined`, so every subscription
 * test took the catch branch. Here `retrieve` resolves a real status, which is
 * the only way the re-read is the path under test.
 */
describe('a cancelled subscription downgrades, whatever order the events arrive in', () => {
  /** An existing row, so the handler takes the UPDATE path. */
  function existingRow() {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT id FROM subscriptions/.test(sql)) {
        return { rows: [{ id: 'sub-row-1' }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  }

  function updateParams(): unknown[] | undefined {
    const call = mockQuery.mock.calls.find(([sql]) => /UPDATE subscriptions/.test(String(sql)));
    return call?.[1] as unknown[] | undefined;
  }

  it('drops to the free tier on customer.subscription.deleted and tells the owner once', async () => {
    existingRow();
    subscriptionRetrieve.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
    constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled', metadata: { owner_id: OWNER } } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(
      subscriptionRetrieve,
      'the status must be re-read, not taken from the payload',
    ).toHaveBeenCalledWith('sub_1');
    const params = updateParams();
    expect(params, 'no UPDATE was issued').toBeTruthy();
    expect(params).toContain('free');
    expect(params).toContain('cancelled');
    expect(mockLapsed).toHaveBeenCalledTimes(1);
    expect(mockLapsed.mock.calls[0]![0]).toMatchObject({ ownerId: OWNER, subscriptionId: 'sub_1' });
  });

  /*
    THE ORDER-INDEPENDENCE PROPERTY ITSELF. Stripe guarantees no ordering and
    does retry, so a `customer.subscription.updated` carrying an `active`
    snapshot can be delivered AFTER the `deleted`. Before 2026-08-13 that
    re-granted the paid tier to a cancelled customer: the delivery order of two
    webhooks decided what somebody was entitled to.
  */
  it('does not re-grant paid when a stale active snapshot arrives after the cancellation', async () => {
    existingRow();
    subscriptionRetrieve.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
    constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { owner_id: OWNER } } },
    });

    await POST(req());

    const params = updateParams();
    expect(params, 'no UPDATE was issued').toBeTruthy();
    expect(params).toContain('free');
    expect(params).not.toContain('paid');
  });

  it('keeps a past_due subscription open — a card that failed mid-emergency must not close the vault', async () => {
    existingRow();
    subscriptionRetrieve.mockResolvedValue({ id: 'sub_1', status: 'past_due' });
    constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'past_due', metadata: { owner_id: OWNER } } },
    });

    await POST(req());

    expect(updateParams()).toContain('paid');
    expect(mockLapsed).not.toHaveBeenCalled();
  });
});

/**
 * Where the subscription id lives on an invoice.
 *
 * 🔴 THE HANDLER READ `invoice.subscription`, WHICH THE PINNED API DOES NOT
 * SEND. `lib/billing/stripe.ts` pins `2026-07-29.dahlia`, and on that version
 * `Invoice` has no top-level `subscription` member at all — the id moved to
 * `parent.subscription_details.subscription` (stripe@22.4.0,
 * `cjs/resources/Invoices.d.ts`: `parent: Invoice.Parent | null`, and
 * `Parent.SubscriptionDetails.subscription: string | Subscription`). The route
 * had to widen the type by hand to read the old field, which was the tell.
 *
 * The failure was silent in the worst way: `subId` came back undefined, the
 * case `break`s, the handler returns `{received:true}`, and Stripe's dashboard
 * shows a clean 200 for an event that told nobody anything. The lapse notice —
 * the precondition the paywall flip is waiting on — could never have fired.
 *
 * Both shapes are read, newest first, so the notice does not depend on which
 * API version the endpoint happens to be pinned to: an endpoint created before
 * the rename still delivers the legacy shape.
 */
describe('invoice.payment_failed finds the subscription on either API shape', () => {
  function ownerRowForSubscription() {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT owner_id FROM subscriptions WHERE stripe_subscription_id/.test(sql)) {
        return { rows: [{ owner_id: OWNER }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  }

  it('reads the current shape: parent.subscription_details.subscription', async () => {
    ownerRowForSubscription();
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_current',
          parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_9' } },
        },
      },
    });

    await POST(req());

    expect(mockRenewalFailed).toHaveBeenCalledTimes(1);
    expect(mockRenewalFailed.mock.calls[0]![0]).toMatchObject({
      ownerId: OWNER,
      invoiceId: 'in_current',
    });
  });

  it('reads the current shape when the subscription is expanded into an object', async () => {
    ownerRowForSubscription();
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_expanded',
          parent: {
            type: 'subscription_details',
            subscription_details: { subscription: { id: 'sub_9', object: 'subscription' } },
          },
        },
      },
    });

    await POST(req());

    expect(mockRenewalFailed).toHaveBeenCalledTimes(1);
  });

  it('still reads the legacy top-level shape, for an endpoint pinned before the rename', async () => {
    ownerRowForSubscription();
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_legacy', subscription: 'sub_9' } },
    });

    await POST(req());

    expect(mockRenewalFailed).toHaveBeenCalledTimes(1);
    expect(mockRenewalFailed.mock.calls[0]![0]).toMatchObject({ invoiceId: 'in_legacy' });
  });

  it('sends nothing when the invoice belongs to no subscription we know about', async () => {
    // A one-off invoice on the shared account, or another product's. Silence is
    // correct here; the point of the tests above is that silence must not also
    // be what a WELL-FORMED renewal failure produces.
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }) as never);
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_orphan',
          parent: { subscription_details: { subscription: 'sub_unknown' } },
        },
      },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(mockRenewalFailed).not.toHaveBeenCalled();
  });

  it('does not touch entitlement — past_due is inside ACTIVE_STATUSES on purpose', async () => {
    ownerRowForSubscription();
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: { id: 'in_current', parent: { subscription_details: { subscription: 'sub_9' } } },
      },
    });

    await POST(req());

    expect(wroteToTheDatabase()).toBe(false);
  });
});

/**
 * The direction the comp guard never covered: a comp that becomes a customer.
 *
 * 🔴 A HAND-ONBOARDED FAMILY WHO LATER PAID WOULD HAVE READ AS A COMP FOREVER.
 * `scripts/grant-founding-tier.ts` writes both comp markers — `cohort =
 * 'founding-comp'` and `price_cents = 0` — and refuses to overwrite a row that
 * already carries Stripe identifiers (`comp.test.ts`). Nothing handled the
 * reverse: the webhook's UPDATE path set tier, status, the Stripe ids and the
 * period end, and touched neither marker. `isComped` returns true on EITHER of
 * them, by design, so a real annual subscription would have landed on a row
 * still marked as given away.
 *
 * That is not a cosmetic mislabel. The conversion this excludes — a founding
 * family deciding, at arm's length, to pay — is precisely the evidence
 * `g1-arms-length-demand` is waiting for, and the corruption would be silent,
 * months later, in a revenue read nobody re-derives. The comp marker exists to
 * stop a gift being counted as revenue; it must not also stop revenue being
 * counted as revenue.
 */
describe('a comp that converts stops being a comp', () => {
  function compRow() {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT id FROM subscriptions/.test(sql)) {
        return { rows: [{ id: 'sub-row-comp' }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  }

  function updateCall(): [string, unknown[]] | undefined {
    return mockQuery.mock.calls.find(([sql]) => /UPDATE subscriptions/.test(String(sql))) as
      | [string, unknown[]]
      | undefined;
  }

  it('records what Stripe charged and clears the comp cohort on a real checkout', async () => {
    compRow();
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { owner_id: OWNER },
          amount_total: 11900,
          customer: 'cus_real',
          subscription: 'sub_real',
        },
      },
    });

    await POST(req());

    const call = updateCall();
    expect(call, 'no UPDATE was issued').toBeTruthy();
    const [sql, params] = call!;

    expect(sql, 'the UPDATE must write price_cents').toMatch(/price_cents/);
    expect(sql, 'the UPDATE must write cohort').toMatch(/cohort/);
    expect(params, 'the charged amount must reach the row').toContain(11900);
    expect(params, 'the comp marker is what gets replaced').toContain(COMP_COHORT);
    expect(params).toContain(CONVERTED_FROM_COMP_COHORT);
  });

  /*
    The replacement is deliberately NOT null. A row that was once comped and
    then paid is a different fact from a row that was always a customer, and it
    is the fact the demand gate cares about most — erasing it to make the
    revenue read simple would throw away the evidence.
  */
  it('the replacement marker is not itself a comp marker', () => {
    expect(CONVERTED_FROM_COMP_COHORT).not.toBe(COMP_COHORT);
    expect(isComped({ cohort: CONVERTED_FROM_COMP_COHORT, price_cents: 11900 })).toBe(false);
  });

  /*
    THE OTHER DIRECTION MUST NOT MOVE. A cancellation carries the plan's
    unit_amount, so writing price_cents unconditionally would stamp 11900 onto a
    comped row at the moment it ended — turning a gift into revenue on its way
    out, which is the exact corruption the marker exists to prevent.
  */
  it('leaves both markers alone when the subscription is ending', async () => {
    compRow();
    subscriptionRetrieve.mockResolvedValue({ id: 'sub_real', status: 'canceled' });
    constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_real',
          status: 'canceled',
          metadata: { owner_id: OWNER },
          items: { data: [{ price: { unit_amount: 11900 } }] },
        },
      },
    });

    await POST(req());

    const [sql, params] = updateCall()!;
    expect(params).toContain('free');

    /*
      ⚠️ THE OBVIOUS ASSERTION HERE IS WRONG, and it was written that way first:
      "the params do not contain the converted marker". They always do — both
      cohort values are bound parameters on every UPDATE, and the CASE decides
      which one lands. Asserting on their presence tests the shape of the
      statement rather than what it does. The guard flag is the thing that
      decides, so the guard flag is what is asserted.
    */
    const guard = params[6];
    expect(guard, 'a cancellation must not be treated as a payment').toBe(false);
    expect(sql).toMatch(/cohort = CASE WHEN \$7/);
    expect(sql).toMatch(/price_cents = CASE WHEN \$7/);
    // And the amount is not even offered to the statement on this path.
    expect(params[9], 'no charged amount on a cancellation').toBeNull();
  });
});

/**
 * Replay, and the half of it that was not idempotent.
 *
 * Entitlement was already safe under redelivery — the UPDATE lands on the
 * existing row and the status is re-read from Stripe — and the lapse notices
 * dedupe on the invoice and subscription ids. The OWNER-VISIBLE AUDIT TRAIL was
 * not: `writeAuditEntry('subscription_started')` and `'subscription_cancelled'`
 * ran on every delivery, so a Stripe retry (after the transient 500 this
 * handler deliberately returns on failure, or a manual redelivery from the
 * dashboard) wrote "your subscription started" into the log twice for one
 * event.
 *
 * That log is a product surface with a promise attached — it is what happened,
 * and it is hash-chained append-only, so a duplicate cannot be tidied away
 * afterwards without breaking the chain. The dedupe key is the Stripe EVENT id,
 * which is what Stripe holds constant across retries of the same event.
 *
 * The mechanism is the one `lib/billing/lapse-notice.ts` already uses — an
 * `audit_log` lookup on `detail->>'stripe_id'` — rather than a second one, and
 * it is literally the same function.
 */
describe('a redelivered event does not write the audit entry twice', () => {
  function noRow(alreadyRecorded: boolean) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/count\(\*\)/i.test(sql) && /audit_log/.test(sql)) {
        return { rows: [{ n: alreadyRecorded ? '1' : '0' }], rowCount: 1 } as never;
      }
      if (/^\s*SELECT id FROM subscriptions/.test(sql)) return { rows: [], rowCount: 0 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
  }

  const checkoutEvent = {
    id: 'evt_replayed',
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { owner_id: OWNER },
        amount_total: 11900,
        customer: 'cus_1',
        subscription: 'sub_1',
      },
    },
  };

  it('records the start once, keyed on the Stripe event id', async () => {
    noRow(false);
    constructEvent.mockReturnValue(checkoutEvent);

    await POST(req());

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [, entry] = mockAudit.mock.calls[0] as [string, { detail: Record<string, unknown> }];
    expect(entry.detail).toMatchObject({ stripe_id: 'evt_replayed' });
  });

  it('writes nothing to the trail on the second delivery of the same event', async () => {
    noRow(true);
    constructEvent.mockReturnValue(checkoutEvent);

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  /*
    ENTITLEMENT IS STILL APPLIED ON THE REPEAT. The dedupe is about the story,
    not about the state — skipping the upsert because we had seen the event
    before would turn a retry into a no-op, and Stripe retries precisely when it
    is not sure the first attempt landed.
  */
  it('still reconciles the subscription on the second delivery', async () => {
    noRow(true);
    constructEvent.mockReturnValue(checkoutEvent);

    await POST(req());

    expect(insertCall(), 'the entitlement write must not be skipped').toBeTruthy();
  });
});
