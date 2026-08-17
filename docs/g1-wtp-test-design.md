> # ⚠️ THE QUESTION SURVIVES; THE INSTRUMENT DOES NOT — 2026-08-16
>
> This design specifies a **paid-traffic** WTP test: N ≥ 100 qualified visitors bought through
> ratified channels, measured as click-to-intent against a price. Paid advertising is abandoned
> (`PROJECT.yaml` `ratified.retire-paid-advertising`), so **the instrument described here cannot be
> run** — not because it is wrong, but because no channel will sell the audience it needs.
>
> **What still stands:** the question (will caregivers pay, at a real price, having seen the
> number), the exclusion logic, the ratio definitions and the amendment about directional reads.
>
> ⚠️ **What does NOT transfer: the thresholds.** 2% click-to-intent and N ≥ 100 were calibrated
> against *bought clicks*. Editorial readers arrive having read a whole article about the problem
> and are a different population with a different expected conversion rate. Re-deriving those
> numbers for the new instrument is an open task, recorded on the gate itself — do not carry 2%
> across and pretend it means the same thing.

# G1 caregiver WTP test — design (FULLY RATIFIED by Steve 2026-07-03)

> Instrument built 2026-07-03 on branch `exp/g1-caregiver-landing` (Story R2/R3, in-lock relay
> prep). **Deploys only post-H0-disposition** — merging to master before the verdict would
> redeploy the judged artifact. Gate: `g1-caregiver-wtp` — **due date in `PROJECT.yaml`, not here.**
> It read 2026-09-15 when this line was written and has since moved twice (2026-08-11 to 10-31,
> 2026-08-14 to 10-02), each with a recorded derivation. Thresholds and the $250 ceiling are
> unchanged by both moves.

## What G1 decides

Whether caregivers (adult children of aging parents) will pay a real price for reversible
emergency access — BEFORE any further product build. Sequencing rule from the 7-01 audit:
no product building until this evidence exists.

## ⚠️ Amendment — the ratio alone cannot decide this (2026-08-08, approved by Steve)

**The ratified thresholds below are unchanged. What changes is that they are no longer read alone.**

At the ratified N the gate decides on a handful of observations. N = 100 with a 2% ship line means
**2 intents**; the 95% interval around 2/100 runs roughly **0.6%–7%**. A product whose true rate is
2% frequently reads 1 (kill), and one whose true rate is 0.5% frequently reads 3 (ship). The test
as specified cannot separate its own ship and kill conditions.

Two consequences, both adopted:

1. **N ≈ 250 is the honest minimum** for the ratio to distinguish 2% from 0.5% with ~80% power.
   Below that, a ratio reading is directional, not decisive, and the verdict must say so.
2. **Leads are now a co-equal read, not a footnote.** `/caregivers/interest` captures an email
   address and a free-text sentence about the visitor's situation, and as of 2026-08-08 fires
   `caregiver_lead_submitted`. Twenty caregivers describing their own circumstances in their own
   words is decision-grade evidence about whether this product should exist; a ratio at N = 100 is
   not. The lead count and the notes are read alongside the ratio and recorded in the verdict.

**Amended verdict rule.** The written G1 verdict must state, in this order:

| | What | Why it is there |
|---|---|---|
| 1 | `caregiver_intent ÷ caregiver_qualified` on Lane A, with N | The ratified gate metric, unchanged |
| 2 | Whether N reached ~250 | Determines whether line 1 is decisive or directional |
| 3 | Count of `caregiver_lead_submitted` | Contactable humans — the harder signal |
| 4 | The lead notes, quoted | Whether the pain we assumed is the pain they describe |
| 5 | Ship / kill / iterate, and **which line drove it** | Prevents a post-hoc reading of whichever number looked better |

A ship call on line 1 alone at N < 250 is not permitted. A kill call on line 1 alone at N < 250 is
not permitted either — that is the failure the original rule was most exposed to, since an
underpowered read is likelier to land under 0.5% than over 2%.

---

## Pre-committed thresholds (ratified 7-01 in PROJECT.yaml — restated, not invented)

- **Ship signal:** ≥ 2% click-to-intent at a real price point, N ≥ 100 qualified visitors.
- **Kill:** < 0.5% after 100+ qualified → park D2C; B2B2C-only or archive.
- Between 0.5% and 2%: iterate copy/channel once, re-run; a second sub-2% read counts toward kill.

### Amendment 2026-08-16 — the instrument now counts what these thresholds say

Both thresholds above are written in **visitors** ("N ≥ 100 qualified visitors"), and until this
date the instrument counted **page views**: `QualifiedTracker` and `IntentTracker` each fired on
every mount, so one person reloading, pressing back, or reopening a tab counted again.

That is not a wash between the two sides, because they inflate on different actions:

| Action | Inflates | Bias |
|---|---|---|
| Reload `/caregivers` | denominator | toward a false **kill** |
| Reload `/caregivers/interest` | numerator | toward a false **ship** |
| Double-click the price CTA (Lane B) | numerator | toward a false **ship** |

