# G1 lane 1 — Google Ads search intent

> # 🔴 MEASURED 2026-08-16, BEFORE ANY SPEND: THE DEMAND IS NOT THERE.
>
> Keyword Planner, US, English, Aug 2025 – Jul 2026. Run in the existing account (990-960-7101) as
> **research only** — no campaign built there, nothing spent anywhere.
>
> | Seed | Avg. monthly searches |
> |---|---|
> | `share passwords with family` | **10 – 100** |
> | `emergency access password manager` | **0 – 10** |
> | `access my parents bank account` | **0 – 10** |
> | `manage elderly parents finances` | **0 – 10** |
> | `what happens to my accounts if i am incapacitated` | **0 – 10** |
>
> Google generated only **21 keyword ideas** from all five seeds. **Ten of the sixteen ideas are
> Netflix password sharing**, and the three largest (100–1K each) are declining **−90% YoY**. The
> genuinely on-wedge remainder is six terms at 10–100/month: `handling elderly parents finances how
> to`, `managing elderly finances` (CPC $3.03–$8.61), `managing finances for elderly parents`,
> `managing parents finances`, `lastpass emergency`, `family sharing passwords`.
>
> **Excluding Netflix: ~330 searches/month at midpoint, ~600 at the absolute ceiling** — much of it
> informational rather than buying intent.
>
> **Two findings that matter more than the totals.**
>
> 1. **The words do not mean what we mean by them.** Google's semantic neighbourhood for "share
>    passwords with family" is *keeping a streaming account alive*. That is who the bid competes
>    with and, worse, who it reaches.
> 2. **N ≥ 100 is arithmetically out of reach inside the window.** At ~330 searches/month, on
>    phrase/exact, with partial impression share and informational-query CTR, this is plausibly
>    10–30 clicks/month. N=100 needs 3–10 months. The gate hard-stops **2026-10-02**.
>
> **The pre-set cancel criterion is met.** It was written before the number was seen: *"Run those
> keyword clusters through Keyword Planner. If US monthly volume across the caregiver and
> emergency-access sets is under a few hundred, cancel the campaign."*
>
> ### This is the third instrument to fail, and they agree
>
> | Instrument | Result | Cost to learn |
> |---|---|---|
> | Reddit community targeting | the caregiver audience is not in the targetable index at all | $0 |
> | Reddit keyword targeting | does not narrow — 251.2m–314.1m under US-only scoping | $0 |
> | Google search intent | the demand is not in search — ~330/mo, mostly Netflix | $0 |
>
> Three channels, three mechanisms, one conclusion: **there is no self-identifying, addressable
> population searching for this, and no ad platform will sell access to it by inference either.**
> That is evidence about the WEDGE, not about the channels — and it is exactly what the
> `demand gate before horizontal build` rule in the global CLAUDE.md exists to surface before money
> moves. It cost $0 instead of the ratified $250.
>
> **Everything below this banner was written before the measurement and is retained as the plan
> that would have run.** The copy, negatives and settings in `lib/g1/google-lane.ts` remain correct
> and tested; they are simply pointed at a market that is not there. Do not execute the sitting
> section without a decision from Steve first.

> Replaces the Reddit lane, retired 2026-08-16. Decision and evidence:
> `PROJECT.yaml` `ratified.g1-lane-1-is-google-search-intent`.
>
> **The copy, keywords, negatives and settings are NOT restated here.** They live in
> `lib/g1/google-lane.ts` and are measured by `lib/ops/google-lane.test.ts` against Google's real
> field limits. This file is the transcription order and the reasoning — where the two disagree,
> the code wins, because the code is the half under test.
>
> Thresholds, price, budget ceiling and the gate window live in `PROJECT.yaml`
> (`gates.g1-caregiver-wtp`, `ratified.g1-flight-power`). Not restated here either.

## Why search, and what it constrains

Reddit sold no caregiver targeting at all. Google's health restrictions are narrower and, crucially,
land somewhere else: read from the primary source on 2026-08-16
(`support.google.com/adspolicy/answer/16701855`), they restrict **advertiser-curated audiences** —
customer match, data segments, audience expansion, lookalikes. They do **not** restrict keyword
targeting in Search.

The distinction is the whole reason this lane exists: **a query is something a person typed; an
audience is an inference about who they are.** Google restricts the inference, not the typing.

Two consequences, both enforced by tests rather than remembered:

1. **Attach no audience segment.** It would re-enter the restricted surface *and* stop the keyword
   being the thing measured.
2. **Phrase and exact match only.** Broad match has no conversion signal to learn from here, so it
   widens to whatever Google guesses — and every widened click still lands in the denominator
   tagged `google-ads`. On a gate that kills below 0.5%, paying to widen the denominator is paying
   to kill the product.

## The one thing that silently voids the whole spend

The final URL must carry **`?src=google-ads`**. `GATE_LANES` is an allow-list, so an untagged or
misspelled src reads as `direct` and counts toward nothing: the ad serves, clicks land, the page
renders, and **N stays at zero while the money leaves** — indistinguishable from a product nobody
wants. Pinned by `google-lane.test.ts`; read it back off the screen anyway.

