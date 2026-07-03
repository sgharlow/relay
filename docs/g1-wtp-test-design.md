# G1 caregiver WTP test — design (RATIFIED by Steve 2026-07-03 — except the mailbox, see table)

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
- **Intent:** a pageview of `/caregivers/interest` with a `src` param. (Email replies are a
  stronger secondary signal — log them, but the gate metric is click-to-intent.)
- **click-to-intent** = intent pageviews ÷ qualified `/caregivers` sessions, same window.
- **Measurement:** Vercel Web Analytics (enable on the project at deploy time — zero code, no DB).

## Decisions (ratified by Steve 2026-07-03, as drafted)

| # | Decision | Value | Status |
|---|---|---|---|
| 1 | Price point | **$119/yr** (AT/ABOVE the Everplans $99.99/yr anchor per COMPETITORS.md; v1 is ONE price — a $149 second cell stays a later E5-style option) | ✅ RATIFIED 2026-07-03 |
| 2 | Contact address | `hello@relay.example` (placeholder, intentionally non-functional) | ⏳ **OPEN — the one remaining pre-deploy input**: needs a real mailbox Steve owns. Swap it in `interest/page.tsx` before merge. |
| 3 | Channels for qualified traffic | r/AgingParents, r/CaregiverSupport, caregiver Facebook groups, AgingCare forum — ALL human-send (community ToS), co-pilot shape; each link carries its own `src` | ✅ RATIFIED 2026-07-03 |
| 4 | Window | 2–4 weeks from first send, or until N=100 qualified — whichever first; gate hard-stops 9-15 | ✅ RATIFIED 2026-07-03 |

## Timeline

1. **Now → verdict (~7-31):** branch stays unmerged; preview URL available for copy review.
2. **Disposition (gate `h0-verdict-disposition`, by 8-07):** if commercialize → merge, enable
   Vercel Analytics, wire the real mailbox, start channel sends (human-send, co-pilot).
3. **G1 verdict:** written line — metric, N, threshold, ship/kill — due **9-15**.
   G2 (counsel) runs in parallel and is REQUIRED before any paying customer.
