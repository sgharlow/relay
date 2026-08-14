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

/** Stripe needs the byte-exact body; Next must not pre-parse it. */
export const dynamic = 'force-dynamic';

async function upsertSubscription(params: {
  ownerId: string;
  tier: 'free' | 'paid';
  status: 'active' | 'cancelled';
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM subscriptions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [params.ownerId],
  );

  if (existing.rows[0]) {
    await query(
      `UPDATE subscriptions
          SET tier = $2, status = $3, stripe_customer_id = COALESCE($4, stripe_customer_id),
              stripe_subscription_id = COALESCE($5, stripe_subscription_id),
              current_period_end = COALESCE($6, current_period_end),
              updated_at = now()
        WHERE id = $1`,
      [
        existing.rows[0].id,
        params.tier,
        params.status,
        params.stripeCustomerId ?? null,
        params.stripeSubscriptionId ?? null,
        params.currentPeriodEnd ?? null,
      ],
    );
    return;
  }

  await query(
    `INSERT INTO subscriptions
       (owner_id, tier, status, price_cents, stripe_customer_id, stripe_subscription_id, current_period_end)
     VALUES ($1, $2, $3, 11900, $4, $5, $6)`,
    [
      params.ownerId,
      params.tier,
      params.status,
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
          stripeCustomerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
          stripeSubscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
        });
        await writeAuditEntry(ownerId, {
          actor: 'system',
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
          stripeSubscriptionId: sub.id,
        });

        if (!active) {
          await writeAuditEntry(ownerId, {
            actor: 'system',
            action: 'subscription_cancelled',
            entity: 'subscription',
            detail: { source: 'stripe', status: current },
          });
        }
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