The conversion page is the one a visitor is likelier to return to, and a false ship is the error
that spends money. Both events are now emitted **once per browser session** (session-scoped, like
the channel attribution beside them — a genuinely new visit is a new session and counts again), and
the Lane-B price CTA emits once per page load however many times it is pressed.

⚠️ It fails **open**: where `sessionStorage` is unavailable the event still fires, because
possibly counting a visitor twice beats certainly not counting them at all — silently dropping
conversions biases toward a false kill and is invisible.

⚠️ **Nothing measured before this date is comparable**, which costs nothing: the flight had not
started. Do not blend any pre-2026-08-16 reading into the N this gate is decided on.

## The instrument (what the branch contains)

- **`/caregivers`** — landing that leads with REVERSIBILITY ("emergency access that closes
  itself"), names the real alternatives (password notebook, Everplans-class organizers, platform
  legacy features), and shows the price ON the CTA — a click without having seen the number is
  not willingness to pay.
- **`/caregivers/interest`** — the intent event IS arriving on this page (noindex). It offers
  founding-family manual onboarding via email. Deliberately DB-free: demo DSQL is torn down
  post-judging and G1 must not depend on it.
- Source attribution via `?src=` on every CTA (`hero`, `pricing`, `nav`, plus per-channel values
  in outbound links). Gate rules are enforced AS TESTS (`content.test.ts`): price ≥ anchor,
  price visible in CTA, reversibility-led copy, attribution preserved.

## Metric definitions

