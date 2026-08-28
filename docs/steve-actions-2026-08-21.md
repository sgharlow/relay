> # SUPERSEDED BY ROADMAP.md §6 — THE MANUAL CHECKLIST (2026-08-27)
>
> Via `docs/go-live-checklist-steve.md`, which this page was folded into on 2026-08-21 and which is
> itself superseded by `ROADMAP.md §6`. Do not work from this page.

> # SUPERSEDED BY docs/go-live-checklist-steve.md (2026-08-21)
>
> This page held four items. The replacement holds eleven sections and folds all four in whole,
> re-derived rather than copied. It was written on resuming from the one-day park, when three more
> Steve-court items were found by building the J3/J6/J9 walks.
>
> Kept rather than deleted because it is the record of what was owed on the morning of 2026-08-21.
> **Do not work from this page.**

# Steve's actions — written 2026-08-21

> **One page, four items.** `PROJECT.yaml → deferred` is the register and stays authoritative; this
> exists because four entries scattered through a 200KB YAML file is not a thing anyone reads on a
> Tuesday. If this page and the register disagree, **the register is right and this page has a
> defect**.
>
> Every number below carries the command that produces it. Do not trust a figure written here —
> figures written in prose are the drift this project keeps catching itself on.

---

## 1. The owner's vault is empty · ~20 minutes · **blocks the most**

**Why it is first.** It gates the beta cohort, and it gates the ladder claim. `invite:cohort
--commit` structurally REFUSES while it is empty, so nobody can be invited to stand by for a vault
with nothing in it. It also makes `ladder: dogfooded` a statement about a demonstration on
2026-08-08 rather than about the system as it stands.

**Check it:** `npm run verify:dogfood` — currently reads NOT READY, 5 pieces missing.
(It now runs as the read-only `relay_ro` identity, so it cannot change anything.)

**Do it** at relaystandby.com:

| # | Screen | Action |
|---|---|---|
| 1 | `/vault/new` | Add a real login — fill **Secret value**, plus **Two-factor code** (`otpauth://…` or the setup key) and **Recovery codes** |
| 2 | `/vault/new` | Add a second item, Type = **document** or **instruction** |
| 3 | `/vault` | On the login row press **Needs a code?** and answer it |
| 4 | `/circle` | Add **one recipient** and **one verifier** — nobody is emailed; invitations are owner-delivered by design |
| 5 | `/rules` | New rule: item + recipient + trigger `emergency` → **Add rule** |
| 6 | `/triggers` | Set the check-in interval and required confirmations, save |

⚠️ **Do not press Initiate.** That fires a real release and emails your verifier.

⚠️ **Not fixtures.** `scripts/reset-demo.ts` would satisfy every count in seconds and prove
nothing; the probe excludes demo-flagged owners for exactly that reason.

**Register:** `deferred → the-owners-vault-is-empty`

---

## 2. Four Stripe dashboard reads · ~10 minutes · **one of them blocks a dated gate**

Only readable in the dashboard. Item (1) is the one that matters — it decides whether the renewal
notice can be proven at all, and `ratified.beta-free-release` revisits the paywall flip on
**2026-10-01** with that proof as a stated precondition.

1. **Developers → Webhooks → `we_1U2IIGGs40KMmT4XAIradLoE`** — is **`invoice.payment_failed`** in
   its enabled events? If not, Stripe never POSTs it and no amount of correct code fires.
   ⚠️ A "send test webhook" does **not** settle this — read the endpoint's own event list.
2. **Settings → Billing → Customer portal** — cancellations **immediately** or **at period end**?
   `/terms` says you can "cancel at any time to stop the next one", which reads as period-end. If
   it is immediate, somebody cancelling on day 31 loses eleven paid months to a setting nobody chose.
3. **Settings → Emails** — are "Successful payments" customer receipts on? The product sends none
   itself, so this is the only receipt a customer gets.
4. **Webhooks** — are endpoint-failure notifications on, and to which address?

**Register:** `deferred → the-lapse-notice-is-wired-not-live-proven` (item 1 unblocks it)

---

## 3. Purge, or rule on, the dangling rows · ~5 minutes · **not urgent**

`npm run verify:orphans` exits 1 on rows whose owner no longer exists, across `verifier_codes`,
`break_glass_codes`, `auth_challenges` and `recipient_codes`.

**Every one is historical** — measured 2026-08-21, the newest predates that morning, and the eleven
disposable accounts created and closed that day added **zero**. Both cascades work. The residue came
from a hand-written `DELETE FROM users` during manual fixture cleanup, which is this repo's own
recorded trap having actually happened: `deleteAccount()` IS the integrity layer, because DSQL has
no foreign keys.

**Your call because** purging is a destructive production write with no undo, on rows nobody can
reach. Either purge them and let the census go green, or rule that retained orphans of these kinds
are acceptable and have the census report them as a NOTICE — the way it already does for the
`audit_log` rows `deleteAccount` keeps on purpose.

⚠️ **Do not close this by widening the census's ignore list without a ruling.** An orphan census
that has learned to ignore orphans is a decorative guard.

**Register:** `deferred → rows-outlived-the-accounts-that-owned-them`
(No count in the name, deliberately — it was `thirty-eight-…` until 2026-08-21 and read 36 within
the hour. Re-derive with `npm run verify:orphans`.)

---

## 4. Wire `.env.ro` into the cloud environment · ~5 minutes · **unlocks unattended verification**

A read-only production identity now exists (`relay_ro`: SELECT on everything, no writes, no DDL,
**no KMS** — so it reads metadata and can never decrypt a vault). Five verifications run under it:
`verify:schema`, `verify:dogfood`, `verify:orphans`, `flight:snapshot`, `verify:roles`.

But the credential lives **only on this machine**. Until it is a secret in the Claude Code cloud
environment, an agent running anywhere else still verifies nothing beyond `npm run gate` — which is
the entire problem it was built to solve.

**Do it:** add the contents of `relay/.env.ro` to the cloud environment as secrets, then say so and
the routine prompt can be updated to tell the agent those five are available.

⚠️ Read-only is not harmless: emails, display names and vault item titles are plaintext columns.
That is the accepted trade, and it is recorded rather than implied.

**Register:** `deferred → the-read-only-identity-is-not-in-the-cloud`

---

## Not on this list, deliberately

**G3 outreach** (Homethrive → Wellthy, NAC in parallel) is ratified and dated 2026-11-30, measured
on **meetings taken**, not signatures. **The editorial thresholds** are ratified (≥6% @ N≥50 / kill
<2% @ N≥150 / floor 50) and bind at the first placement. Neither is blocked on anything above —
they are the demand lane, which is the only lane that moves a gate, and it has not moved in six
sprints. That is the finding, not a task.
