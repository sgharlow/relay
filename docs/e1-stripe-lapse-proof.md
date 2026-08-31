# E1′ — proving the lapse notice, end to end

> 🔴 **STOP — READ THE 2026-08-21/22 APPENDIX BEFORE FOLLOWING ANY STEP BELOW.**
>
> **The procedure in this section does not work, and it fails in the flattering direction.**
> `stripe trigger invoice.payment_failed` produces a **one-off invoice with no subscription at
> all**, so the handler correctly ignores it and the endpoint answers `200` having written
> nothing — which is indistinguishable from broken wiring. Steps 1–3 and the four-box table
> below **cannot be ticked from a trigger run**.
>
> The blocker that sat above all of it — the production endpoint was never subscribed to
> `invoice.payment_failed` — was **found and fixed 2026-08-21** (§1 of the appendix).
>
> Steps 0–3 are retained unedited because the 2026-08-21 attempt was run against them and the
> appendix is a commentary on them. Treat them as history, not instructions.

**Status:** `wired`, not `live-proven`. Every rule in `lib/billing/lapse-notice.ts` is unit-tested;
the wiring has never met Stripe. **Owner: Steve.** ~10 minutes.
Register entry: `PROJECT.yaml → deferred → the-lapse-notice-is-wired-not-live-proven`.

⚠️ **"~10 minutes" is now known to be wrong.** Two sessions have gone into this. See the appendix
§5 for what a real proof actually requires — none of the three viable routes is a ten-minute job.

## Why this is worth ten minutes

`ratified.beta-free-release` is revisited **2026-10-01**. The moment `TIER_LIMITS.free.canRelease`
flips to `false`, an expired card becomes a **blocked release** — the one thing this product exists
to do, stopped by a billing event. The only thing standing between a failed renewal and a family
finding out at the worst possible moment is a notification that has never been fired in anger.

## The thing that gets skipped

**The second delivery.** Sending the mail is the satisfying half and feels like the test. The dedupe
is only ever exercised by doing it twice — and Stripe retries failed webhooks *by design*, so the
untested path is the one production takes on an ordinary day.

⚠️ **A detail worth knowing before you start, because it changes what a good test looks like.** The
dedupe key is the **invoice id**, not the Stripe event id:

```sql
WHERE owner_id = $1 AND action = $2 AND detail->>'stripe_id' = $3
```

That is the stronger design — Stripe's automatic retries generate a *new event id* for the *same
invoice*, so event-id dedupe would have let a retry through and sent a second email. It also means
you cannot prove the dedupe by inventing a second event: it has to carry the same invoice id, which
is exactly what "resend this event" does.

## Step 0 — the one that might stop you

The production webhook is registered in **live** mode. A test-mode event will not reach it unless a
**test-mode endpoint** exists pointing at the same URL.

Stripe Dashboard → **Developers → Webhooks**, toggle to **Test mode**, and look for an endpoint at
`https://relaystandby.com/api/stripe/webhook`.

- **If it exists** — check its signing secret matches what production holds in `STRIPE_WEBHOOK_SECRET`.
  If it does not, the request arrives and is rejected at signature verification, which looks exactly
  like "nothing happened".
- **If it does not exist** — that is itself the finding, and it means no test-mode event has ever
  been exercised against this endpoint. Creating one is the fix; note that it issues its own signing
  secret, so production would need that value to accept test traffic. ⚠️ **Do not point production's
  `STRIPE_WEBHOOK_SECRET` at a test-mode endpoint and leave it there** — that would leave live
  billing unable to verify its own callbacks. If this route gets complicated, stop and say so; there
  is a cleaner alternative below.

**Cleaner alternative if step 0 is awkward:** use the **Stripe CLI** against a local server instead
of production —

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints a signing secret
# put that secret in .env.local as STRIPE_WEBHOOK_SECRET, then in another shell:
npm run dev
stripe trigger invoice.payment_failed
```

This proves the same wiring against the same code without touching production's webhook config. It
is the recommended route unless a test-mode endpoint already exists.

## Step 1 — fire it

Dashboard → **Developers → Events** (or Workbench) → send a test `invoice.payment_failed`, or
`stripe trigger invoice.payment_failed` on the CLI.

**Expect:** exactly **one** email to the owner address.

## Step 2 — verify it landed, and left a record

Run from the repo root:

```bash
npx tsx --env-file=.env.local -e "import('./lib/db/connection').then(async m => { \
  const r = await m.query(\"SELECT action, detail->>'stripe_id' AS stripe_id, ts \
    FROM audit_log WHERE action IN ('renewal_payment_failed_notice','subscription_lapsed_notice') \
    ORDER BY ts DESC LIMIT 10\"); \
  console.table(r.rows); })"
