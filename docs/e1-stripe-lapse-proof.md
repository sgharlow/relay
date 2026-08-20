# E1′ — proving the lapse notice, end to end

**Status:** `wired`, not `live-proven`. Every rule in `lib/billing/lapse-notice.ts` is unit-tested;
the wiring has never met Stripe. **Owner: Steve.** ~10 minutes.
Register entry: `PROJECT.yaml → deferred → the-lapse-notice-is-wired-not-live-proven`.

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
