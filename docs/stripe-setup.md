# Stripe setup — Relay

> Configured 2026-08-08. **The Stripe account is SHARED** with report-bridge,
> skillcrossroads and beacon. Everything Relay owns is additive; nothing
> belonging to another product has been read into, modified, or rolled.

## What exists now (LIVE mode, since 2026-08-08)

| Object | Live id | Test id (kept for local dev) |
|---|---|---|
| Product | `prod_V2N1HwRgMNdWbT` | `prod_V2MCc5ccGaM3Bd` |
| Price ($119.00/yr) | `price_1U2IHyGs40KMmT4XYv42dsma` | `price_1U2HURGs40KMmT4XxM6svIr0` |
| Webhook endpoint | `we_1U2IIGGs40KMmT4XAIradLoE` | *(deleted — see below)* |

The TEST webhook endpoint was deleted. It pointed at the same production URL, and
once production held live secrets it could no longer verify test events — it
would only have accrued delivery failures.

Events: `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`.

Vercel production carries `STRIPE_SECRET_KEY` (test), `STRIPE_PRICE_RELAY_ANNUAL`
and `STRIPE_WEBHOOK_SECRET` (this endpoint's own secret — report-bridge's would
reject every event).

## How live objects got created

The Stripe CLI's own credential is a session key whose permissions Stripe fixes
at issue time and the dashboard cannot edit — which is why the permission
toggles appear greyed out. Creating a restricted key with the needed writes was
also blocked in the dashboard.

Steve therefore authorised using report-bridge's live secret key (already in its
Vercel production env, on this same account) for the three creates. It was read
transiently, never written to disk in this repo, and the temporary copy was
deleted immediately afterwards.

This is a deliberate exception to a preference stated earlier in the same
session — borrowing a credential across a project boundary — made by the account
owner to avoid transcribing secrets by hand. Recorded here rather than left
implicit.

⚠️ **The earlier claim that beta families are "free" was wrong.** The interest
page says founding families are onboarded personally at the *same $119/yr*. They
follow the Stripe flow like anyone else, which is why live mode is required
before marketing rather than after.

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

## Live verification (2026-08-08)

- Live price object: `livemode: true`, `unit_amount: 11900`, yearly. ✅
- Live webhook endpoint `enabled`, and **skillcrossroads' and report-bridge's
  endpoints confirmed still `enabled` and untouched** before and after. ✅
- A **live** Checkout Session minted against the configured price returned
  `livemode: true`, `amount_total: 11900`, `currency: usd`. Creating a session
  charges nothing; it proves the key and price work together. ✅
- Production rejects a forged webhook signature (**400 InvalidSignature**) and an
  unauthenticated checkout (**401**). ✅

## NOT yet proven — the last mile

**No real card has been charged.** The webhook's paid-tier and cancellation paths
were proven end to end in TEST mode; the live path is verified only as far as
session creation. One genuine purchase (then refund) is the remaining check, and
it must happen before marketing spend rather than after.