```

**Expect:** one row, `action = renewal_payment_failed_notice`, `stripe_id` = the invoice id.

## Step 3 — the half that matters

Back in **Developers → Events**, find that same event and **Resend** it. (On the CLI, re-run
`stripe trigger` — but note it mints a *new invoice*, so it will legitimately send a second mail.
**Resending the same event from the dashboard is the correct way to test this**; if you are on the
CLI route, resend from the CLI's event log rather than re-triggering.)

**Expect:** **no second email.** Re-run the query from step 2 — still **one** row, same `stripe_id`.

## What "proven" means

| | result |
|---|---|
| one email after step 1 | ☐ |
| exactly one `renewal_payment_failed_notice` row, carrying the invoice id | ☐ |
| **no** email after the resend | ☐ |
| **still** exactly one row | ☐ |

All four ticked → move the register entry to `closed` and the ladder for E1 from `wired` to
`live-proven`.

⚠️ **Three boxes is not a pass.** If mail sends twice, the dedupe is not working and the paywall flip
on 2026-10-01 becomes the thing that discovers it. If mail never sends at all, that is a *different*
failure from a duplicate and it is worse — check whether the event reached the endpoint at all
(Dashboard shows delivery attempts and response codes) before assuming the notice is at fault.

## What I can do while you run it

Say the word between steps and I will run the audit query and read the result back, so the dedupe is
confirmed against the database rather than against an inbox.

---

# 2026-08-21/22 — what was actually found, and why this document's method could not work

Written after attempting the procedure above. **Two things changed: one blocker was removed, and
the prescribed test was found to be incapable of exercising the path it tests.** Both are recorded
here rather than in a commit message because the next person to attempt this will open this file.

## 1. ✅ The blocker above everything else — Stripe was never sending the event

Step 0 asked whether the production endpoint subscribes to `invoice.payment_failed`. It did not:

```
$ stripe webhook_endpoints retrieve we_1U2IIGGs40KMmT4XAIradLoE --live
"enabled_events": [ "checkout.session.completed",
                    "customer.subscription.updated",
                    "customer.subscription.deleted" ]
