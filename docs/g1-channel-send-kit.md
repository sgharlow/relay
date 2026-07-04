# G1 qualified-traffic plan + send kit (v2 — RATIFIED by Steve 2026-07-03, $250 budget ceiling)

> Channel-rules audit run 2026-07-03 (live: subreddit rules JSON + AgingCare policy pages).
> **Finding: every organic channel ratified in `g1-wtp-test-design.md` decision #3 prohibits
> product promotion.** The original channel list cannot produce N≥100 qualified visitors without
> violating community rules — which would also torch the brand with the exact audience we want.
> This kit replaces it with a paid-primary plan. ✅ v2 ratified by Steve 2026-07-03 same day.

## Channel-rules audit (live-verified 2026-07-03)

| Channel | Verdict | The rule that decides it |
|---|---|---|
| r/AgingParents (77k) | ⛔ **CLOSED for promo** | Rule 1: advertising/commercial posts prohibited — "not a focus group for app developers"; external product links banned. Rule 2: **no AI content**, and posts about AI tools are removed (Relay isn't an AI tool, but AI-drafted text is banned). |
| r/CaregiverSupport | ⛔ **CLOSED for promo** | Rule 3: no (disguised) product placements — explicitly including "free resource" framing. Rule 5: no advertisements for products/services/apps. Rule 4: content must be human-written. |
| AgingCare.com forum | ⛔ **CLOSED for promo** | Member policy: no advertisement of any sort; promotional links disabled/removed; DM solicitation removed. Advertisers are directed to their paid placements line. |
| Caregiver Facebook groups | ⚠️ assume closed | Group-by-group, but the norm in support groups mirrors the above. Treat as participation-only unless a specific group's rules say otherwise. |

**Standing constraint from the no-AI rules:** any organic participation in these communities must
be written (or fully rewritten) by Steve in his own voice. Claude can brief, not draft, for those
two subreddits. Ads and owned channels have no such constraint.

## Revised plan: paid-primary, participation-support

The G1 metric (≥2% click-to-intent at a real price, N≥100 qualified) is actually *better* served
by paid traffic: targeting is explicit, `src` tagging is clean, and N=100 arrives in days, not
weeks. Budget: **$250 total ceiling** (ratified by Steve 2026-07-03).

| Lane | Mechanics | src tag | Est. to N=100 |
|---|---|---|---|
| **Reddit Ads** (primary) | Promoted post targeted to r/AgingParents + r/CaregiverSupport *audiences* — ads are platform-sanctioned and don't violate sub rules. Objective: traffic. | `src=reddit-ads` | ~$100–150 at typical $1–2 CPC → 75–100 clicks |
| **Meta Ads** (secondary) | Interest targeting: family caregiving, eldercare, POA/estate topics; single image + the reversibility hook. | `src=meta-ads` | ~$100 → 50–100 clicks |
| Caregiver newsletters (optional lane 3) | Paid classified/sponsor slot in a caregiver newsletter (e.g., Daughterhood-class communities) — very qualified, slower to book. | `src=nl-<name>` | varies; book only if lanes 1–2 under-deliver |
| Organic participation (support, not counted alone) | Genuine, Steve-voiced comments in the communities per their rules — no links unless asked directly via DM. Value: karma/credibility + trickle profile traffic. | `src=profile` | not projected |

Qualified visitor definition unchanged: tagged session on `/caregivers`. All lanes land on the
same page and the same intent event — the instrument needs zero changes.

## Ad copy drafts (for the paid lanes — Claude-drafted is fine here)

**Headline options (pick at flight time):**
1. "Emergency access to a parent's accounts — that closes itself when they recover."
2. "The password notebook can't be unshared. This can."
3. "When mom's in the hospital, you need her accounts. Not forever — just until she's back."

**Body (Reddit promoted post):**
> Families solve the what-if-something-happens problem by sharing every password with everyone,
> forever. Relay is the reversible version: an encrypted vault your parent controls, that opens
> exactly what each person needs when a real trigger fires — and seals itself again when they
> recover. $119/yr, one price for the whole family. Encrypted in the browser; we can't read it.

CTA → `/caregivers` with the lane's `src`. No claims beyond what's built (everything above is
live-dogfooded); no testimonials (we have none); price always visible pre-click where format allows.

## Flight checklist (post-verdict, if commercialize)

1. Merge branch → prod; enable Vercel Web Analytics; verify `/caregivers` + intent event live.
2. Steve ratifies revised decision #3 + budget; creates the ad accounts (billing = his card — his
   action by policy).
3. Launch lane 1; check daily snapshot; add lane 2 at day 3 if pace < N=100-by-day-10.
4. Verdict line at N≥100 or window end: metric, N, threshold, ship/kill — written into the
   Monday review per the backlog rules.
