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
| **Next Avenue** (PBS) | explicitly publishes contributed pieces on ageing; the closest editorial match to the wedge | yes — check current guidelines |
| **AARP** — Family Caregiving | the audience by definition; highest authority | mostly staff-written — expect to be a *source*, not a byline |
| **AgingCare.com** | runs an expert-contributor programme | yes |
| **DailyCaring** | practical how-to for family caregivers | yes |
| **The Caregiver Space** | community-first, receptive to first-person and practical pieces | yes |
| **Family Caregiver Alliance** | resource-oriented, high trust | check |
| **Senior Planet** (OATS/AARP) | explicitly about older adults and technology — the best topical fit of all | yes |
| Area Agencies on Aging newsletters | local, unglamorous, and read by exactly the right people | usually |

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

## Sequence

1. **Read the contributor guidelines** for Next Avenue, Senior Planet, AgingCare and DailyCaring.
   Record what each accepts, from whom, and their disclosure rules. *This is the gate on everything
   below.*
2. Draft angle 3 first — it is the most useful to a reader and the least promotional.
3. Pitch two outlets. Do not mass-pitch; these are relationships.
4. On acceptance: declare the `ed-` src in `GATE_LANES`, publish, and log the placement.
5. Run `npm run verify:funnel` and `npm run flight:snapshot` before the first piece goes live —
   the instrument checks are channel-agnostic and still apply.

## What this does not answer

**Volume.** One placement in a large outlet can deliver more qualified readers than the entire
$250 paid flight would have, or it can deliver forty. That is unknown and this plan does not
pretend otherwise. What is now known is that the paid alternative was measured and cannot reach
N ≥ 100 inside the window at all — so the comparison is against something that does not work,
not against something that does.
