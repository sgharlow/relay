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

Events, **as configured on 2026-08-08**: `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`.

### ~~🔴 The code now handles a FOURTH event the endpoint may not be subscribed to~~ — SETTLED 2026-08-29 (E1.6, read #1)

> ✅ **RESOLVED 2026-08-29 by a read-only Stripe CLI retrieve, not by a dashboard visit.** The
> endpoint WAS widened and nobody wrote it down — the first of the two possibilities below. Kept
> rather than deleted, because the *class* it names is still open and is now guarded (see the
> `verify:stripe` note at the end of this section).
>
> ```
> stripe webhook_endpoints retrieve we_1U2IIGGs40KMmT4XAIradLoE --live
> ```
>
> Live, 2026-08-29 — `status: enabled`, `livemode: true`,
> `url: https://relaystandby.com/api/stripe/webhook`, and `enabled_events` is **exactly four**:
> `checkout.session.completed`, `customer.subscription.updated`,
> `customer.subscription.deleted`, `invoice.payment_failed`.
>
> The handler's `case` list is the same four —
> `src/app/api/stripe/webhook/route.ts:338, :378, :379, :423. **The two definitions agree today.**
> So `lib/billing/lapse-notice.ts` IS reachable in production: Stripe will POST
> `invoice.payment_failed` to it. That closes the reachability question and leaves E1-prime's
> remaining question narrower than it was — not *can the notice fire*, but *has anyone watched it
> fire*.
>
> ⚠️ **This section was addressed to Steve as "one dashboard checkbox" and it never needed him.**
> It says plainly: *"it cannot be read from this repo: there is no Stripe key in any local env, by
> design."* True about the repo, false about the machine — a paired Stripe CLI session key reads
> it in one command, read-only, and had been available the whole time. An item can sit in
> somebody's court for eight days because the tool that answers it was not on the list of tools
> considered.

> Added 2026-08-21. **~~Steve's, and it is one dashboard checkbox.~~** Claude's, and it was one CLI read.

`invoice.payment_failed` has been a handled case in `src/app/api/stripe/webhook/route.ts` since
2026-08-20 — it is what sends the renewal-failure notice. **Nothing records the live endpoint's
`enabled_events` ever being widened to include it**, and it cannot be read from this repo: there is
no Stripe key in any local env, by design. Searching `docs/` for `invoice.payment_failed` finds only
the trigger instruction in `e1-stripe-lapse-proof.md`.

So the live state is one of two, and which one is unknown from here:

- the endpoint **was** widened in the dashboard and nobody wrote it down — in which case update the
  list above and this section goes away; or
- the endpoint is **still on the three events above**, Stripe never POSTs `invoice.payment_failed`
  to production, and `lib/billing/lapse-notice.ts` is unreachable in production no matter how
  correct the code is.

**Check it before anything else in E1-prime.** A "Send test webhook" from the dashboard does NOT
settle this: a test event can be delivered to an endpoint that is not subscribed to that event
type in normal operation. The thing to read is the endpoint's own event list
(`we_1U2IIGGs40KMmT4XAIradLoE` → Developers → Webhooks → its enabled events).

⚠️ And this is a class, not an incident: **the handler's event list and the endpoint's event list
are two definitions of the same contract, kept in sync by nobody.** The next handler added will
have the same gap on the same day it ships.

Vercel production carries `STRIPE_SECRET_KEY`, `STRIPE_PRICE_RELAY_ANNUAL`
and `STRIPE_WEBHOOK_SECRET` (this endpoint's own secret — report-bridge's would
reject every event).

**The production key is the LIVE key — verified 2026-08-08 on the deployed
build**, not inferred from the dashboard. A checkout session started by a real
self-serve account came back as `cs_live_…`; a test key would have returned
`cs_test_…`, or failed outright against the live price id. This paragraph
previously read "(test)" and was left behind when live mode landed — the config
was right and the doc was wrong, which is the more dangerous direction, since it
invites someone to "fix" a working key. All three values are marked sensitive in
Vercel, so `vercel env pull` returns them empty: the session-id prefix is the
only read path that does not require the dashboard.

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

## ~~NOT yet proven — the last mile~~ — SETTLED 2026-08-08, struck 2026-08-21

> ~~**No real card has been charged.** The webhook's paid-tier and cancellation paths were proven
> end to end in TEST mode; the live path is verified only as far as session creation. One genuine
> purchase (then refund) is the remaining check, and it must happen before marketing spend rather
> than after.~~
>
> **Stopped being true on 2026-08-08, the same day it was written.** A real card was charged end to
> end: `PROJECT.yaml → monetization_path` records *"$119/yr, live-mode Stripe, charged end to end
> 2026-08-08"*, `ROADMAP.md` counts one active paid subscription (the owner's own card, $119), and
> `docs/backup-restore-runbook.md` observes that paying subscriber's row surviving a restore.
>
> Left visible rather than deleted, because the direction it was wrong in is the dangerous one: a
> setup doc telling a future operator that the live path is unproven invites a **second redundant
> live charge** on a shared account to prove something already proven.
>
> ⚠️ **One self-purchase is not demand.** `wtp_evidence` remains `none` and the gate
> `g1-arms-length-demand` is at zero — this paragraph records that the *machinery* works, not that
> anybody has bought anything.

## E1-prime: what actually blocks proving the lapse notice (2026-08-21)

> The plan in `PROJECT.yaml`, `ROADMAP.md` §E / Sprint 3.6 and `docs/e1-stripe-lapse-proof.md` is
> *"fire a test-mode `invoice.payment_failed` at the production webhook, confirm exactly one email;
> re-deliver the same event, confirm silence."* Two constraints make that not work as written, and
> neither is stated where the plan is. Recorded here because this file is where an operator looks
> before touching Stripe.

**Constraint 1 — production verifies with ONE live-mode secret.** `route.ts` reads a single
`process.env.STRIPE_WEBHOOK_SECRET`, calls `constructEvent` with it, and returns
**400 InvalidSignature** otherwise. There is no livemode branching and no second secret. The test
endpoint at this URL was deleted (see the top of this file). So a test-mode event sent at production
today is rejected at signature verification — it never reaches the handler, and the symptom is
indistinguishable from "the notice did not fire". `e1-stripe-lapse-proof.md` step 0 gets this half
right and warns against re-pointing production's secret; the warning is correct and must not be
softened.

**Constraint 2 — and this one is stated nowhere: the fixture's subscription belongs to no owner.**
The handler resolves the person to notify with
`SELECT owner_id FROM subscriptions WHERE stripe_subscription_id = $1`. A `stripe trigger
invoice.payment_failed` fixture invents its own `sub_…`, which matches no production row, so
`ownerIdForSubscriptionId` returns null and the case breaks **before** `notifyRenewalFailed` is
reached. "Expect: exactly one email" would fail, correctly, for a reason that has nothing to do
with the notice — and the natural next move (assume the notice is broken) would be wrong.

**Constraint 3 — the CLI route writes to production.** `npm run dev` with `.env.local` points at
the **production** DSQL cluster; Relay has no dev database. Anything the local walk creates is a
real row.

### What each path can and cannot prove

| Path | Proves | Does not prove | Cost |
|---|---|---|---|
| **A.** Stripe CLI `listen` + `trigger` against local `npm run dev` | delivery, signature, **payload shape**, and that the handler reaches the owner lookup | the send and the dedupe — the fixture's `sub_…` resolves to no owner | $0, writes to prod DSQL |
| **B.** A test-mode endpoint at the production URL + a second secret tried only after the live one fails | delivery + parse + dedupe end to end against the real deployment | nothing, if a prod `subscriptions` row is written to carry the fixture's id — that row is a deliberate production write and must be removed after | small code change; **must gate on `event.livemode`** so a test event can never grant entitlement through `checkout.session.completed` |
| **C.** Live mode, a real declining card | everything, for real | — | not same-day: Stripe offers no way to force a live `invoice.payment_failed` on demand; it needs a renewal that genuinely declines |

**Recommended order:** A first — it is free and it settles the shape question. Then a decision on B,
which is the only same-day route to the dedupe half, and the dedupe half is *"the only thing that
proves the dedupe, and it is the half that gets skipped"* in ROADMAP's own words.

⚠️ **Path A got materially cheaper on 2026-08-21 and also less necessary in one respect.** The
handler used to read `invoice.subscription`, which the pinned API version does not send; that alone
would have made every real `invoice.payment_failed` a silent no-op. It now reads
`parent.subscription_details.subscription` first and the legacy field as a fallback, with a unit
test per shape — so a shape mismatch is no longer the thing path A would have discovered. What
remains genuinely unproven is delivery, the send, and the dedupe.

## Cancellation and the customer portal (2026-08-09)

Until this date **nothing in the product could cancel a subscription**. There was
no portal route and no cancel call anywhere in the codebase; `deleteAccount`
removed the local `subscriptions` row and the user, and never told Stripe. So
closing your account deleted the vault and left the card being charged annually,
with no account left to sign in to. That is now closed:

- `POST /api/stripe/portal` opens Stripe's hosted portal for the signed-in
  owner's own customer id. The id is read from their row and never taken from
  the request — on an account shared with report-bridge and skillcrossroads, a
  caller-supplied customer id would be a cross-product takeover.
- `deleteAccount` cancels at Stripe **first**, and aborts the whole deletion if
  that fails. The local row is the only pointer to the Stripe object, so
  deleting it first would make the charge unstoppable from inside the app.

### ~~⚠️ ONE STEP IS NOT VERIFIED, AND IT IS IN THE DASHBOARD~~ — SETTLED 2026-08-09

> **Struck 2026-08-21.** The section below was true for one day. `docs/g1-launch-checklist.md`
> item **7h** records it settled on 2026-08-09 by signing in as the real paying account and
> pressing the button: the portal returned a **`live_` session** and rendered the real subscription
> — $119.00/yr, next billing date, card on file, invoice history, and a working **Cancel
> subscription** control. Nothing was cancelled. So the customer portal HAS been saved in live
> mode, and "wired, not live-proven" is no longer the right ladder rung for it.
>
> The text is kept because the *mechanism* it describes is still true and still bites — a portal
> configuration that was never saved fails exactly this way — and because the finding it carries
> about the shared-account business name ("Relay/ReportBridge/LearningAI365", ratified as
> leave-as-is in `PROJECT.yaml → ratified.stripe-merchant-name`) was found in the same sitting.
>
> **The cancellation-timing question at the end of it is still open.** See below.

### (historical) The step that was not verified

`billingPortal.sessions.create` fails with *"No configuration provided and your
default configuration has not been created"* unless the **customer portal has
been saved at least once in live mode**: Stripe Dashboard → Settings → Billing →
Customer portal → configure → save.

This could not be checked from the repo: `STRIPE_SECRET_KEY` is a Vercel
*sensitive* variable, so `vercel env pull` returns it empty and there is no local
key to call the API with. What IS proven live is that the route exists and
refuses an unauthenticated caller with 401 rather than 500.

~~So the button is **wired, not live-proven**.~~ It is **live-proven** as of 2026-08-09 (see the
banner above). The rest stands as the description of a failure mode: if that configuration is ever
reset, every subscriber who clicks "Manage or cancel subscription" gets an error, and signing in
and clicking it once is how you would find out.

### ~~🟡 OPEN — cancellation timing is a dashboard setting~~ — SETTLED 2026-08-29 (E1.6, read #2)

> ✅ **RESOLVED: the portal cancels AT PERIOD END, so `/terms` is TRUE as written.** Read-only,
> 2026-08-29:
>
> ```
> stripe billing_portal configurations list --live
> ```
>
> `bpc_1Tu3WlGs40KMmT4X7RYjcEXF` — `is_default: true`, `active: true`,
> `features.subscription_cancel.enabled: true`, **`mode: "at_period_end"`**,
> `proration_behavior: "none"`.
>
> That is the first of the two acceptable outcomes below: the plain reading of `REFUND_POLICY`'s
> *"cancel at any time to stop the next one"* — your current year runs out and you are not billed
> again — is what the portal actually does. **No copy change is owed.** The unacceptable outcome
> (leaving it unread) is closed.
>
> ⚠️ **`is_default: true` is the load-bearing half, and it belongs to somebody else.** This is a
> SHARED Stripe account (skillcrossroads, report-bridge, second-brain). The default portal
> configuration is account-level: another product's operator can flip this to `immediately` in one
> click, in a dashboard this repo cannot see, and `/terms` becomes false with no commit, no test
> and no alarm. That is why E1.7 exists and why it is a standing check rather than this
> paragraph.

> ~~Steve's, read-only, one screen.~~ Answered by Claude read-only via the CLI. Recorded 2026-08-21, settled 2026-08-29.

**The portal's cancellation timing is set in the dashboard, not in this code** — *cancel
immediately* vs *cancel at period end*. Nobody wrote down which was chosen; item 7h saw a working
Cancel control and did not record its mode.

> ~~"The terms page **deliberately does not promise either**; if you choose end-of-period, that is a
> fact worth adding to the Payment section."~~ — the closing line of the 2026-08-09 section, struck
> 2026-08-21. It was **wrong**, and in the direction that mattered: it said the timing question was
> free to decide, so nobody read the screen. `/terms` had already promised one of the two answers,
> in `REFUND_POLICY`, from the day it went live. Kept rather than deleted because the next reader's
> first instinct will be the same one — *the terms are silent, so either setting is fine* — and this
> records that that reading of `/terms` was checked and is false.

That is not a neutral gap, because `/terms` is live and it leans one way. `lib/offer.ts`
`REFUND_POLICY`, rendered on the terms page, says you can **"cancel at any time to stop the next
one"** — whose plain reading is *your current year runs out, and you are not billed again*. If the
portal is set to cancel **immediately**, somebody who cancels on day 31 loses paid access for the
remaining eleven months and gets no refund (the refund window in `offer.ts` has closed by then).
That is a worse deal than the sentence they agreed to, delivered by a setting nobody chose
deliberately.

**Two acceptable outcomes, one unacceptable one.** Confirm the portal is set to *period end* and
record it here; **or** it is set to *immediate* and the `REFUND_POLICY` sentence is amended to say
so. Leaving it unread is the third option and the only wrong one.

### 🟡 OPEN — whether Stripe emails receipts at all is unrecorded

> Steve's, read-only, one screen. Recorded 2026-08-21.

The product **sends no receipt of its own**: `invoice.paid` and `invoice.payment_succeeded` are not
handled cases in the webhook (they fall to `default: break`), and nothing else mails about a
payment. So receipts exist only if Stripe's **"Successful payments" customer emails** are enabled —
an account-level setting on an account shared with two other products, mentioned nowhere until now.

Whether the one live subscriber received a receipt on 2026-08-08 is therefore unknown, and so is
what happens at the first renewal. Read the setting once (Settings → Emails) and record it here.
Building a receipt in-product is `ROADMAP.md` **E3**, correctly gated behind F-d — this is the
zero-cost half that should not wait for it.


---

## 🔴 STEVE — mint the restricted read-only key (E1.7). ~5 minutes, and it has a death date.

Ruled 2026-08-30: *"You mint the restricted key, I wire it."* The wiring is done —
`.github/workflows/stripe-contract-monitor.yml`, daily at 10:47 UTC. It has nothing to read until
this exists.

**What to mint.** Stripe dashboard → Developers → API keys → **Create restricted key**.

| | |
|---|---|
| Name | `relay-contract-monitor` (so it is obvious which product to revoke if it leaks) |
| Webhook Endpoints | **Read** |
| Billing Portal Configurations | **Read** |
| Everything else | **None** — it must not be able to write anything, or read a customer, or read a charge |
| Mode | **Live** — the contract being watched is the live one |

**Where to put it.** GitHub → the `relay` repo → Settings → Secrets and variables → Actions → New
repository secret, named exactly `STRIPE_READONLY_KEY`. **Do not put it in a `.env` file and do not
paste it into a chat** — the monitor reads it from Actions, and `verify:stripe` picks it up from the
environment when you want to run it by hand.

**Why it is worth five minutes.** `verify:stripe` watches two things that can change with no commit,
no deploy and nothing in any diff:

1. the live endpoint's `enabled_events` still covering every event the handler has a `case` for —
   this already bit once, silently, for nine days; and
2. the default billing portal still cancelling **at period end**, which is what `/terms` promises.
   ⚠️ That configuration is **account-level** on an account shared with report-bridge,
   skillcrossroads and second-brain, so **another product's operator can falsify Relay's terms to
   paying customers in one click.**

**The date.** Both Stripe CLI session keys expire **2026-10-07** (`~/.config/stripe/config.toml`,
read 2026-08-30). Until then the CLI is a working fallback and the monitor only warns. After it,
there is no non-dashboard read path at all — so the monitor starts failing rather than warning,
because at that point an unset secret means nothing is watching.

**Separately, and also yours: `stripe login` before 2026-10-07** (E1.8) — it re-pairs the CLI for
another window. The restricted key does not remove the need for it; the CLI is what `verify:stripe`
uses interactively and what any future E1 route work needs.
