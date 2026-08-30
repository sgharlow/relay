# Sprint 8 — the editorial lane, from plan to pitchable

**Branch:** `sprint/2026-08-17-2` · **Iterations:** 2 · **Date:** 2026-08-16/17 (UTC)
**Scope:** the next priority on the roadmap — step 1 of `docs/g1-editorial-lane.md`, which gates
the first pitch and needs no input from Steve.

## Baseline

Green at both ends: **2507 passed, 1 skipped**, types, lint, build clean. Docs and research only —
no product code changed, so nothing needed deploying.

## Shipped

### I1 · `73e29ad` — outlet dossier, read from the primary sources

Five outlets checked against their own pages rather than assumed. **Three of five findings changed
the plan**, which is the return on doing it before pitching rather than after.

| Outlet | Finding |
|---|---|
| **caregiver.com** | ✅ open — 500–1500 words, Word attachment to a named contact, short bio. Stated topics include practical solutions, eldercare and preparedness. **The first target** |
| **Next Avenue** | ❌ **closed** — *"not accepting pitches for new stories"*, moved to TPT.org 2026-05-01. The plan had ranked it **second by fit** |
| **AgingCare** | ⚠️ no published submission route at all |
| **DailyCaring** | ⚠️ rules found, live page 404s — recorded **unverified**, with an instruction not to email the address on the strength of the file |
| **AARP** | ✅ open, high bar, one hard hazard ↓ |

**The finding that governs everything downstream**, quoted from AARP's own guidelines:

> *"If you send us a pitch that is plagiarized or A.I.-generated, your email address will be
> blacklisted and blocked."*

Permanent, and attached to **the address** rather than the pitch. AARP also wants *links to recent
writing samples* and *"rarely uses unsolicited ideas"* — so with no byline yet it is a **second-round
target**. Pitching it first spends the best outlet on the weakest version of the approach.

Two outlets' pages could not be reached and are marked unverified rather than filled in from a
search summary — the portfolio rule about verifying external URLs before recommending them, which
earned itself twice in one sitting.

### I2 · `855e733` — angle 3 drafted as raw material

*"The one account that unlocks the other six."* Steve chose a full draft on the explicit condition of
substantial rewrite; the draft carries that condition in a banner at the top rather than in a commit
message nobody reads at send time.

Built to pass the test the outlets apply silently — DailyCaring states it outright: *"guest articles
must NOT be advertisements for your company, product, or service."* Verified by measurement, not
assertion:

- **zero** product mentions in the body; one in the bio
- **885 words**, inside caregiver.com's 500–1500, with headroom because Steve's rewrite will run longer
- **zero** estate/death terms — the scenario is hospital and recovery throughout
- the central exercise costs nothing and works with a sheet of paper
- the strongest recommendation in the piece is a **free feature most email providers already have**,
  not the product

## ~~A correction to my own earlier work~~ — 🔴 OVERRULED 2026-08-30

> **RULED BY STEVE, Sitting D-1, 2026-08-30: §1a BINDS the editorial piece.** The
> relaxation below is struck. The op-ed is written in third person.
>
> **Why it was struck, and it is not that the argument was bad.** The reasoning
> below is a real argument and it is left standing to be read. What was wrong was
> its STATUS: it relaxed a rule the register carries, in a sprint report, and was
> never ratified. So from 2026-08-17 two documents disagreed about the voice of a
> piece that could not be finished until one of them won — and for thirteen days
> nobody noticed, because a sprint report reads like a record rather than like a
> change to a rule.
>
> The ruling is recorded at `PROJECT.yaml → ratified.sitting-d1-2026-08-30
> .rulings.a1_3_third_person_binds`. If the case below is to be made again, it is
> made as a proposed amendment to §1a — not as a paragraph in a report.

~~`docs/g1-editorial-lane.md` carried *"§1a third person — never 'you' joined to a health event"*. I put
it there, and carrying it across was wrong: **§1a is an ad-platform rule.** Meta and Reddit prohibit
copy implying knowledge of a reader's circumstances because the reader did not choose to be
targeted. A *Today's Caregiver* reader self-selected, there is no ad reviewer, and the outlet's own
writing uses second person throughout. Applying it to editorial produces stilted prose for no
benefit.~~

**The estate and medical constraints still bind absolutely** — those come from the product and from
honesty, not from ad policy, and nothing in the ruling above touches them.

## Blocked / next

| Item | Owner |
|---|---|
| **Rewrite the draft in your own voice**, then send to caregiver.com as a .docx | Steve — and the cover email is a pitch too, so it is yours to write for the same reason |
| Confirm DailyCaring's submission route via their contact form | Steve |
| Demand-gate date `2026-12-31` — still my derivation awaiting confirmation | Steve |
| Beta cohort — ready, waiting on the list | Steve (`docs/beta-cohort-handoff.md`) |

**On acceptance, and not before:** add `ed-caregiverdotcom` to `GATE_LANES` in the same commit the
placement goes live, then run `verify:funnel` and `flight:snapshot`. The allow-list is empty right
now, so an untagged placement would read as zero demand — `content.test.ts` asserts that failure
mode explicitly.

## Recommended next

1. **The rewrite.** Everything else in the editorial lane waits on it, and it is the one thing only
   you can do.
2. **The beta list.** Still the cheapest arms-length signal available, and still N=0 since 08-12.
3. **Confirm the gate date**, so the one live gate stops carrying an unconfirmed number.
