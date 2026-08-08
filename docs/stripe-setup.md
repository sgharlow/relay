# Stripe setup — Relay

> Configured 2026-08-08. **The Stripe account is SHARED** with report-bridge,
> skillcrossroads and beacon. Everything Relay owns is additive; nothing
> belonging to another product has been read into, modified, or rolled.

## What exists now (TEST mode)

| Object | Id |
|---|---|
| Product | `prod_V2MCc5ccGaM3Bd` — "Relay Family Vault" |
| Price | `price_1U2HURGs40KMmT4XxM6svIr0` — $119.00/year |
| Webhook endpoint | `we_1U2HUhGs40KMmT4XbQHmEJZU` → `https://relaystandby.com/api/stripe/webhook` |

Events: `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`.

Vercel production carries `STRIPE_SECRET_KEY` (test), `STRIPE_PRICE_RELAY_ANNUAL`
and `STRIPE_WEBHOOK_SECRET` (this endpoint's own secret — report-bridge's would
reject every event).

## Why TEST and not live

The Stripe CLI's live credential is a RESTRICTED key (`rk_live_…`) without
`product_write`. That is correct least-privilege and was not worked around.

It also happens to be the right mode for now: beta families are onboarded by
hand and free, G1 has not yet measured whether anyone will pay, and the terms
page states that nothing is charged without an explicit checkout step. Test mode
means checkout works end to end and no card is ever actually charged.

## Proven, not assumed (2026-08-08)

- Forged webhook signature → **400 InvalidSignature**. The endpoint grants paid
  entitlement, so this is the whole security model.
- Unauthenticated checkout → **401**.
- A real `checkout.session.completed` carrying `metadata.owner_id` → the
  subscription row flipped to **tier=paid, status=active**, and `getEntitlement`
  returned `paid`.
- A real `customer.subscription.deleted` → back to **tier=free,
  status=cancelled**, `stripe_subscription_id` recorded.

⚠️ `stripe_customer_id` stayed null in both, because the CLI's fixture session
carries no customer object. A genuine browser checkout populates it. That field
is therefore the one part of the webhook NOT exercised by this test.

## Going live — three steps, all Steve's

1. Grant `product_write` (and `feature_write`) on the restricted live key, or
   create the objects in the dashboard. The permission URL is in the CLI's error.
2. Re-create product + price + webhook endpoint **with `--live`**. Same commands.
3. Swap the three Vercel vars to the live key, the live price id, and the live
   endpoint's secret. **Do not roll `STRIPE_SECRET_KEY`** — report-bridge,
   skillcrossroads and beacon use it.

Nothing in the code changes; it is all environment.