```

`src/app/api/stripe/webhook/route.ts` handled the case and `lib/billing/lapse-notice.ts` was fully
unit-tested, but **Stripe never POSTed the event**, so in production the notice was unreachable
code. The same account's `report-bridge` endpoint (`we_1TQJx6…`) did subscribe to it, so this was an
omission on relay's endpoint alone rather than an account-level constraint.

**Fixed 2026-08-21** and verified by independent re-read. ⚠️ `--enabled-events` **replaces** the
list rather than appending — the update passed all four events, and passing only the new one would
have silently dropped checkout and both subscription events.

## 2. 🔴 `stripe trigger invoice.payment_failed` cannot exercise this handler

**This is the finding.** The CLI route in "Cleaner alternative" above, and Step 1's trigger, produce
an invoice that this code correctly ignores.

The handler's first two lines are:

```ts
const subId = subscriptionIdOnInvoice(invoice);
if (!subId || !invoice.id) break;
```

`stripe trigger invoice.payment_failed` runs an `invoiceitem` + `invoice` fixture — a **one-off
invoice**, not a subscription renewal. Measured on the real generated event
(`evt_1U74tnGs40KMmT4X2HnKgbPE`, test mode):

| field | value |
|---|---|
| `data.object.object` | `invoice` |
| top-level `subscription` | **absent** |
| `parent` | **absent** |

So `subId` is `undefined` and the handler `break`s on its first line, before the owner lookup, before
`notifyRenewalFailed`. **The route answers 200 and writes nothing — and that is correct behaviour,
not a bug.**

⚠️ **This is a defect in THIS DOCUMENT, not an explanation of the 2026-08-21 attempt.** Corrected
after reading `PROJECT.yaml → deferred → the-lapse-notice-is-wired-not-live-proven.attempted`: that
session did **not** use the trigger route. It spliced a correctly Stripe-signed event carrying a
**resolvable** subscription id and instrumented the path — and got further than the trigger route
can reach. Its symptom is therefore still unexplained and is restated in §6 below rather than
absorbed into this one. What §2 establishes is narrower and still worth having: **anyone following
the procedure at the top of this file would learn nothing**, because a 200-with-no-row is that
procedure's expected output whether the wiring works or not.

## 3. The second reason the test could not pass, independent of the first

Even with an invoice that *did* carry a subscription id, the lookup resolves against a real row:

```sql
SELECT owner_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1
```

Production holds exactly **one** subscription row, and it is a **live-mode** id
(`sub_1U2MHx…`, status `active`, the owner's own card). A test-mode trigger mints a
**test-namespace** subscription that can never match it. So the test-mode path has no reachable
owner even in principle.

## 4. ✅ Two things that were verified in passing, and are worth keeping

- **The extractor is robust to the API version, and this nearly mattered.** The endpoint's
  `api_version` is `null`, so Stripe delivers in the **account default** — measured as
  `2026-01-28.clover` on the captured event — while `lib/billing/stripe.ts` pins
  `2026-07-29.dahlia` for outbound calls. Those are different shapes, and the handler's long
  comment about the field moving to `parent.subscription_details.subscription` is written for
  `dahlia`. `subscriptionIdOnInvoice` reads **both** candidates in order, so either shape resolves.
  Had it read only the `dahlia` path, a real renewal failure would have been dropped in production
  and this document's test would still have "passed" by writing nothing.
- **The dedupe is provable without a working mailbox.** `sendOnce` writes the audit row
  **regardless of delivery** (`detail.delivered: false` on failure) and returns `undelivered`. Since
  `sendEmailBestEffort` refuses to mail a real address from a non-production environment,
  a local run yields `undelivered` + one row, and a second run on the same invoice id yields
  `duplicate` + no row. **The mail leg and the dedupe leg are separately testable**, which the
  four-box table above conflates into one pass/fail.

## 5. What a real proof actually requires

A valid test needs a subscription invoice whose subscription id **exists in the `subscriptions`
table**. There are only three honest ways to get one, and none of them is a CLI trigger:

1. **A real live renewal failure** — wait for it, or let the owner's card genuinely fail. Proves
   everything and costs nothing to build, but is not schedulable.
2. **A test-mode subscription created through relay's own checkout**, so `checkout.session.completed`
   writes a real `subscriptions` row for it, then fail that subscription's invoice. This exercises
   the identical code path end to end. Cost: the app must run against test-mode Stripe keys, and it
   leaves a test-mode subscription row in the production table that must then be cleaned up —
   which is a destructive production write and therefore Steve's call, not a Claude action.
3. **Splice a real captured payload**: take Stripe's actual `invoice.payment_failed` event, swap the
   subscription id for the live one, sign it with the `stripe listen` secret and POST it. ⚠️ **This
   proves the route, the lookup, the notice and the dedupe, but NOT that Stripe's own delivery
   carries a resolvable id** — the one link that has never been exercised. Recorded as an option
   because it is cheap; flagged because calling its result `live-proven` would overstate it.

**Recommendation: option 1, with option 3 as an interim that is recorded as what it is.** The gate
that actually depends on this is the 2026-10-01 paywall revisit, and what that decision needs is
confidence that a failed renewal reaches the owner. Option 3 gets most of the way there and should
be labelled `wired + route-proven`, not `live-proven`.

⚠️ **Do not tick the four boxes above from a `stripe trigger` run.** They cannot be ticked that way,
and the version of this document that suggested they could is the reason this item has now consumed
two sessions.

## 6. The symptom that is still unexplained — read this before attempting again

The 2026-08-21 attempt reached further than anything above. With a correctly-signed event carrying a
**resolvable** subscription id, over **nine attempts**, instrumentation showed:

| step | observed |
|---|---|
| invoice id + subscription id resolved | ✅ correct |
| `ownerIdForSubscriptionId` | ✅ `rowCount=1`, right owner |
| `sendOnce` entered | ✅ with the right arguments |
| `noticeAlreadySent` | ✅ returned `n=0` (not a dedupe short-circuit) |
| audit row written | ❌ **none** |
| mail-refusal log written | ❌ **none** |
| HTTP response | `200 {received:true}` |

**Every branch out of `sendOnce` writes something.** `no-address` writes a row and returns; a failed
send writes a stderr line *and* a row; a success writes a row. Reaching `noticeAlreadySent → n=0`
and then producing neither a row nor a log is not a state the source can produce — which is why the
attempt concluded the running code was not the code on disk.

**That conclusion is the most likely one and it is still unproven.** `next dev` on this machine is
recorded serving modules already deleted from the file
(`feedback-next-dev-serves-stale-modules`), and `rm -rf .next` did not clear it. If the instrumented
build and the responding build were different processes, every row in that table describes a
*different program* than the one that answered 200.

**So the first thing the next attempt must establish is not the wiring — it is which build is
answering.** Put a structural marker in the response body itself (not a log line: logs were the
thing that disagreed), confirm it comes back on the same request that carries the event, and only
then read anything into an audit-row count. Until that is done, a tenth attempt produces a tenth
uninterpretable result.

⚠️ **Two environment facts that shaped the last attempt and will shape the next.** Port 3000 on this
machine is held permanently by `svchost.exe`, so two listeners can appear and requests can land
ambiguously — use a free port and `E2E_BASE`. And relay's local dev writes **production** DSQL
(`feedback-relay-local-dev-hits-production`), so "run it locally to be safe" is false here: a local
run and a production run write the same rows.


---

# 2026-08-30 — route 3 run, and the symptom is now CHARACTERISED rather than mysterious

Run under E1.2 with Steve's explicit authorisation for one fabricated-invoice audit row.
**No row was written, so the authorised cost was never spent** — six deliveries, zero rows.
`scripts/e1-route3.ts` is the harness; it reproduces this deterministically.

## What §6 asked for, and what it now says

§6 said the next attempt must first establish *which build is answering*, because the leading
explanation was that `next dev` served modules that were not on disk. That was done, and the
explanation is **eliminated**:

| established | how |
|---|---|
| A **production** build answered (`next build && next start`, port 3117, one listener) | `netstat` showed exactly one PID; §6's two-listener ambiguity did not apply |
| The **same process** answered every request | the E1.1 build marker returned `instance=fe6fe640` on both paths of a matched pair |
| Signature verification really runs | no header → `400 Unsigned`; bad signature → `400 InvalidSignature`; valid → `200` |
| `constructEvent` preserves the splice | run locally against the installed `stripe` SDK: type and subscription id survive |
| The **built** handler is correct | extracted from `.next/server/chunks`: the case, the extraction, and the lookup `R` (`SELECT owner_id FROM subscriptions WHERE stripe_subscription_id = $1`) are all right |

## The matched pair — the sharpest form of the finding

A temporary diagnostic route was built into the same bundle, replaying the handler's own steps on
the **same raw bytes** in the **same process**, and both were called back to back:

```
A  replay (in-process)  would_break_early=false   owner=0351deb3…   instance=fe6fe640
B  webhook, same bytes  status=200                                  instance=fe6fe640
   audit rows for the shared invoice id: 0
