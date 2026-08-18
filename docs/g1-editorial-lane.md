# G1 lane 1 — editorial. Ratified 2026-08-16 as the PRIORITY over paid ads.

> **Steve's ruling, 2026-08-16:** write opinion pieces for AARP and comparable elder-care
> communities that publish this kind of article, and treat that as a **higher priority than paid
> advertising**. Recorded in `PROJECT.yaml` `ratified.g1-editorial-over-paid`.
>
> Paid lanes are not cancelled. They are demoted, unlaunched and unfunded, behind this.

## Why this, and why now

Three paid instruments were tested on 2026-08-16 and all three failed, at a total cost of $0:

| Instrument | Result |
|---|---|
| Reddit community targeting | the caregiver communities are not in the targetable index at all |
| Reddit keyword targeting | does not narrow — 251.2m–314.1m under US-only scoping |
| Google search intent | ~330 searches/month on-wedge, 10 of 16 keyword ideas were Netflix |

The common thread is not three bad channels. It is one fact about the market: **there is no
self-identifying, addressable population searching for this, and no platform will sell access to it
by inference either.**

That fact kills *harvesting* and points straight at *creating*. Search advertising captures demand
that already exists; the Keyword Planner numbers say almost none does. But the people do exist —
they are reading AARP and Next Avenue right now, about the exact problem, using words that are not
our words. **The gap is not reach. It is that nobody has a name for what they need until somebody
describes it to them.** An article does that. An ad cannot.

This also fits the standing founder direction (`project-founder-direction-2026-07-26`), whose KPI is
audience rather than revenue.

## The honest constraints, up front

⚠️ **Most of these outlets do not run vendor-written promotional pieces, and pitching one as though
they do is how a founder gets permanently blocked from a publication.** What they run is contributed
expertise from someone with standing, where the product is at most a byline. Plan for that shape.

⚠️ **Audit each outlet's own contributor guidelines BEFORE pitching it** — portfolio rule, adopted
2026-07-05 after a GTM channel was ratified without reading its community rules. That audit is step
1 below, not an afterthought.

⚠️ **Disclose the commercial interest.** Every reputable outlet requires it, and it is the honest
thing regardless.

**Copy discipline carries over from the ad rules, unchanged:**

- **§1a third person.** Never "your mother", never "you" joined to a health event.
- **Estate stays out.** `gates.g2-counsel-opinion.declined` withdrew estate from the product
  permanently and the Terms say it is not offered. Do not write the death-and-inheritance piece,
  however well it would place — it advertises something the product refuses to do.
- **No medical claims.** Relay is software, not a care service and not a medical device.

## Target outlets

Ordered by fit, not by reach.