- **Qualified visitor:** a session on `/caregivers` from a caregiver-targeted source (tagged
  `src`/UTM). Untagged/direct traffic is excluded from N (mirrors comeback's tagged-only doctrine).
- **Both events are keyed by the inbound CHANNEL (corrected 2026-08-05).** `caregiver_intent`
  carries `src` = the channel the visitor arrived from (remembered from the landing page in
  `sessionStorage`) plus `cta` = which button was pressed (`hero`/`nav`/`pricing`). Until this was
  fixed the numerator's `src` was the CTA position while the denominator's was the channel — two
  disjoint vocabularies, so the ratio below was **undefined as written**, per-channel conversion
  (what the paid budget exists to buy) was unrecoverable, and showcase traffic excluded from the
  denominator still counted in the numerator as `hero`, biasing toward a **false PASS**. An
  untagged return visit does not overwrite a stored channel; an unreachable `sessionStorage` or a
  visitor who never passed the landing page degrades to `direct`, which is excluded from N.
- **Intent:** a pageview of `/caregivers/interest` with a `src` param. (Email replies are a
  stronger secondary signal — log them, but the gate metric is click-to-intent.)
- **click-to-intent** = `count(caregiver_intent) ÷ count(caregiver_qualified)`, same window, filtered to a real (non-`direct`) `src`.
- **Showcase traffic is tagged but EXCLUDED from the gate (added 2026-08-05).** The H0 win made
  `/` and `/demo` public-traffic surfaces, and both now link into `/caregivers` — the funnel was
  otherwise linked from nowhere and the win-announcement spike would have missed it entirely.
  Those links carry `src=h0-home` / `src=h0-demo` (`SHOWCASE_SRCS` in `content.ts`). They are NOT
  caregiver-targeted channels, so per the qualified-visitor definition above they do **not** count
  toward N: a wave of hackathon visitors could push N past 100 at ~0% intent and trip the <0.5%
  **kill** threshold on an audience this test was never about. Read them as a separate, secondary
  segment ("did the tech audience contain caregivers?"). Enforced by `isGateQualifyingSrc()` +
  `content.test.ts`, not by dashboard discipline.
- **Measurement:** Vercel Web Analytics, still zero-DB. Wired 2026-07-07 (`@vercel/analytics`, `<Analytics/>` in the root layout) plus two **custom events** — `caregiver_qualified` (denominator, on `/caregivers`) and `caregiver_intent` (numerator, on `/caregivers/interest`), each carrying the `src`. Custom events (not raw pageview faceting) because Vercel's free tier does not reliably segment pageviews by an arbitrary query param, and the gate is a tagged-only ratio. `src` parsing is unit-tested (`analytics.test.ts`); `<Analytics/>` still needs enabling on the Vercel project at deploy time. Deploys post-H0-disposition only.

## Decisions (ratified by Steve 2026-07-03, as drafted)

| # | Decision | Value | Status |
|---|---|---|---|
| 1 | Price point | **$119/yr** (AT/ABOVE the Everplans $99.99/yr anchor per COMPETITORS.md; v1 is ONE price — a $149 second cell stays a later E5-style option) | ✅ RATIFIED 2026-07-03 |
| 2 | Contact address | `sgharlow+relay@gmail.com` (live in `interest/page.tsx`; +tag keeps replies filterable) | ✅ RATIFIED 2026-07-03 |
| 3 | Channels for qualified traffic | ~~r/AgingParents, r/CaregiverSupport, caregiver FB groups, AgingCare forum~~ **SUPERSEDED same day by the 7-03 channel-rules audit: all four organic channels prohibit product promotion.** Revised paid-primary plan (Reddit Ads + Meta Ads, draft budget) in `g1-channel-send-kit.md` | ✅ **v2 RATIFIED 2026-07-03: paid-primary, $250 ceiling** |
| 4 | Window | 2–4 weeks from first send, or until N=100 qualified — whichever first; gate hard-stops 9-15 | ✅ RATIFIED 2026-07-03 |

## Addendum — dual-lane execution (ratified by Steve 2026-08-07)

**Decision: run BOTH lanes on one traffic buy.** The $250 ceiling is NOT split; both lanes are fed
by the same ads landing on `/caregivers`, and the visitor self-selects.

| Lane | Path | Reads |
|---|---|---|
| **A — landing (the ratified gate)** | `/caregivers` → priced CTA → `/caregivers/interest` (**lead form** since 2026-08-08; was a `mailto:` link, which captured almost nobody on the mobile traffic this gate buys) | Will a caregiver click a $119 CTA — and then tell us who they are? |
| **B — product** | `/caregivers` → subordinate link → signup → seed → **risk-graph reveal** → price | Will they pay *after* the stakes are demonstrated? |

**The gate metric is UNCHANGED**: `count(caregiver_intent) ÷ count(caregiver_qualified)`, tagged-only,
showcase excluded. Lane B does not create a second numerator — it emits the same
`caregiver_intent`. The `cta` dimension separates them: `hero`/`nav`/`pricing` = lane A,
`start` = lane B.

> ⚠️ **Corrected 2026-08-10, before the first send.** This paragraph used to read "a lane-B
> conversion still lands on `/caregivers/interest` and fires `caregiver_intent`." That was true
> when written on 8-07 and false from 8-08, when live Stripe checkout shipped: the `/start` price
> card redirects to Stripe on success and only falls back to `/caregivers/interest`, so **a Lane-B
> visitor who actually bought emitted no numerator at all** while still counting in the denominator
> — biasing the gate toward a **false KILL**. The single live proof of the old behaviour
> (`docs/user-journeys.md` J1, "`caregiver_intent` fired with `cta=start`") was captured the same
> day, while checkout still 503'd, and described a path the code no longer took.
>
> Fixed in `lib/analytics/lane-b.ts`: the branch that takes the visitor to Stripe emits the
> numerator itself, the fallback branch does not (that page emits its own), and `lane-b.test.ts`
> pins **exactly one numerator per click on either branch**. Containment #3 below — "Lane B cannot
> by itself trigger the kill" — only actually holds now that this is true.

### ⚠️ The risk this introduces, and the rule that contains it

Lane B costs a signup, a TOTP enrolment and a seed before the price appears. It will almost
certainly convert worse in raw click-to-intent than a mailto. **If lane B cannibalises lane A
clicks, the blended ratio falls and a genuinely interested audience could trip the <0.5% KILL
threshold on an artefact of our own funnel design — a false kill.**

Three containments, two of them structural:

1. **Lane B's CTA is deliberately subordinate** — a text link beneath the primary priced button,
   no price on it, wording that opens with "Or". Enforced in `content.test.ts`, not by discipline.
2. **Report BOTH ratios at verdict time.** Blended (all intents ÷ all qualified) AND
   **lane-A-only** (`cta ∈ {hero, nav, pricing}` ÷ all qualified).
3. **The ratified gate is read on the LANE-A-ONLY ratio.** It is the metric the thresholds were
   set against on 2026-07-01. Lane B is a *secondary reading* that informs the iterate branch — it
   cannot by itself trigger the kill.

If lane A passes and lane B is materially higher, that is the strongest available argument for
routing paid traffic through the product in a follow-up flight. If lane B is materially lower, the
reveal is not worth its friction at the top of the funnel — which is itself worth knowing before
building more of it.

### Channel attribution across lanes

Both funnels now share one `sessionStorage` key (`CHANNEL_STORAGE_KEY`, defined once in
`src/app/caregivers/analytics.ts`). They briefly used two, which left every lane-B event reading
`direct` for real ad traffic. The gate ratio was never affected — `caregiver_intent` always
resolved from the landing's key — but lane B was unattributable until this was unified.

## Timeline

1. **Now → verdict (~7-31):** branch stays unmerged; preview URL available for copy review.
2. **Disposition (gate `h0-verdict-disposition`, by 8-07):** if commercialize → merge, enable
   Vercel Analytics, wire the real mailbox, start channel sends (human-send, co-pilot).
3. **G1 verdict:** written line — metric, N, threshold, ship/kill — due **9-15**.
   ~~G2 (counsel) runs in parallel and is REQUIRED before any paying customer.~~
   **SUPERSEDED 2026-08-14** by `gates.g2-counsel-opinion.declined`. Counsel was not
   engaged and estate is withdrawn permanently (`journeys.J10: withdrawn`), so G1 does
   not wait on it. The gate's own wording scoped it to a paying **estate** customer, and
   there will not be one. Left struck through rather than deleted: a reader who
   remembers this precondition needs to see that it was retired on purpose, not
   forgotten. A precondition that can never be met does not stop work — it stops work
   being scheduled, silently.
