/**
 * POST /api/stripe/webhook — subscription state from Stripe.
 *
 * ⚠️ SHARED ACCOUNT. report-bridge and skillcrossroads have their own live
 * endpoints on this same Stripe account. This is a SEPARATE endpoint with its
 * own signing secret; nothing here touches theirs, and the secret is not
 * interchangeable — a Relay endpoint configured with report-bridge's secret
 * would reject every event, so the failure is loud rather than silent.
 *
 * SIGNATURE VERIFICATION IS THE WHOLE SECURITY MODEL. This endpoint grants paid
 * entitlement, so an unverified caller could grant themselves one. The raw body
 * is required for that check, which is why it is read as text and never parsed
 * first.
 *
 * Feature: relay-h0-mvp
 * Requirements: J12-R1
 */

import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { getStripe } from '../../../../../lib/billing/stripe';
import { query } from '../../../../../lib/db/connection';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { COMP_COHORT, CONVERTED_FROM_COMP_COHORT } from '../../../../../lib/billing/entitlements';
import {
  amountsToWrite,
  firstRecordedCents,
  type StripeAmounts,
} from '../../../../../lib/billing/subscription-amount';
import {
  notifyRenewalFailed,
  notifySubscriptionLapsed,
  stripeIdAlreadyRecorded,
} from '../../../../../lib/billing/lapse-notice';

/** Stripe needs the byte-exact body; Next must not pre-parse it. */
export const dynamic = 'force-dynamic';

/**
 * What Stripe says about money on this event, split by what it is evidence of.
 *
 * 🔴 THE AMOUNT USED TO BE THE LITERAL `11900` INSIDE THE INSERT, which made the
 * row recording a payment a restatement of the list price rather than an
 * observation of the payment. `PriceCard.tsx` reads a runtime price override on
 * purpose — "so a price test does not require a deploy (J1-R8)" — and G1's gate
 * is "click-to-intent AT A REAL PRICE POINT", so showing $99, charging $99 and
 * recording $119 was the intended operation meeting a hardcoded number.
 *
 * 🔴 AND THE FIRST FIX FOR THAT COLLAPSED THE TWO READS INTO ONE, which put the
 * same defect back on the UPDATE path: `unit_amount` was returned for every
 * `customer.subscription.updated`, and every active one of those satisfies
 * `recordsPayment`, so the list price overwrote a discounted charge the moment
 * Stripe sent the next subscription event. They are kept apart here because
 * only one of them is evidence that money moved —
 * `lib/billing/subscription-amount.ts` holds the rule and the tests.
 *
 * Stripe is the authority on what moved, so the row records Stripe. This is the
 * same move the status handling below already makes: read the truth at handling
 * time instead of trusting something we carried in.
 */
function amountsOn(event: Stripe.Event): StripeAmounts {
  const o = event.data.object as Partial<Stripe.Checkout.Session> & Partial<Stripe.Subscription>;

  const unit = o.items?.data?.[0]?.price?.unit_amount;

  return {
    paidCents: typeof o.amount_total === 'number' ? o.amount_total : null,
    planCents: typeof unit === 'number' ? unit : null,
  };
}

