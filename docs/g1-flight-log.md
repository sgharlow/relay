> # ⛔ THE FLIGHT NEVER FLEW. Closed 2026-08-16 with every row empty.
>
> Paid advertising was abandoned before a single ad served (`PROJECT.yaml`
> `ratified.retire-paid-advertising`). No money was spent, the window never opened, `caregiver_leads`
> finished at **0**, and no `caregiver_qualified` event was ever emitted by a paid visitor.
>
> **Nothing in this log is a measurement of demand.** It is the record of an instrument that was
> built, verified alive, and then found to have no traffic it could legitimately buy. The
> N-counting rules, the exclusion sets and the five-line verdict template are all retained and
> still correct — the replacement lane in `docs/g1-editorial-lane.md` reports into this same
> structure, and its per-lane ratio (#4) is how editorial gets read separately.

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

> ### 🔴 LANE 1 CHANGED THE SAME DAY — Reddit out, Google search intent in (2026-08-16)
>
> `GATE_LANES` is now **`google-ads`, `meta-ads`**. `reddit-ads` was removed hours after the
> allow-list shipped, which is the first time the mechanism earned itself: **an unlaunched Reddit
> campaign draft still exists in the ad account**, and under the deny-list it replaced, its traffic
> would have counted toward N the instant anybody pressed the wrong button.
>
> **Why Reddit closed.** It sells no caregiver targeting. `dementia` and `Alzheimers` are refused
> on ToS as health-condition targeting; `AgingParents`, `CaregiverSupport` and `caregiv` return
> *No Search Results* while `personalfinance` returns r/personalfinance 21.8M in the same field.
> Keyword targeting was tested as the fallback and failed a threshold set before the number was
> seen — 251.2m–314.1m under US-only scoping. Full evidence: `docs/g1-ad-creatives.md` §Targeting;
> decision: `PROJECT.yaml` `ratified.g1-lane-1-is-google-search-intent`.
>
> **Nothing measured is invalidated, because nothing was measured.** No ad ever served, no money
> was spent, the window never opened and `caregiver_leads` is at 0. The thresholds, the window, the
> N≥100 stop and the ratios above are all untouched — only the channel that fills them changed.

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

## 🔴 A7.0 — WEB ANALYTICS IS NOT COLLECTING ANYTHING READABLE (measured 2026-08-29)

**Answer: enabling Web Analytics is a HARD precondition of a placement, and it is a dashboard
toggle nobody has thrown.** The measurement also disproves the check the roadmap proposed for it,
which is the more useful half.

Four probes, all read-only except the last two, which POST a synthetic event marked `src=qa`:

| Probe | Result |
|---|---|
| Query API — `get_web_analytics` (Vercel MCP), `prj_VYyOXbThp35KaCQpJs3mhmASJf18` | **400 `web_analytics_not_enabled`** |
| `GET /_vercel/insights/script.js` | **200**, `application/javascript`, 2,495 bytes |
| `POST /_vercel/insights/view` | **200 `OK`** |
| `POST /_vercel/insights/event` (with `en` + `ed.src=qa`) | **200 `OK`** |

Re-derive rather than trust:

```bash
node -e 'fetch("https://relaystandby.com/_vercel/insights/script.js").then(r=>console.log(r.status))'
node -e 'fetch("https://relaystandby.com/_vercel/insights/view",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({o:"https://relaystandby.com/?src=qa",ts:Date.now(),r:"",sv:"1.0.0",sdkn:"@vercel/analytics",sdkv:"1.0.0"})}).then(async r=>console.log(r.status, await r.text()))'
# and the API half, via the Vercel MCP: get_web_analytics(projectId, teamId, mode:'count', since, until)
```

### Why this is worse than "analytics is off"

The edge serves the collector script and **answers 200 to every event it is sent**, while the
query API refuses the project outright. So the page looks instrumented from the outside, the
browser's network tab shows successful beacons, and there is nothing to read. On placement day —
the one day the number matters and cannot be re-collected — the failure would present as a
dashboard with no rows and a site that appears to be reporting correctly.

### ⚠️ This disproves the check ROADMAP A7.0 asked for

The roadmap's prescription was to *"extend `verify:funnel` to assert the collector accepts the
event (a 2xx on the `/_vercel/insights/event` POST), not only that `window.vaq` was filled."*
**That check would pass today, on a project that collects nothing readable.** Both halves are
already true: `window.vaq` fills, and the collector returns 200. A stricter version of an
instrument that measures the wrong thing measures the wrong thing more confidently.

The check that actually discriminates is the **query** side, not the collect side: a read that
returns rows, or `web_analytics_not_enabled`. That is a Vercel API call with a token, not a
browser assertion, so it does not belong inside `verify:funnel` as written — it is either a
separate scripted read or a line on the placement-day checklist. Recorded rather than built,
because choosing between those is a scope decision and the toggle has to be thrown first
regardless.

### What has to happen, in order

1. **Steve** enables Web Analytics for the `relay` project (Vercel dashboard → the project →
   Analytics). Sitting E. Until then Sprint 5 cannot start — this is the precondition the roadmap
   suspected and this measurement confirms.
2. Re-run the API probe. `web_analytics_not_enabled` must become a count.
3. Only then is it worth deciding where the queryability assertion lives.

⚠️ The two POSTs above sent one pageview and one event named `a7.0-collector-probe`, both carrying
`src=qa`. They are gate-excluded by `ratified.g1-n-is-an-allow-list` and, since nothing is being
retained, are almost certainly not stored at all — but if a count ever appears that includes them,
that is the offset to subtract.

## Known offsets — subtract before reading

Every event we caused ourselves goes here. An offset that is not written down on the day it
happens is not recoverable later.

| Date | Event(s) | `src` | Counts toward N? | Note |
|---|---|---|---|---|
| 2026-08-10 | 1 × `caregiver_intent` | `visual-check` | **No** | Pre-flight audit walk. Emitted because a stale channel was parked in the QA browser profile — the asymmetry fixed the same day. Not a lane value, so it filters out of every lane read; recorded because it is in the dashboard. |
| _(fill)_ | 1 × `caregiver_qualified` | `reddit-ads` | **Yes — subtract 1** | Part-2 verification click (`g1-ad-creatives.md`). Deliberately no intent, so it biases the ratio DOWN, never up. |
| 2026-08-16 | 1 × `caregiver_leads` row (**no analytics event**) | `qa` | **No** | 🔴 **DELETE BEFORE THE WINDOW OPENS — Steve, sysadmin.** The capture proof below. It affects verdict line 3 (the lead COUNT), not N. `npm run flight:snapshot` exits 1 until it is gone, so it cannot be forgotten. |

### ✅ 2026-08-16 — the demand-capture write, proven under the production role

The last unproven link in the path that produces verdict lines 3 and 4. `verify:roles` confirmed
`relay_app` **holds** `INSERT` on `caregiver_leads` in both regions, but `verify:live` runs as
`relay_dev`, which by construction cannot exercise that one write — so the grant was verified and
the path was not. A grant read from a catalog is not a row written by an application.

One submission through the live API on production, `src=qa` (gate-excluded, so no analytics event
was emitted and the ratio cannot be touched):

| | |
|---|---|
| `POST /api/caregivers/interest` | **200** `{"ok":true}` |
| Row in `caregiver_leads` | present — `src=qa`, `cta=capture-proof` |
| `notified` | **true** — Resend accepted the notification, so **both** legs of the deliberately-paired capture work |
| Guard behaviour | `flight:snapshot` went from exit 0 to **exit 1**, naming the row |

🔴 **Outstanding, and it is a sysadmin act:** the row must be deleted before the first ad serves.

```sql
DELETE FROM caregiver_leads WHERE email = 'g1-capture-proof@example.com';
```

Run it from `.env.admin`. `relay_dev` cannot — `caregiver_leads` is the one table it may read and
not write, which is the same property that made this proof necessary.

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

---

## Editorial pre-flight — PASSED 2026-08-18, before any placement exists

`docs/g1-editorial-lane.md` §Sequence step 5 requires both instrument checks before the first
editorial piece goes live. Run today, on the branch, against production. **This is the same
structure the paid flight used** — the banner at the top of this file says the editorial lane
reports in here, and this is the first entry that does.

| Command | Exit | What it observed |
|---|---|---|
| `npm run verify:funnel` | **0** | 7/7. `caregiver_qualified {"src":"qa"}` → priced CTA → `caregiver_intent {"src":"qa","cta":"hero"}`; both events agree on `src`, so the ratio is computable. Structural guard held: the script asked `isGateQualifyingSrc` and confirmed `qa` is gate-excluded before driving. |
| `npm run flight:snapshot` | **0** | Connected as `relay_dev`, SELECT only. Window not started, `caregiver_leads` **0 rows** — the editorial lane starts from zero, as it must. |

⚠️ **Which lane each proof covers, because they are not the same click.** Today's run exercised the
**hero** CTA (`cta=hero`) into `/caregivers/interest` — Lane A. The **Stripe branch** (`cta=start`,
Lane B) was live-proven separately on 2026-08-14, recorded in *Step 5* above. Both lanes have now
fired a real `caregiver_intent` in a real browser; neither proof substitutes for the other, and a
future reader wanting "is the numerator alive" needs both entries rather than whichever is nearer.

**What this does NOT establish.** Nothing about demand. `caregiver_leads` is 0 and no editorial
traffic exists yet. It establishes only that the instrument reports correctly on the day the first
placement lands, which is the one thing that cannot be checked retroactively.
