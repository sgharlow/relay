# The sitting — Reddit lane 1, one page

**Owner:** Steve types, Claude reads each screen back. **Date: \_\_\_\_\_\_\_\_\_\_** (fill it in)
**Budget touched:** $150 of the ratified $250. **Nothing spends until line 13.**

> **Why this page exists.** `g1-ad-creatives.md` is ~900 lines and is the authority. This is the
> transcription order, so the sitting is not a reading exercise. Where the two disagree, that file
> wins.
>
> ⚠️ **The creative copy is NOT reproduced here, on purpose.** It is claim-controlled and its
> character counts are checked by `lib/ops/ad-copy.test.ts`. A second copy in a second file is a
> second definition that can drift, and this document is not the one under test. **Paste R1 from
> `docs/g1-ad-creatives.md` → "R1 — the reversibility hook". Do not retype it.**

---

## Before you open the browser (Claude runs these, ~2 min)

| | Command | Must show |
|---|---|---|
| 1 | `npm run verify:funnel` | `all 7 checks passed — the instrument is alive` |
| 2 | `npm test` | green |
| 3 | `npm run flight:snapshot` | `✓ window not started and caregiver_leads is empty` — **exit 0.** The flight starts from zero or N is contaminated from day one |

> Line 3 was a sentence until 2026-08-16 and is now a command that **exits 1** if the table is not
> empty before the window opens. It is read-only and connects as `relay_dev`, the one role that
> cannot write `caregiver_leads` — so the pre-flight check physically cannot contaminate the thing
> it is checking. It is the same command you run daily once the flight is live.

If line 1 fails, **stop.** A lane measured by a dead instrument reads as no demand.

---

## The screens, in order

| # | Screen | Enter exactly | Who |
|---|---|---|---|
| 1 | ads.reddit.com → Sign up | the Reddit account to attach permanently to billing | Steve |
| 2 | Business details | Country **US**, currency **USD** | Steve |
| 3 | Payment method | **the card** — a small temporary authorisation is not the flight budget | **Steve alone** |
| 4 | Brand display name | `Relay` | Steve |
| 5 | Campaign → Objective | **Traffic** (not Conversions — there is no pixel, and the privacy page says so) | Claude dictates |
| 6 | Campaign budget | Daily **$25** · **LIFETIME $150** ← the lifetime cap is the structural control | Steve sets, Claude reads back |
| 7 | Ad group → Targeting | Location **United States**; communities `r/AgingParents`, `r/CaregiverSupport`, `r/Alzheimers`, `r/dementia`, `r/eldercare` | Claude dictates |
| 8 | Ad group → Bid | **Automatic** | Claude dictates |
| 9 | Ad → Format | **Free-form ad** — a standard image/link ad is headline-only and silently drops R1's whole body | Claude dictates |
| 10 | Ad → Headline / Body | **R1, pasted from `g1-ad-creatives.md`.** Title should read 78 characters | Steve pastes |
| 11 | Ad → CTA button | `Learn More` (not `Sign Up` — the destination is a landing page) | Claude dictates |
| 12 | Ad → Destination URL | `https://relaystandby.com/caregivers?src=reddit-ads` — **the `src` is the whole measurement** | Claude dictates, Steve reads back |
| 13 | Review & submit | **Submit, then stop.** | **Steve presses** |

---

## Three things that cost money if missed

- **Read every cap back off the screen after saving.** A cap typed but not saved looks identical to
  one that saved, until the bill arrives.
- **Decline any spend-match credit.** Reddit's offers unlock at $500–$1,000 — five to ten times the
  ratified ceiling. A small *unconditional* credit is fine: record it in the flight log as reduced
  cost per click. Anything conditional on spend is declined.
- **No images needed.** The free-form ad runs text-only. Meta (lane 2) needs assets and is day 3+,
  only if Reddit under-delivers.

## After submission

1. **Do not fill in the flight-log window start yet.** It is the day the ad is APPROVED AND
   SERVING, not the day it was submitted.
2. On approval: **one** verification click (part 2), confirm the landing URL carries
   `?src=reddit-ads`, and record it as a known offset in `g1-flight-log.md`. One person, once — it
   permanently injects one event.
3. Then daily: `npm run verify:funnel` first, then `npm run flight:snapshot` — it prints the
   snapshot row ready to paste, and the lead notes, which the ratified directional read expects to
   carry the verdict. The two analytics cells (N and the intents) still come from the Vercel
   dashboard by hand, deliberately: a second path to the denominator would be a second definition
   of the measurement.

## The clock

Submit by **~2026-08-26** → serving by **~2026-08-28** → 4-week window → **~2026-09-25** (or N≥100)
→ one week of slack → gate **2026-10-02**. Read these from `PROJECT.yaml`; this line has been wrong
once. **The slack absorbs exactly one rejection-and-resubmit cycle** — spending it early by starting
late means a rejection costs the gate.