| Outlet | Why it fits | Contributed content? |
|---|---|---|
| **caregiver.com** (*Today's Caregiver*) | named by Steve; a caregiver-first publication that has run contributed expertise for years | yes — check current guidelines |
| **Next Avenue** (PBS) | explicitly publishes contributed pieces on ageing; the closest editorial match to the wedge | yes — check current guidelines |
| **AARP** — Family Caregiving | named by Steve; the audience by definition and the highest authority | mostly staff-written — expect to be a *source*, not a byline |
| **AgingCare.com** | runs an expert-contributor programme | yes |
| ~~**DailyCaring**~~ | ~~practical how-to for family caregivers~~ | ❌ **no published route — verified 2026-08-18** |
| **The Caregiver Space** | community-first, receptive to first-person and practical pieces | yes |
| **Family Caregiver Alliance** | resource-oriented, high trust | check |
| **Senior Planet** (OATS/AARP) | explicitly about older adults and technology — the best topical fit of all | yes |
| Area Agencies on Aging newsletters | local, unglamorous, and read by exactly the right people | usually |

### 🔴 The July audit already warned about this, and it governs the whole plan

`g1-channel-send-kit.md` recorded on 2026-07-03, from live sources: *"every organic channel
ratified in g1-wtp-test-design.md decision #3 **prohibits product promotion**."*

That finding did not die with the paid plan — it is the single most important input to this one.
**Contributed editorial is a different thing from promotion**, and is frequently welcome exactly
where promotion is banned. But **the distinction is the outlet's to make, not ours**, and getting
it wrong does not cost a rejected pitch — it costs the relationship, permanently, with the only
audience this product has. That is why reading each outlet's own contributor guidelines is step 1
below and gates everything after it.

## How this ladders into B2B2C

Steve's ruling pairs op-eds **with** B2B2C, and the pairing is the mechanism, not a coincidence.

A benefits broker, a credit-union product lead or an EAP director does not take a meeting because a
product exists. They take it because someone has publicly articulated a problem their members have
and is visibly credible on it. **A published piece in AARP or caregiver.com is that credential.**
It converts a cold approach into a warm one, and it does so durably — the article keeps working
long after an ad would have stopped.

So the sequence is: *publish → be findable and citable → approach partners from standing → G3 pilot
LOI.* `PROJECT.yaml` has been amended so **G3 now runs in parallel** with G1's re-instrumented
form rather than waiting behind it.

⚠️ **They remain two separate measurements and must never be reported as one.** Editorial is
earned awareness; B2B2C is distribution. An op-ed that gets read is not a partner that ships, and
blending them into one number is how a gate stops meaning anything.

## The four angles

Problem-first. The product is the last paragraph, or absent.

1. **"The password nobody thought to write down."** The moment a family discovers they cannot reach
   a parent's accounts — and why it is almost never the bank that is the problem.
2. **"Sharing a password is not a plan."** Why the notebook, the spreadsheet and the text message
   all fail the same way: everything, to everyone, forever, with no way back.
3. **"The one account that unlocks the other six."** The dependency insight — that email is the
   master key and most families have never mapped it. This is the strongest piece: it is genuinely
   useful to a reader who never buys anything, and it is literally what the product shows.
4. **"What to set up while everyone is still well."** Incapacity, not death. Reversibility as the
   thing that makes it safe to set up early.

## Measurement — and the one thing that must not be forgotten

Each placement carries its own tagged link:

> `https://relaystandby.com/caregivers?src=ed-<outlet>` — e.g. `?src=ed-nextavenue`

🔴 **`GATE_LANES` in `src/app/caregivers/content.ts` is an ALLOW-LIST.** An `src` that is not
declared there counts toward nothing — the article runs, readers click, and N stays at zero. So
**the src goes into `GATE_LANES` in the same commit that the placement goes live**, exactly as the
paid lanes do. Nothing is added speculatively; a lane for an article that does not exist yet is
a lane that reads as zero demand and teaches nobody anything.

Editorial traffic is arguably *better* G1 signal than paid: the reader self-selected by reading a
whole article about the problem. But it is a **different** signal, so record it as its own segment —
`g1-flight-log.md` already computes per-lane ratios (ratio #4). Do not blend editorial and paid into
one headline number without saying so.

**The editorial thresholds are drafted and await ratification:**
`docs/g1-editorial-threshold-proposal.md` (2026-08-18) proposes pass ≥ 6% at N ≥ 50 cumulative,
kill < 2% at N ≥ 150, no-read floor below N = 50 — with the reasoning for each number. Per the gate
block in `PROJECT.yaml`, **Steve must ratify (or amend) it BEFORE the first placement goes live**,
so the number cannot be reverse-engineered from whichever result appears. Until ratified, no `ed-*`
src may be declared in `GATE_LANES`.

## What to send an outlet

The boilerplate lives in **`lib/g1/press-kit.ts`** and is composed from the product's own values —
`PRICE_YEARLY_USD`, `TIER_LIMITS.free.items`, `OPERATOR_NAME` — rather than typed. It supplies the
one-line description, the paragraph that goes under an article, the author line, the facts an editor
can check independently, and the brand-asset paths.

**Why it is code and not a template.** A pitch restates those facts every time, and hand-copied
facts drift — three separate instances surfaced in this repo on 2026-08-16 alone. A journalist
quoting a stale price in a published article is the one version of that bug that cannot be fixed
with a commit. `lib/ops/press-kit.test.ts` pins it, including that the copy never implies estate
handling (which the API answers `400` to) and never references employment.

Read it with:

```
npx tsx -e "import('./lib/g1/press-kit').then(k => console.log(k.boilerplate(), '\n\n', k.authorLine()))"
```

## Sequence

1. ~~**Read the contributor guidelines** for Next Avenue, Senior Planet, AgingCare and
   DailyCaring.~~ ✅ **DONE 2026-08-16 — `docs/g1-outlet-dossier.md`**, read from the primary
   sources. It changed the plan:
   - **caregiver.com is the first target** — open door, named contact, 500–1500 words, and angle 3
     fits its stated topics of practical solutions, eldercare and preparedness.
   - **Next Avenue is CLOSED.** *"Next Avenue is not accepting pitches for new stories."* It was
     ranked second by fit in this file; it is not available. Removed.
   - **AgingCare publishes no submission route** at all — a relationship play, not a submission.
   - ~~**DailyCaring's route is unverified** — its guest page 404s. Confirm before emailing.~~
     ✅ **CONFIRMED 2026-08-18: there is no route.** `guest@dailycaring.com` appears on no live
     page; `/write-for-us/` 404s, `/partner-with-us-dailycaring/` now serves Contact Us, and the
     search index still shows the old contributor title over a page whose content is gone.
     Dropped from the pitch list.
   - 🔴 **This step named Senior Planet and the dossier never assessed it.** Caught 2026-08-18.
     It could not be assessed then either — the site renders client-side and returns only a title
     to a fetch — and ⚠️ its own page titles read **"Senior Planet from AARP"**, so the AARP
     blacklist hazard below may travel with it. It is not a low-risk warm-up for AARP.
   - 🔴 **AARP: *"If you send us a pitch that is plagiarized or A.I.-generated, your email address
     will be blacklisted and blocked."*** Permanent, and attached to the address rather than the
     pitch. AARP also wants links to recent writing samples and *"rarely uses unsolicited ideas"* —
     so it is a **second-round target after a first byline exists**, not the opening move.
2. Draft angle 3 first — it is the most useful to a reader and the least promotional.
3. ~~Pitch two outlets.~~ ⚠️ **Pitch ONE: caregiver.com.** Revised 2026-08-18 — DailyCaring was
   the intended second and has no route, and the two remaining candidates are unassessed. Do not
   mass-pitch; these are relationships. **The whole editorial instrument now rests on a single
   submission**, which argues for getting it right rather than getting it out.
4. On acceptance: declare the `ed-` src in `GATE_LANES`, publish, and log the placement.
5. Run `npm run verify:funnel` and `npm run flight:snapshot` before the first piece goes live —
   the instrument checks are channel-agnostic and still apply.

## What this does not answer

**Volume.** One placement in a large outlet can deliver more qualified readers than the entire
$250 paid flight would have, or it can deliver forty. That is unknown and this plan does not
pretend otherwise. What is now known is that the paid alternative was measured and cannot reach
N ≥ 100 inside the window at all — so the comparison is against something that does not work,
not against something that does.
