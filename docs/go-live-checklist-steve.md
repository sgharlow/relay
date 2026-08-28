> # SUPERSEDED BY ROADMAP.md §6 — THE MANUAL CHECKLIST (2026-08-27)
>
> Revision 4 of `ROADMAP.md` carries the single checklist of every manual step that cannot be
> automated, organised by sitting and dated from `PROJECT.yaml`. This page is kept as the record of
> what was owed on 2026-08-21 and is **not to be worked from**: it omits four rulings (FR9, the
> paywall's 1-of-4 paths, the three chosen numbers + self-naming, the A0 dead-man) and carries
> defects the register corrected — the lapse-notice dedupe key is the INVOICE id, not the event id;
> the DMARC batch dated ~09-10 was already rescued while the Gmail filter was never created and
> `_dmarc` now carries no `rua=`; Stripe reads #1/#2 are CLI-readable; `verify:kms` runs daily in CI
> via OIDC; the ladder describes 2026-08-08, not 2026-06-27.

# Relay — the go-live checklist · everything that needs Steve

> **Written 2026-08-21, on resuming from the one-day park.** This supersedes
> `docs/steve-actions-2026-08-21.md`, which held four items and is now folded in here whole.
>
> **`PROJECT.yaml → deferred` and `→ gates` remain the register and stay authoritative.** This page
> exists because a dozen entries scattered through a 250KB YAML file is not a thing anyone reads on
> a Friday night. **If this page and the register disagree, the register is right and this page has
> a defect.**
>
> **Every number below carries the command that produces it.** Do not trust a figure written here —
> figures written in prose are the drift this project keeps catching itself on. Anything with a
> date attached was true on 2026-08-21 and says so.

---

## How to read this

Relay is **already deployed, live, and taking live-mode payments**. "Going live" is not a deploy —
it is closing the gap between a product that works and a product somebody who is not Steve uses.
So the list below is ordered by **what unblocks the most**, not by effort.

| | meaning |
|---|---|
| 🔴 | blocks something else, or has a real deadline |
| 🟠 | owed, no hard date |
| 🔵 | a decision, not a task — nothing gets built until it is made |
| ⏱️ | honest time estimate, assuming nothing goes wrong |

**Claude's court is empty of everything that could be automated.** What is left here is what needs
your hands, your credentials, your money, or your judgement. Where Claude could do a half, that
half is already done and the row says so.

---

# 1 · 🔴 The owner's vault is still empty · ⏱️ ~20 min · **blocks the most**

**This is the same item that led the 2026-08-21 list and it has not moved.** Re-derive before
believing that sentence:

```bash
npm run verify:dogfood      # reads as relay_ro — it cannot change anything
```

As of 2026-08-21 22:00 it reads **NOT READY, 5 pieces missing**: 1 real owner account, and then
zero of everything else — no vault items, no recipients, no verifiers, no access rules, no
configured trigger.

### Why it is first

It gates two things at once.

- **`invite:cohort --commit` structurally REFUSES while the vault is empty.** So nobody can be
  invited. The beta cohort has now been deferred twice, and Sprint 2 cannot start without this.
- **`ladder: dogfooded` is a claim about 2026-06-27, not about the system as it stands.** The
  dogfood was real; the only account in production today holds zero items and names nobody. A
  present-tense reading of the ladder does not survive the probe above.

### Do it at relaystandby.com

| # | Screen | Action |
|---|---|---|
| 1 | `/vault/new` | Add a real login — fill **Secret value**, plus **Two-factor code** (`otpauth://…` or the setup key) and **Recovery codes** |
| 2 | `/vault/new` | Add a second item, Type = **document** or **instruction** |
| 3 | `/vault` | On the login row press **Needs a code?** and answer it |
| 4 | `/circle` | Add **one recipient** and **one verifier** — nobody is emailed; invitations are owner-delivered by design. ⚠️ One person can wear both hats: tick both boxes, enter them once |
| 5 | `/rules` | New rule: item + recipient + trigger `emergency` → **Add rule** |
| 6 | `/triggers` | Set the check-in interval and required confirmations, save |

⚠️ **Do not press Initiate.** That fires a real release and emails your verifier.

⚠️ **Not fixtures.** `scripts/reset-demo.ts` would satisfy every count in seconds and prove
nothing. The probe excludes demo-flagged owners for exactly that reason.

🔴 **NEW, and it changes step 5's importance.** A walk built on 2026-08-21 found that an owner who
has named and invited somebody but has **not yet written an access rule** can be asked for access,
can deny, and **cannot approve** — see §7. **Do step 5 before anyone claims an invitation** and you
never meet it.

**Register:** `deferred → the-owners-vault-is-empty`

---

# 2 · 🔴 Four Stripe dashboard reads · ⏱️ ~10 min · **one blocks a dated gate**

Only readable in the dashboard — no CLI answers these. **Item 1 is the one that matters**: it
decides whether the renewal-failure notice can be proven at all, and `ratified.beta-free-release`
revisits the paywall flip on **2026-10-01** with that proof as a stated precondition.

1. **Developers → Webhooks → `we_1U2IIGGs40KMmT4XAIradLoE`** — is **`invoice.payment_failed`** in
   its enabled events?
   ⚠️ A "send test webhook" does **not** settle this — read the endpoint's own event list.
   ✅ *Believed fixed 2026-08-21* — the endpoint was found unsubscribed and re-subscribed. **Read it
   back anyway.** ⚠️ `--enabled-events` **replaces** the list, so confirm all four are still there.
2. **Settings → Billing → Customer portal** — do cancellations take effect **immediately** or **at
   period end**? `/terms` says you can "cancel at any time to stop the next one", which reads as
   period-end. If it is immediate, somebody cancelling on day 31 loses eleven paid months to a
   setting nobody chose.
3. **Settings → Emails** — are "Successful payments" customer receipts on? The product sends none
   itself, so this is the only receipt a customer ever gets.
4. **Webhooks** — are endpoint-failure notifications on, and to which address?

**Register:** `deferred → the-lapse-notice-is-wired-not-live-proven`

---

# 3 · 🔴 E1′ — prove the renewal-failure notice · ⏱️ ~30 min · **CO-PILOT, not solo**

**Status: `wired`, not `live-proven`.** `lib/billing/lapse-notice.ts` ships and is deduped on the
Stripe event id. It has never been exercised against Stripe.

### The two halves, and the second is the one that gets skipped

1. Fire a real `invoice.payment_failed` at the production webhook → confirm **exactly one** email.
2. **Re-deliver the same event → confirm nothing is sent.** This is the only thing that proves the
   dedupe, and it is the half everybody skips.

### 🔴 The prescribed method does not work — read this before trying

**`stripe trigger` CANNOT prove E1′.** It mints a **one-off invoice with no subscription**, so the
handler correctly ignores it and answers 200 having written nothing — **indistinguishable from
broken wiring.** A green 200 here means nothing at all.

⚠️ **The 9-attempt `sendOnce`-entered-then-nothing symptom is still unexplained.** Before anything
else, the next attempt must prove **which build is answering**, via a marker in the **response
body** — not a log line. A log can come from a different deployment.

⚠️ Dedupe keys on the **INVOICE id**.

**Read `docs/e1-stripe-lapse-proof.md` §5 for the three viable routes.** The four-box table in that
doc's top half cannot be ticked from a trigger run.

**Why co-pilot:** it touches live billing on a shared Stripe account, and a mis-fire sends a real
customer a real "your payment failed" email. Claude preps and drives; you approve each step that
leaves the machine.

---

# 4 · ✅ RULED AND SHIPPED 2026-08-21 — the approve-before-first-rule defect

**You ruled option C — both halves — in the session it was found. It is fixed, tested and
live-proven.** Kept here rather than deleted so the next reader sees what changed and why.

### What was wrong

`release_state` rows are provisioned by `POST /api/rules`, **not** by naming a recipient, and the
approve arm required one. An owner who had named and invited somebody but written no rule could be
*asked* for access, could *deny*, and **could not approve**. Worse: `claimRequest` committed
`status = approved_by_owner` **before** the lookup that threw, and they were not in one transaction
— so the failed approve **burned the request** and wrote an audit event saying the owner had
approved something that never happened.

### What shipped

In `lib/release/challenge.ts`, the approve arm now peeks at the open request, calls
`ensureReleaseState` (idempotent — unchanged for every owner who already has a row), and **only
then** claims the request.

⚠️ **The order is the half that outlives this bug.** There is no path back from
`approved_by_owner` to `awaiting_owner`, so *any* throw between the claim and the first transition
consumed the request forever, whatever caused it. Nothing is claimed now until the thing it is
claimed for is known to exist.

### Proof

- **Unit** — `lib/release/challenge.test.ts` gained three tests: the release read happens at a
  lower call index than the claim; no `UPDATE access_requests` occurs when provisioning throws; an
  unknown request id provisions nothing. **12 pass.**
- **Live** — `scripts/e2e-request.ts` re-run against production: an owner with no rule approves
  (200), the row is provisioned to `grace`, and answering twice is refused without a second row.
  **33/33.**

The two walk assertions were written **inverted**, asserting the defect, so fixing it would turn
them red. It did. They now assert the fix and carry the history in place.

**Register:** `deferred → approve-is-unreachable-before-the-first-rule` (closed)

---

# 5 · ✅ GATE RATIFIED 2026-08-21 · 🔴 **the drill itself has NOT run** · ⏱️ ~2h + cluster cost

**You ratified the gate in the session it was drafted.** `gates.d3-restore-drill` now exists —
owner **steve**, due **2026-11-08**, four criteria, pointing at `docs/backup-restore-runbook.md`.
Confirmed parsed by `lib/ops/gates.test.ts`, so it is now something that can turn **red on its own**
when the date passes with no recorded decision.

⚠️ **Ratifying is not running.** What changed is that the absence is now *measured*. Before it,
"quarterly" was a word in two planning documents with no owner, no trigger and no absence alarm —
the exact dead-man's-switch failure this portfolio has a standing rule about.

### What is still owed, and it is yours

| | criterion | state |
|---|---|---|
| 1 | `node scripts/backup-now.mjs` → restore to a **scratch** cluster | 🔵 needs AWS admin + cluster cost |
| 2 | `npm run verify:kms` — CMK present, enabled, not scheduled for deletion | ✅ **ready** — it could not run its own command until 2026-08-21; now green |
| 3 | **One real item through the reveal path** against the scratch endpoint | 🔵 ⚠️ override `DSQL_PRIMARY_ENDPOINT` in a **throwaway** env file — **never** by editing `.env.local`, which points at production and is the only copy |
| 4 | Record the RTO **observed**, delete the scratch cluster, confirm both production clusters `ACTIVE` with deletion protection | 🔵 |

⚠️ **The 2026-08-08 run does not count toward this.** A restored cluster is ciphertext without the
key; that run restored a database and never unwrapped an item, so it proved a database restore
rather than a recovery. The criterion did not exist yet — but it means this gate starts with **no**
satisfying evidence, not with evidence three months old. **2026-11-08 is the ceiling, not the
target.**

**Register:** `deferred → no-recurring-restore-drill-exists` (closed) · **Gate:**
`gates.d3-restore-drill` (live — read that, not this page, for current state)

---

# 6 · 🟠 Purge, or rule on, the dangling rows · ⏱️ ~5 min

```bash
npm run verify:orphans      # read-only; exits 1 when any row is orphaned
```

**Measured 2026-08-21 22:00: 28 rows** across `verifier_codes` (17), `break_glass_codes` (10) and
`recipient_codes` (1). Re-derive rather than quoting that — the number moves.

**Every one is historical.** Both cascades work. The residue came from a hand-written
`DELETE FROM users` during manual fixture cleanup — this repo's own recorded trap, having actually
happened: `deleteAccount()` **is** the integrity layer, because DSQL has no foreign keys.

**Your call because** purging is a destructive production write with no undo, on rows nobody can
reach. Either purge them and let the census go green, or rule that retained orphans of these kinds
are acceptable and have the census report them as a NOTICE — the way it already does for the 2473
`audit_log` rows `deleteAccount` keeps on purpose.

⚠️ **Do not close this by widening the census's ignore list without a ruling.** An orphan census
that has learned to ignore orphans is a decorative guard.

**Register:** `deferred → rows-outlived-the-accounts-that-owned-them`

---

# 7 · 🟠 Wire `.env.ro` into the cloud environment · ⏱️ ~5 min · **unlocks unattended verification**

A read-only production identity exists (`relay_ro`: SELECT on everything, **no writes, no DDL, no
KMS** — so it reads metadata and can never decrypt a vault). Five verifications run under it:
`verify:schema`, `verify:dogfood`, `verify:orphans`, `flight:snapshot`, `verify:roles`.

**But the credential lives only on this machine.** Until it is a secret in the Claude Code cloud
environment, an agent running anywhere else verifies nothing beyond `npm run gate` — which is the
entire problem it was built to solve.

**Do it:** add the contents of `relay/.env.ro` to the cloud environment as secrets, then say so.

⚠️ **Read-only is not harmless.** Emails, display names and vault item **titles** are plaintext
columns. That is the accepted trade, recorded rather than implied.

🔴 **Same shape, newly found:** `.env.admin` is also local-only, so `npm run verify:kms` — the check
whose failure is **permanent** — can only run on this laptop. Worth solving together.

**Register:** `deferred → the-read-only-identity-is-not-in-the-cloud`

---

# 8 · 🔵 Rule on the signup ceiling · ⏱️ ~5 min to decide

**Found four times in one session, each time as a bare `ERROR: signup begin 429` part-way through a
run — which reads as a flaky test and is not one.**

`/api/auth/signup` allows **10 per hour per IP**. One full `verify:live` chain performs **exactly
10 signups**. So the release gate's live half runs at **100% of its own rate limit, with zero
headroom** — any new assertion needing an account breaks the chain **mid-run**, and it cannot be
run twice in an hour without restarting `npm run dev`.

This already shaped the architecture: the three new journey walks ship as a **separate**
`verify:journeys` chain because of it. That should be a deliberate decision, not one inherited from
an unexamined constant.

⚠️ **Raising `LIMIT` is the wrong fix.** It is the owner front door's abuse control.

| | option | note |
|---|---|---|
| A | **Leave it and say so** — two chains, documented, run an hour apart | ⭐ What shipped 2026-08-21. Costs nothing |
| B | **Exempt the reserved domains** (`.test`/`.invalid`/`.localhost`) | ⚠️ Puts a bypass in an abuse control keyed on caller-suppliable input |
| C | **A separate test cluster** | The standing answer to the whole class; already deferred until the first paying customer. Costs money |

**Register:** `deferred → the-live-chain-sits-at-its-own-signup-limit`

---

# 9 · 🔴 The demand lane — the only lane that moves a gate

**Nothing here is blocked on anything above.** It has not moved in six sprints. That is the
finding, not a task.

| | item | detail |
|---|---|---|
| 9.1 🔴 | **Op-ed → caregiver.com** | Voice pass, cover email, Word doc derived from the final text with the contact block. `docs/oped-angle-3-draft.md` has the send checklist. ⚠️ **Re-check the submission route before sending — it moved twice in three days** (`docs/g1-outlet-dossier.md`) |
| 9.2 🔴 | **The Caregiver Space** | The submission **is** the finished piece; no pitch is reviewed |
| 9.3 🔴 | **Beta cohort** | `npm run invite:cohort --commit` — **blocked on §1**. Deferred twice already; a third deferral is a legitimate ruling and an unrecorded one is not. If it defers again it needs a `revisit` date |
| 9.4 🟠 | **Partner outreach → meetings** | Homethrive → Wellthy; NAC Innovation Collaborative in parallel. G3's kill is measured on **meetings taken**, not signatures. Due 2026-11-30 |

**On placement day, in the same commit that records the placement:** the `ed-*` src enters
`GATE_LANES`, then day-of `npm run verify:funnel` + `npm run flight:snapshot`, then flight-log
entries as readers arrive.

✅ **Editorial thresholds are already ratified** — pass ≥6% @ N≥50 · kill <2% @ N≥150 · floor N=50.
⚠️ **They cannot be set late.** A number chosen after the result is a fabricated gate.

---

# 10 · 🟠 Deliverability · one item has a hard expiry

| | item | detail |
|---|---|---|
| 10.1 🔴 | **DMARC report rescue** · ⏱️ 2 min · **hard expiry ~2026-09-10** | Gmail filter + untrash before the trash purge. After that date the reports are gone and the clock restarts. `docs/deliverability-options-3-and-5.md` §"A deadline nobody set" |
| 10.2 🟠 | **Outlook sender support** | Resend ticket, then the Microsoft form. Ready-to-send; ⚠️ the evidence must not be touched. `docs/outlook-sender-support-submission.md` |
| 10.3 🔵 | **DMARC step-up** (`p=none`→`quarantine`, `~all`→`-all`) | **Only after** reports accumulate post-10.1. Doing it first blinds you |

---

# 11 · 🅿️ Deliberately parked — listed so they are not rediscovered as new

| item | state |
|---|---|
| **SMS / A2P 10DLC** | Parked 2026-08-15. Route settled as **Sole Proprietor** — ⚠️ the A2P doc's "Standard, LLC" line predates that ruling and is stale. 2–4 week lead time; resumes at Sprint 6, when a concrete need exists |
| **Stripe merchant name** (shared personal account header) | Re-decide **only if** a real customer remarks |
| **B5 — KMS-level tenant separation** | Design written, build deferred. **Re-enters scope the moment a stranger stores anything real** |
| **`verify:live` in CI** | Ruled deferred until the first paying customer — the walks write to production |
| **next-auth v5 / React 19** | ⚠️ **Barred** by the Infrastructure Change Policy absent a documented problem. Recorded so nobody "discovers" it and starts one |
| **Paywall flip** (`TIER_LIMITS.free.canRelease`) | 2026-10-01 revisit. ⚠️ **§3 is a stated precondition** — flipping it over an unproven lapse notice turns an expired card into a silently blocked release |

---

## What Claude finished, so you can see the boundary

Nothing below needs you. Listed only so the split is legible.

- **The park is unwound** — `STALE_AFTER_DAYS` restored 70 → 14, so the `verify:live` dead-man fires
  again ~2026-09-04 instead of ~2026-10-30. Both dated obligations returned to their own dates.
- **J3, J6, J9 and J4 have automated cover for the first time** — 81 new live assertions in
  `npm run verify:journeys`, plus `/circle` in a real browser (`e2e-ui` 26 → 34 checks). This closes
  D10, the stale-journey-sweep item, by building walks rather than re-dating a table.
- **Two product defects found by those walks** — §4 and §8 above. Both recorded with options rather
  than quietly fixed inside a verification change.
- **`verify:kms` can run its own command again** — it could not, and it is the check whose failure is
  permanent.
- **The suite no longer goes red on machine load** — seven import-heavy tests were blowing a 5s
  budget under parallel load; two of three full runs were failing. Fixed without weakening any
  assertion; three consecutive clean runs since.
- **Both of your rulings from 2026-08-21 are implemented** — the approve fix (§4) is shipped, unit
  tested and live-proven, and the restore-drill gate (§5) is ratified and parsing.

## What is left, in one line

**Six items, and the first one has led every version of this list for two days:** fill the owner's
vault (§1), four Stripe reads (§2), prove E1 (§3), rule on the orphans (§6), put `.env.ro` in the
cloud (§7), rule on the signup ceiling (§8) — then the demand lane (§9), which is the only lane that
moves a gate and has not moved in six sprints.
