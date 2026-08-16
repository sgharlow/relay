# G1 flight log — the record the verdict is written from

> Closes item 9 of `g1-launch-checklist.md` ("log window start date + N-counting rules").
> Thresholds, price and budget are NOT restated here — they live in `PROJECT.yaml`
> (`gates.g1-caregiver-wtp`), `g1-wtp-test-design.md` and `g1-channel-send-kit.md`.
> This file holds only what those cannot: what actually happened, day by day.

## Window

| | |
|---|---|
| **Window start** | _fill on the day the first ad is APPROVED and serving — not the day it was submitted_ |
| **Window end** | start + 4 weeks, or N ≥ 100 qualified, whichever first (decision #4, ratified 7-03) |
| **Gate hard-stop** | **2026-10-02** (`PROJECT.yaml` `gates.g1-caregiver-wtp`) — the window ends here regardless of N |
| **Serving-by** | **~2026-08-28** (derived, `g1-ad-creatives.md`) — submit by ~2026-08-26 |
| **Ladder at flight start** | `dogfooded` · `wtp_evidence: none` · `caregiver_leads` = 0 rows (re-verified live 2026-08-14) |

> ⚠️ **This row has been wrong once and has now moved twice. Read it from `PROJECT.yaml`, never
> from memory.** It said 2026-09-15 for three days after the gate moved on 08-11, while citing
> `PROJECT.yaml` as its source — `g1-ad-creatives.md` was rebased that day, this file and
> `g1-launch-checklist.md` were missed.
>
> ✅ **Then the gate moved EARLIER, to 2026-10-02, on 2026-08-14 (Steve).** The 08-11 derivation
> was overtaken within three days: sprints C-E were budgeted at four weeks to ~09-08 and landed
> 08-14, and the landing page was made ad-policy compliant the same day — so the condition the
> flight was being held for is satisfied. Re-derived rather than adjusted: ad sitting ~2 weeks →
> **serving by 08-28**; 4-week window → **09-25**; one week of slack for a single
> rejection-and-resubmit cycle → **10-02**.
>
> **Phase 0 is deliberately NOT in that chain.** The 08-11 derivation put it in series between the
> build and ad serving; that contradicted `ratified.build-standby-before-g1` ("can run in parallel
> at no engineering cost") and the mechanics — neither lane's conversion path touches the claim
> flow. It stays at **N = 0** and stays important; it is simply not a precondition for what this
> gate measures. Full record: `PROJECT.yaml` `gates.g1-caregiver-wtp.moved`, second entry.

## What N is, precisely

**N = count of `caregiver_qualified` events whose `src` is a DECLARED PAID LANE.**

> ⚠️ **CHANGED 2026-08-16, ratified by Steve** (`PROJECT.yaml`
> `ratified.g1-n-is-an-allow-list`). This was *"tagged, not `direct`, and not in the excluded
> sets"* — a deny-list, which counted anything labelled that nobody had thought to exclude. A
> newsletter, a launch post, a founding-family link: none carries a priced numerator, so each
> pushed the ratio one way only, toward the `<0.5%` that kills D2C, **silently**. It is now an
> allow-list — `GATE_LANES` in `src/app/caregivers/content.ts` — whose failure mode is loud
> instead: an undeclared lane reads zero on day one, which nobody can miss.
>
> Taken before any traffic existed because there is no retroactive version. **Thresholds, the
> window, the N≥100 stop and both lane definitions are untouched;** this narrows who enters the
> denominator, not what the gate asks.

Enforced by `isGateQualifyingSrc()` and pinned by `content.test.ts`. It is **not** a matter of
dashboard discipline; do not re-derive it by eye. The exclusion sets below are now redundant
rather than load-bearing, and are kept as a second lock and as the record of why each value is
not audience.

| Excluded set | Values | Why |
|---|---|---|
| untagged | `direct`, empty | not attributable to a caregiver-targeted channel |
| `SHOWCASE_SRCS` | `h0-demo`, `h0-home` | real humans, wrong audience — H0-win traffic. Read as a separate secondary segment ("did the tech audience contain caregivers?") |
| `QA_SRCS` | `qa`, `preflight` | **us.** Instrument verification, not demand |
| beta | `beta`, and anything starting `beta-` | **recruited, and recruited to the FREE plan.** They land in the denominator and can never reach the priced numerator, so they bias the ratio one way only — toward the `<0.5%` kill. A prefix rather than a list, so a tag nobody has invented yet is still covered. Added 2026-08-16 per `PROMPTS.md` §6, which pre-committed it as a pre-flight blocker the moment beta recruitment revived |

Both sides of the ratio resolve `src` through the same session-parked channel
(`qualifiedProps` / `intentProps`), so a visitor counts under one label on both sides.
Before 2026-08-10 the denominator read the URL and the numerator read parked storage, and
they could disagree — see "Corrections applied before the flight" below.

## The ratios to record

1. **Lane-A-only (THE RATIFIED GATE):** `caregiver_intent` where `cta ∈ {hero, nav, pricing}`
   ÷ all gate-qualifying `caregiver_qualified`.
2. **Blended:** all `caregiver_intent` ÷ all gate-qualifying `caregiver_qualified`.
3. **Lane-B:** `caregiver_intent` where `cta = start` ÷ the same denominator.
4. **Per-lane:** each of the above, filtered to one `src`. This is what the paid budget exists
   to buy; it is only computable because both events share the channel vocabulary.

## Known offsets — subtract before reading

Every event we caused ourselves goes here. An offset that is not written down on the day it
happens is not recoverable later.

| Date | Event(s) | `src` | Counts toward N? | Note |
|---|---|---|---|---|
| 2026-08-10 | 1 × `caregiver_intent` | `visual-check` | **No** | Pre-flight audit walk. Emitted because a stale channel was parked in the QA browser profile — the asymmetry fixed the same day. Not a lane value, so it filters out of every lane read; recorded because it is in the dashboard. |
| _(fill)_ | 1 × `caregiver_qualified` | `reddit-ads` | **Yes — subtract 1** | Part-2 verification click (`g1-ad-creatives.md`). Deliberately no intent, so it biases the ratio DOWN, never up. |

## Daily snapshot

Fill one row per day. Numbers come from Vercel Analytics → Events and a `caregiver_leads`
count; do not carry a number forward from the previous row.

**`npm run flight:snapshot`** prints the row ready to paste — the lead count, which channels the
leads came from, and **the notes quoted**, which verdict line 4 expects to carry the decision on a
directional read. It leaves the two analytics cells marked for the human reading the dashboard, on
purpose: a second path to N would be a second definition of the number this gate turns on. It is
read-only and connects as `relay_dev`, which cannot write `caregiver_leads`.

| Day | Date | Spend to date | Qualified (N) | Lane-A intents | Lane-B intents | Leads | Lane-A ratio | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

## Verdict — the five lines, in this order

Per the 2026-08-08 amendment (approved by Steve). Write all five; do not stop at line 1.

1. `caregiver_intent ÷ caregiver_qualified` on **Lane A**, with N.
2. **Whether N reached ~250.** Determines whether line 1 is decisive or directional.
3. Count of `caregiver_lead_submitted` — contactable humans, the harder signal.
4. **The lead notes, quoted.** Whether the pain we assumed is the pain they describe.
5. Ship / kill / iterate, and **which line drove it.**

> ⚠️ **Ratified 2026-08-10 (Steve): this flight is expected to return a DIRECTIONAL read.**
> The amendment puts the honest minimum at N ≈ 250; the ratified $250 ceiling buys roughly
> 125–200 clicks at $1–2 CPC, less ad-blocker suppression — so N ≈ 100–180. Steve chose to
> hold the ceiling and accept that knowingly rather than raise it. Therefore:
> **a ship or kill call on line 1 alone is not permitted for this flight.** Lines 3 and 4 —
> the leads and what they say — are expected to carry the decision.

## Pre-flight gate — PASSED 2026-08-10 (co-pilot sitting 1, no money committed)

Driven in a real browser against production, payloads read off the wire. This closes the
pre-flight gate in `g1-ad-creatives.md`; the ad accounts may now be created.

| Step | Evidence | Result |
|---|---|---|
| Clean session | `sessionStorage` empty, no auth cookie, before first load | ✅ |
| 1–2 · denominator | instrument loaded first-party (`/b079b94dacb289b4/script.js`), channel parked as `qa` | ✅ |
| 3 · Lane-A numerator | `caregiver_intent` `{"src":"qa","cta":"hero"}` — **same `src` both sides** | ✅ |
| 4 · lead capture | POST carried `src:"qa"`, `cta:"hero"`, honeypot empty, `renderedAt` present; `caregiver_lead_submitted` `{"src":"qa","cta":"hero","withNote":"true"}`; row written with `notified:true` | ✅ |
| **5 · Lane-B numerator** | **first live proof — see below** | ✅ |
| 6 · cleanup | test account deleted (8 vault items), lead row deleted, `caregiver_leads` re-read at **0**, users back to the 2 protected baselines | ✅ |

### Step 5 — the Lane-B numerator, live-proven for the first time

It had been **unit-pinned only** since the 2026-08-10 fix. Defect A shipped for two days with the
suite green, so a passing test was not accepted as proof. Walked end to end: signup → TOTP
enrolment → 8-item seed → risk-graph reveal → price card, stopping at Stripe's hosted page without
completing checkout. Captured in order:

| # | Event | Payload |
|---|---|---|
| 1 | `POST /api/stripe/checkout` | the **Stripe branch** was taken (session came back `cs_live_…`) |
| 2 | `intent_clicked` | `{"src":"qa","cta":"start-price-card","price":"119"}` |
| 3 | **`caregiver_intent`** | **`{"src":"qa","cta":"start"}`** — exactly one |

Three things this proves that the unit test could not: the numerator fires **on the Stripe branch**
(the branch a real buyer takes), `src` resolves to the **parked channel** `qa` rather than the
`hero-product` value sitting in the URL — so Lane B is keyed to the channel like the denominator —
and `cta:"start"` is present, which is what makes the ratified Lane-A-only ratio separable.
Envelope encryption was observed working live alongside it (`/api/kms/wrap` → `/api/vault/items`).

⚠️ **An abandoned `cs_live_` checkout session exists from this walk.** Nothing was charged — no
payment details were entered — and Stripe expires uncompleted sessions. No action needed; recorded
so it is not mistaken later for a real customer starting checkout.

### ✅ RESOLVED 2026-08-14 — the landing page carried the copy shape the ads were rewritten to avoid

**Steve's call: option (b) — rewrite into third person before the first submission.** Taken now,
while zero qualified traffic has ever seen either version, so nothing measured is invalidated.

Three strings changed in `src/app/caregivers/`, not one. The finding below named `SUBHEAD`; the
same defect was one field away in copy the finding never looked at:

| Constant | Was | Now |
|---|---|---|
| `SUBHEAD` | "When a parent lands in the hospital, **you** need **their** accounts NOW" | "A hospital stay can mean a family suddenly needs access to accounts only one person could reach" — §1a's own sanctioned example |
| `OG_DESCRIPTION` | "Opens for **you** in a real emergency, seals itself when **they** recover" | "Opens to the people named in it when an emergency is confirmed, then seals itself on the next check-in" |
| `DIFFERENTIATORS[2].relay` | "built for the emergencies **you** actually face — which are usually survivable" | "…the emergencies **families** actually face…" — R3's exposed phrase, verbatim, still on the page |

`OG_DESCRIPTION` is the one worth dwelling on: it lived in `page.tsx`, outside the file whose whole
stated purpose is that gate-governed copy be testable without rendering RSC — **so the rule that
fixed the ads could not see it, and it is the copy a reviewer's crawler reads rather than skims.**
It has moved into `content.ts` with the rest.

**What did NOT change:** the price, the CTA, the reversibility lead, "No rival does the second
half", every `src` exclusion rule, and both lane definitions. The gate measures the same thing.

**The rule is now a test, not a note** (`content.test.ts`, "landing copy is ad-policy compliant at
the destination"). §1a stated it in prose — *never join "you/your" to a health event or a
relative's condition* — and prose is exactly why the ads were fixed and the destination was not.
The test checks co-occurrence inside a single sentence across every string on the page, carries a
negative case proving it can fail on the text that actually shipped, and caught a fourth join
during the fix that no human read had noticed ("a **recovery** check-in … so nothing **you** share").

Second person is untouched everywhere it is harmless, which is most of the page: "Encrypted in your
browser", "the trigger you chose", "Start your family's vault". The attribute is not the violation.

**Original finding follows, unedited.**

### 🔴 Finding — the LANDING PAGE carries the copy shape the ads were just rewritten to avoid

Observed while walking the funnel. `/caregivers` leads with:

> "When a parent lands in the hospital, **you** need **their** accounts NOW"

That is the same second-person-plus-family-health construction that `g1-ad-creatives.md` §1a
removed from four creatives — and **ad reviewers visit the destination**, so compliant ad copy
pointing at a non-compliant landing page is only a partial mitigation.

**Deliberately NOT changed, and it needs a decision before submission.** `SUBHEAD` in
`src/app/caregivers/content.ts` is the ratified instrument copy, pinned by `content.test.ts`
(reversibility-led). Editing it mid-flight changes the thing being measured, and the gate rules
were set against this page. The options are (a) leave it and let review rule, (b) rewrite the
subhead into third person before the first submission — cheapest now, before any traffic exists to
invalidate, or (c) rewrite only if a creative is rejected on personal attributes. **Steve's call.**

## Corrections applied before the flight (2026-08-10, pre-send audit)

Three measurement defects were found and fixed before any money was spent. Recorded here
because each one would have distorted the number this file exists to produce.

| | Defect | Direction of error | Fix |
|---|---|---|---|
| A | A Lane-B visitor who **bought** emitted no `caregiver_intent` — the price card redirects to live Stripe, and the interest page (the only emitter) had become the unreachable fallback | **false KILL** | `lib/analytics/lane-b.ts` — the Stripe branch emits the numerator, the fallback branch does not; `lane-b.test.ts` pins exactly one per click |
| B | Denominator read `window.location.search`, numerator read the parked channel — they disagreed on an untagged visit in a session that already had a channel. Observed live: `caregiver_qualified {"src":"direct"}` beside `caregiver_intent {"src":"visual-check"}` | **false PASS** | `qualifiedProps()` in `analytics.ts` — both sides now resolve through one function |
| C | No gate-excluded QA source, while the docs made a self-click mandatory | **false PASS** | `QA_SRCS` in `content.ts`; verification split into a gate-safe part 1 and a single recorded real click in part 2 |

All three landed with tsc + lint + build clean and the suite green. Derive the count with
`PROJECT.yaml: derived.test_count` — a number written here would be wrong within a week, which
is the whole reason that field exists.
