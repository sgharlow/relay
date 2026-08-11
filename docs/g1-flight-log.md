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
| **Gate hard-stop** | **2026-09-15** (`PROJECT.yaml`) — the window ends here regardless of N |
| **Ladder at flight start** | `dogfooded` · `wtp_evidence: none` · `caregiver_leads` = 0 rows (verified live 2026-08-10) |

## What N is, precisely

**N = count of `caregiver_qualified` events whose `src` is gate-qualifying.**

A `src` is gate-qualifying when it is tagged, not `direct`, and not in the excluded sets —
enforced by `isGateQualifyingSrc()` in `src/app/caregivers/content.ts` and pinned by
`content.test.ts`. It is **not** a matter of dashboard discipline; do not re-derive it by eye.

| Excluded set | Values | Why |
|---|---|---|
| untagged | `direct`, empty | not attributable to a caregiver-targeted channel |
| `SHOWCASE_SRCS` | `h0-demo`, `h0-home` | real humans, wrong audience — H0-win traffic. Read as a separate secondary segment ("did the tech audience contain caregivers?") |
| `QA_SRCS` | `qa`, `preflight` | **us.** Instrument verification, not demand |

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