It points at **`/caregivers`**, never `/caregivers/interest`. The interest page is the *numerator* —
sending paid traffic straight there would report near-100% conversion.

## Budget shape — and why it is days, not dollars per day

Google has **no lifetime budget** for a standard Search campaign. The only hard stop is a **daily
budget plus an end date**, so the end date *is* the structural control here, exactly as the lifetime
cap was on Reddit.

> **Recommended: $10/day with an end date 15 days out ≈ $150** — the ratified lane budget.

The reasoning runs opposite to the usual instinct. These are long-tail queries and the binding
constraint will almost certainly be **available search volume, not budget** — the campaign will
likely underspend its daily cap. When that happens, more *days* buys more query coverage than more
dollars per day would. So:

- if daily spend runs well under $10, **extend the end date, do not raise the daily budget**
- ⚠️ Google may spend up to **2× the daily budget** on a single day, balancing across the month.
  A daily cap is an average, not a ceiling. The end date is what bounds the total.

## The negative list is half the campaign

Three populations type these queries and only one is the customer. Full list and reasoning in
`lib/g1/google-lane.ts`; the shape of it:

| Excluded | Why |
|---|---|
| **estate, probate, inheritance, deceased, executor, digital legacy** | Estate was withdrawn from the product **permanently** (`gates.g2-counsel-opinion.declined`) and the Terms say it is not offered. Paying for these clicks sends people to a page that refuses them, and pollutes the denominator with demand the product decided not to serve |
| **hack, bypass, steal, without permission** | *"How do I get into my mother's bank account"* is typed by devoted daughters and by people planning to empty it. No ad can tell them apart |
| **jobs, hiring, salary, career, certification** | Caregiving is an occupation. Reddit's index tagged its one caregiving community as **"Career"** — a useful reminder |
| **medicaid, insurance, benefits, grant** | Benefit seekers, not buyers |
| **nursing home cost, assisted living cost** | Facility shoppers look adjacent and are not this product |

A test asserts no negative appears *inside* a keyword we are paying for — a collision there
silently suppresses the whole theme, and it is the kind of thing nobody notices until the verdict.

## The sitting — settings that are not defaults

Every row below is a default that would have been wrong. That is the same lesson the Reddit sitting
taught more expensively: **the platform's out-of-the-box configuration is built to spend, not to
measure.**

| # | Screen | Enter exactly | Who |
|---|---|---|---|
| 1 | Sign in / create the Google Ads account | ⚠️ **NOT report-bridge's account (990-960-7101).** Separate product, separate measurement | Steve |
| 2 | Campaign objective | **"Create a campaign without a goal's guidance"** — a goal nudges toward conversion bidding, and there is no conversion tracking | Claude |
| 3 | Campaign type | **Search** | Claude |
| 4 | Results you want | leave **all unticked** (no website visits/phone/leads goal) | Claude |
| 5 | Campaign name | `G1 caregiver WTP — Google lane 1` | Claude |
| 6 | Bidding | **Maximize clicks**, then tick **"Set a maximum cost per click bid limit"** | Claude |
| 7 | Networks | **Search Partners OFF · Display Network OFF** — both default ON, neither is search intent | Claude |
| 8 | Locations | **United States**, then Location options → **"Presence: People in or regularly in"** — the default "Presence or interest" serves the whole world | Claude |
| 9 | Languages | English | Claude |
| 10 | Audience segments | **none** — see the policy note above | Claude |
| 11 | Keywords | phrase/exact from `lib/g1/google-lane.ts` | Claude |
| 12 | Negative keywords | the full list from the same file | Claude |
| 13 | Ad — headlines & descriptions | from the same file; counts already machine-checked | Claude |
| 14 | Ad — final URL | `https://relaystandby.com/caregivers?src=google-ads` — **read it back** | Claude, Steve confirms |
| 15 | Budget & end date | daily + end date per the budget shape above | **Steve sets** |
| 16 | Payment | **Steve alone.** Nothing spends before this | **Steve alone** |

## Before it goes live

Same three as the Reddit sheet, unchanged and still the right three:

| | Command | Must show |
|---|---|---|
| 1 | `npm run verify:funnel` | `all 7 checks passed — the instrument is alive` |
| 2 | `npm test` | green |
| 3 | `npm run flight:snapshot` | `✓ window not started and caregiver_leads is empty` — exit 0 |

Then on approval: **one** verification click, confirm the landing URL carries `?src=google-ads`, and
record it as a known offset in `g1-flight-log.md`. One person, once — it permanently injects one
event, and a Vercel Analytics event cannot be deleted.

## Still open

- **Ad copy is written but not policy-reviewed by Google.** Submission is the review. The slack in
  the gate absorbs exactly one rejection-and-resubmit cycle.
- **Meta (lane 2) is untested against the same wall.** It removed most health and caregiving
  detailed targeting in 2022, so it may be closed too. **Test that before investing in the D6 image
  assets, not after.**