async function upsertSubscription(params: {
  ownerId: string;
  tier: 'free' | 'paid';
  status: 'active' | 'cancelled';
  /** What this event says about money. See `lib/billing/subscription-amount.ts`. */
  amounts: StripeAmounts;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM subscriptions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [params.ownerId],
  );

  if (existing.rows[0]) {
    /*
      🔴 THE UPDATE USED TO TOUCH NEITHER `cohort` NOR `price_cents`, so a
      comped row that later took a real subscription stayed marked as a gift
      forever — see CONVERTED_FROM_COMP_COHORT in lib/billing/entitlements.ts
      for why that is the most expensive row in the table to mislabel.

      `recordsPayment` means "this row now carries a live paid Stripe
      subscription" — a paid tier plus a subscription id. It deliberately does
      NOT mean "somebody was charged just now", and the first version of this
      fix conflated the two: it bound the event's amount to this flag, and every
      active `customer.subscription.updated` satisfies it, so the plan's list
      price overwrote a discounted charge on the next event Stripe sent.
      `amountsToWrite` now separates the two, and there are two amount slots
      rather than one:

        $10 — observed. Overwrites `price_cents` outright. Null unless somebody
              was seen paying, so a price list can never displace a charge.
        $11 — the gift-clearing amount. Lands ONLY where the row still carries
              the comp's `0`, because `isComped` reads that zero as "gift" and
              clearing the cohort alone leaves the row still reading as one.

      Both are null when `recordsPayment` is false, which is what stops a
      `customer.subscription.deleted` — it carries the plan's `unit_amount` too —
      from stamping $119 onto a comped row at the moment it ENDED and turning
      the gift into revenue on its way out.

      The comparisons are CASEs rather than read-then-write because the row is
      not read first; they have to happen where the value is, or two concurrent
      events could each decide from a stale copy. Postgres evaluates every SET
      expression against the OLD row, so the `cohort` and `price_cents` legs
      both still see the pre-update values and the two markers clear together.
    */
    const recordsPayment = params.tier === 'paid' && Boolean(params.stripeSubscriptionId);
    const { observedCents, ifStillAGiftCents } = amountsToWrite({ ...params.amounts, recordsPayment });

    await query(
      `UPDATE subscriptions
          SET tier = $2, status = $3, stripe_customer_id = COALESCE($4, stripe_customer_id),
              stripe_subscription_id = COALESCE($5, stripe_subscription_id),
              current_period_end = COALESCE($6, current_period_end),
              cohort = CASE WHEN $7::boolean AND cohort = $8::text THEN $9::text ELSE cohort END,
              price_cents = CASE
                              WHEN $10::int IS NOT NULL THEN $10::int
                              WHEN $11::int IS NOT NULL AND price_cents = 0 THEN $11::int
                              ELSE price_cents
                            END,
              updated_at = now()
        WHERE id = $1`,
      [
        existing.rows[0].id,
        params.tier,
        params.status,
        params.stripeCustomerId ?? null,
        params.stripeSubscriptionId ?? null,
        params.currentPeriodEnd ?? null,
        recordsPayment,
        COMP_COHORT,
        CONVERTED_FROM_COMP_COHORT,
        observedCents,
        ifStillAGiftCents,
      ],
    );
    return;
  }

  await query(
    `INSERT INTO subscriptions
       (owner_id, tier, status, price_cents, stripe_customer_id, stripe_subscription_id, current_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.ownerId,
      params.tier,
      params.status,
      // No existing value to protect on a new row, so the plan price is usable
      // and the list price is the fallback. See firstRecordedCents().
      firstRecordedCents(params.amounts),
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
      params.currentPeriodEnd ?? null,
    ],
  );
}

/**
 * Statuses that keep the vault open.
 *
 * `past_due` is deliberately here: somebody whose card expired mid-emergency
 * must not lose the vault their family is relying on. Only a genuinely ended
 * subscription downgrades.
 */
const ACTIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);

/**
 * The subscription's status NOW, not the status the event happened to carry.
 *
 * This is what makes the handler order-independent — see the case below. Falls
 * back to the event's own snapshot if Stripe cannot be reached, because acting
 * on a stale status is better than dropping a cancellation on the floor.
 */
async function currentSubscriptionStatus(
  sub: Stripe.Subscription,
): Promise<Stripe.Subscription.Status> {
  try {
    const fresh = await getStripe().subscriptions.retrieve(sub.id);
    return fresh.status;
  } catch (err) {
    process.stderr.write(
      `[stripe] could not re-read ${sub.id}, using the event's own status: ${String(err)}\n`,
    );
    return sub.status;
  }
}

/**
 * The owner behind a subscription id alone.
 *
 * An `invoice.payment_failed` payload carries the subscription id but not the
 * subscription object, so `ownerIdFor` cannot be reused: it reads metadata that
 * is not present here. This resolves from the row we already wrote at checkout,
 * which is the only link that exists for an invoice.
 */