```

So every precondition the case needs is **provably satisfied in the process that answers**, and the
case still writes nothing. Payload shape is not the variable either — legacy `.subscription`, modern
`parent.subscription_details.subscription`, and both together were each delivered: `200`, zero rows.

## What this means for the labels, which is the part that matters

**E1′ is NOT `route-proven`.** It stays `wired`. Route 3 was supposed to be the cheap way to earn
that label and it did the opposite: it turned an unexplained August anomaly into a reproducible
present-tense one.

🔴 **Consequence for E4.2 (the 2026-10-01 paywall decision).** The flip means a lapsed subscription
stops the owner starting a release. The register's stated precondition is that the owner is told
their renewal failed. On this evidence **nobody can currently be told** — the notice path accepts a
correctly-signed event and records nothing, for any payload shape. Flipping the paywall on top of
that converts an expired card into a silently blocked release with no notification, which is the
exact failure `/terms` now promises does not happen.

⚠️ **And the splice is more synthetic than §5 admits**, found the same day: there was nothing to
"swap". Live mode has **zero** `invoice.payment_failed` events ever, and the only test-mode one
carries `billing_reason: manual` with **no** subscription reference in either position. Every proof
of this path to date has added a field no real payload in this account has ever carried.

## What the next attempt should do — and it is not another delivery

Stop trying to make the case pass. The evidence above says the case's preconditions hold and its
body does not run, so the next question is about **execution**, not wiring:

1. Instrument **inside** `notifyRenewalFailed` / `sendOnce` — the four branches — rather than around
   them. Everything outside has now been eliminated, twice, by two different methods.
2. Establish whether `writeAuditEntry` is reached at all for this action, given it demonstrably
   works for `owner_checkin` and `vault_item_created` on the same owner hours earlier.
3. Only then consider route 2 (E1.3). A test-clock subscription would exercise the same body and, on
   this evidence, would fail the same way — spending a Stripe test clock and a disposable owner to
   re-learn what a spliced POST already shows.
