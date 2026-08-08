# G1 caregiver WTP test — design (FULLY RATIFIED by Steve 2026-07-03)

> Instrument built 2026-07-03 on branch `exp/g1-caregiver-landing` (Story R2/R3, in-lock relay
> prep). **Deploys only post-H0-disposition** — merging to master before the verdict would
> redeploy the judged artifact. Gate: `g1-caregiver-wtp` (PROJECT.yaml, due **2026-09-15**).

## What G1 decides

Whether caregivers (adult children of aging parents) will pay a real price for reversible
emergency access — BEFORE any further product build. Sequencing rule from the 7-01 audit:
no product building until this evidence exists.

## Pre-committed thresholds (ratified 7-01 in PROJECT.yaml — restated, not invented)

- **Ship signal:** ≥ 2% click-to-intent at a real price point, N ≥ 100 qualified visitors.
- **Kill:** < 0.5% after 100+ qualified → park D2C; B2B2C-only or archive.
- Between 0.5% and 2%: iterate copy/channel once, re-run; a second sub-2% read counts toward kill.

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
| **A — landing (the ratified gate)** | `/caregivers` → priced CTA → `/caregivers/interest` (mailto) | Will a caregiver click a $119 CTA? |
| **B — product** | `/caregivers` → subordinate link → signup → seed → **risk-graph reveal** → price | Will they pay *after* the stakes are demonstrated? |

**The gate metric is UNCHANGED**: `count(caregiver_intent) ÷ count(caregiver_qualified)`, tagged-only,
showcase excluded. Lane B does not create a second numerator — a lane-B conversion still lands on
`/caregivers/interest` and fires `caregiver_intent`. The `cta` dimension separates them:
`hero`/`nav`/`pricing` = lane A, `start` = lane B.

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
   G2 (counsel) runs in parallel and is REQUIRED before any paying customer.