async function ownerIdForSubscriptionId(subscriptionId: string): Promise<string | null> {
  const r = await query<{ owner_id: string }>(
    `SELECT owner_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
    [subscriptionId],
  );
  return r.rows[0]?.owner_id ?? null;
}

/**
 * The subscription id on an invoice, on either shape the API has used.
 *
 * 🔴 THIS READ `invoice.subscription` AND THAT FIELD DOES NOT EXIST on the
 * version this code pins. `lib/billing/stripe.ts` pins `2026-07-29.dahlia`, and
 * on that version `Invoice` has no top-level `subscription` member at all — the
 * id moved under `parent.subscription_details.subscription`
 * (stripe@22.4.0 `cjs/resources/Invoices.d.ts`: `parent: Invoice.Parent | null`,
 * `Parent.SubscriptionDetails.subscription: string | Subscription`). The
 * handler had to widen the Stripe type by hand to read the old name, which was
 * the tell: the local widening existed precisely because the field was gone.
 *
 * The failure mode was the worst available one. `subId` came back undefined,
 * the case `break`s, the endpoint answers `{received:true}`, and Stripe's
 * dashboard shows a clean 200 for an event that told nobody anything — so the
 * renewal notice, which is the precondition the paywall flip is waiting on,
 * could never have fired and nothing would have looked wrong.
 *
 * BOTH shapes are read rather than just the new one, newest first. An endpoint
 * created before the rename is pinned to its own API version and still delivers
 * the legacy field, and which version `we_1U2IIG…` carries cannot be read from
 * this repo. Reading both makes the question stop mattering, which is the same
 * move `currentSubscriptionStatus` makes about delivery order.
 */
type InvoiceSubscriptionRef = string | { id?: string } | null | undefined;

function subscriptionIdOnInvoice(invoice: Stripe.Invoice): string | undefined {
  const widened = invoice as Stripe.Invoice & { subscription?: InvoiceSubscriptionRef };

  const candidates: InvoiceSubscriptionRef[] = [
    widened.parent?.subscription_details?.subscription,
    widened.subscription,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (c && typeof c === 'object' && c.id) return c.id;
  }
  return undefined;
}

/**
 * One audit entry per Stripe EVENT, however many times it is delivered.
 *
 * 🔴 THE TRAIL WAS THE ONE THING REPLAY CORRUPTED. Everything else here is
 * already idempotent — the entitlement UPDATE lands on the existing row, the
 * status is re-read from Stripe rather than taken from the payload, and the
 * lapse notices dedupe on the invoice and subscription ids. `writeAuditEntry`
 * ran unconditionally, so a Stripe retry — which this handler deliberately
 * invites by returning 500 on failure, and which a dashboard redelivery can
 * cause at any time — wrote "your subscription started" into the owner's log
 * twice for one event.
 *
 * That log is a product surface, and it is hash-chained and append-only: a
 * duplicate cannot be quietly removed later without breaking the chain, so it
 * has to not be written.
 *
 * The key is `event.id`, which is what Stripe holds constant across retries —
 * not the subscription id, which is constant across genuinely different events.
 * The lookup is the same one `lib/billing/lapse-notice.ts` already performs, and
 * it is literally the same function rather than a second copy of the query.
 *
 * ⚠️ THE SKIP IS THE ENTRY, NOT THE WORK. Only the audit write is suppressed; the
 * entitlement reconciliation above it always runs, because Stripe retries
 * precisely when it is unsure the first attempt landed.
 */
async function writeAuditEntryOncePerEvent(
  ownerId: string,
  eventId: string,
  entry: { action: string; entity: 'subscription'; detail: Record<string, unknown> },
): Promise<void> {
  if (await stripeIdAlreadyRecorded(ownerId, entry.action, eventId)) return;

  await writeAuditEntry(ownerId, {
    actor: 'system',
    action: entry.action,
    entity: entry.entity,
    detail: { ...entry.detail, stripe_id: eventId },
  });
}

/** owner_id travels in metadata; falling back to a customer lookup is a last resort. */
async function ownerIdFor(sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = sub.metadata?.owner_id;
  if (fromMetadata) return fromMetadata;

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;

  const r = await query<{ owner_id: string }>(
    `SELECT owner_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId],
  );
  return r.rows[0]?.owner_id ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'NotConfigured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Unsigned' }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    // Never process an unverified event: this endpoint grants paid entitlement.
    process.stderr.write(`[stripe] signature verification failed: ${String(err)}\n`);
    return NextResponse.json({ error: 'InvalidSignature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const ownerId = s.metadata?.owner_id;
        if (!ownerId) break;
        await upsertSubscription({
          ownerId,
          tier: 'paid',
          status: 'active',
          amounts: amountsOn(event),
          stripeCustomerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
          stripeSubscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
        });
        await writeAuditEntryOncePerEvent(ownerId, event.id, {
          action: 'subscription_started',
          entity: 'subscription',
          detail: { source: 'stripe' },
        });
        break;
      }

      /*
        🔴 THESE TWO WERE ORDER-DEPENDENT, fixed 2026-08-13. Each applied the
        status carried IN the event payload, and Stripe guarantees no ordering
        and does retry — so a `customer.subscription.updated` carrying an
        `active` snapshot, delivered after `customer.subscription.deleted`,
        re-granted the paid tier to a cancelled customer. The delivery order of
        two webhooks decided what somebody was entitled to.

        THE FIX IS NOT A WATERMARK. Storing `event.created` and dropping older
        events would work, and would need a schema change plus a new rule for
        every future handler to remember. Re-reading the subscription from
        Stripe at handling time makes the question disappear instead: whatever
        order the events arrive in, every one of them resolves to the SAME
        current truth, so the handler is idempotent by construction rather than
        by discipline. That is the structural-safety-over-convention rule.

        A retrieve failure falls back to the event payload rather than dropping
        the event: a stale-but-present status beats silently ignoring a
        cancellation.
      */
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const ownerId = await ownerIdFor(sub);
        if (!ownerId) break;

        const current = await currentSubscriptionStatus(sub);
        const active = ACTIVE_STATUSES.has(current);

        await upsertSubscription({
          ownerId,
          tier: active ? 'paid' : 'free',
          status: active ? 'active' : 'cancelled',
          amounts: amountsOn(event),
          stripeSubscriptionId: sub.id,
        });

        if (!active) {
          await writeAuditEntryOncePerEvent(ownerId, event.id, {
            action: 'subscription_cancelled',
            entity: 'subscription',
            detail: { source: 'stripe', status: current },
          });

          /*
            The audit entry records that it HAPPENED; this tells the person it
            happened to. Deduped on the subscription id, so the several events
            that can carry a terminal status produce one message.
          */
          await notifySubscriptionLapsed({ ownerId, subscriptionId: sub.id });
        }
        break;
      }

      /*
        🔴 UNHANDLED UNTIL 2026-08-20, AND IT IS THE EVENT A CUSTOMER FEELS.
        A card expires, Stripe retries for about three weeks, and until this
        existed the owner heard nothing at any point — not on the first failure,
        and not when the subscription finally ended.

        NOTHING HERE CHANGES ENTITLEMENT. `past_due` is inside ACTIVE_STATUSES
        by design, so a failed renewal does not revoke access during the retry
        window; this is notification only. The dedupe, the copy and the audit
        record live in lib/billing/lapse-notice.ts.
      */
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = subscriptionIdOnInvoice(invoice);
        if (!subId || !invoice.id) break;

        const ownerId = await ownerIdForSubscriptionId(subId);
        if (!ownerId) break;

        await notifyRenewalFailed({ ownerId, invoiceId: invoice.id });
        break;
      }

      default:
        break; // Other events are Stripe's business, not ours.
    }
  } catch (err) {
    // 500 so Stripe retries. Swallowing a failure here would silently leave a
    // paying customer on the free tier.
    process.stderr.write(`[stripe] handler failed for ${event.type}: ${String(err)}\n`);
    return NextResponse.json({ error: 'HandlerFailed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
