# Unit economics — what an owner costs, against what an owner pays

> **Derived 2026-08-20.** ⚠️ **Every number on this page is a derivation with a date on it, and none
> of it may be quoted anywhere else.** Vendor prices change without telling us; the moment AWS moves
> a figure, this page is wrong and nothing will say so. If you need one of these numbers somewhere,
> re-derive it here and cite the page — do not copy the value out.
>
> The price it is measured against lives in `PROJECT.yaml → monetization_path`, not here.
>
> **What this is for.** Nothing anywhere derived the cost of serving one owner. At today's scale
> (`demand_signal: none`) that does not matter — it is the arithmetic that tells the demand lane
> whether it is selling something with a margin, and the demand lane is running now.

## Sources

Fetched from each vendor's own pricing page on the derivation date, not recalled:

| Vendor | Figure |
|---|---|
| Aurora DSQL | **$8 per million DPU**; **$0.33/GB-month** storage; free tier **100,000 DPU + 1 GB/month**; multi-Region writes incur extra DPU **equal to the originating writes**; idle scales to zero |
| AWS KMS | **$1/month per key** (prorated hourly), **each multi-Region replica charged separately**; **$0.03 per 10,000 requests**; free tier **20,000 requests/month**; enabling rotation adds **$1/month** for the first and second rotation, then capped |
| Resend | Free: **3,000/month, 100/day**. Pro: **$20/month for 50,000**, then **$0.90 per 1,000** |
| Vercel | **`pro`** — VERIFIED 2026-08-29, team `steves-projects-a71becf4`. Derive: Vercel MCP `list_teams` → `.teams[].plan`, or `vercel teams ls`. Pro is **$20/seat/month**, one seat |
| OpenAI | Not fetched; `gpt-4o-mini` per-token cost is assumed below and is immaterial at this scale |

## Assumptions, named as assumptions

Each is a driver I could not measure without production credentials, which a sprint worktree does
not have. Where a number is a guess it says so.

| # | Assumption | Basis | If wrong |
|---|---|---|---|
| ~~A1~~ | ~~**Vercel is on a paid plan at ~$20/month**~~ **NO LONGER AN ASSUMPTION — measured 2026-08-29.** The plan is `pro`, so ~$20/month was right | Vercel MCP `list_teams` → `plan: "pro"` | Nothing: the assumption and the measurement agree. Kept struck rather than deleted, because the *number* being right is not the same as it having been *known*, and this row is the record of which it was |
| A2 | An owner holds **~25 vault items** | The demo seeds 25; the prompted checklist is 8; the free cap is 10 | Storage and KMS both scale linearly and both are negligible either way |
| A3 | A vault item is **~2 KB** of ciphertext + metadata | AES-GCM over short credentials, plus the row | 25 items ≈ 50 KB per owner — 20,000 owners fit inside DSQL's free 1 GB |
| A4 | A dormant owner produces **~50 DPU/day** | Hourly heartbeat sweep amortised, plus occasional reads. **Weakest number here** | Dominates nothing until thousands of owners; see break-even |
| A5 | An owner sends **~15 emails/year** | Invitations to a circle, plus heartbeat and release notices | 3,000/month free covers ~200 owners at this rate |
| A6 | Intake analysis runs **once per import**, ~4k tokens on `gpt-4o-mini` | `lib/ai/intake-agent.ts`, one pass per batch | Fractions of a cent per owner |

## Three scenarios

**Per owner, per year, variable cost only.** Fixed costs are handled separately below, because at
this scale they are the entire story.

### 1. A dormant owner — set it up, then nothing

The common case, and the one the product is designed to make safe.

| Driver | Volume/year | Cost |
|---|---|---|
| DSQL DPU (heartbeat sweep, occasional check-in) | ~18,000 DPU (A4) | **$0.14** |
| DSQL storage (50 KB, both regions) | 0.0001 GB-month × 12 × 2 | **< $0.01** |
| KMS `GenerateDataKey` (25 items, once) | 25 | **< $0.01** |
| KMS `Decrypt` | ~0 | **$0.00** |
| Resend (a few notices) | ~5 | **< $0.01** |
| OpenAI | one intake pass | **< $0.01** |
| **Total** | | **≈ $0.15/yr** |

### 2. A typical owner — maintains a plan, adds people, checks in

| Driver | Volume/year | Cost |
|---|---|---|
| DSQL DPU (A4 plus ~200 authenticated sessions) | ~30,000 DPU | **$0.24** |
| DSQL storage | as above | **< $0.01** |
| KMS (25 wraps, ~50 reveals of their own items) | 75 | **< $0.01** |
| Resend (15 emails, A5) | 15 | **$0.01** |
| OpenAI (a few intake passes) | ~4 | **$0.01** |
| **Total** | | **≈ $0.27/yr** |

### 3. An owner in an active release — the expensive one, and the one the product is for

A trigger fires, verifiers are notified and confirm, a recipient claims and reveals. Days, not
months.

| Driver | Volume | Cost |
|---|---|---|
| DSQL DPU (escalation, quorum, state transitions, dashboards) | ~40,000 DPU on top | **$0.32** |
| KMS `Decrypt` (a recipient revealing 25 items, several times) | ~100 | **< $0.01** |
| Resend (verifier notices, escalation ladder, closure) | ~25 | **$0.02** |
| **Total for the release episode** | | **≈ $0.35** |

🔑 **The moment the product exists for costs about thirty-five cents.** That is the finding worth
carrying out of this page: there is no scenario in which serving a customer is expensive.

## The honest headline: this is a fixed-cost business, not a variable one

| Fixed cost | Annual |
|---|---|
| KMS customer master key ($1/mo × 1 key) | **$12** |
| Vercel (`pro`, **verified** 2026-08-29) | **~$240** |
| Resend (free tier holds to ~200 owners at A5) | **$0** |
| Domain | ~$15 |
| GitHub Actions (public repo) | **$0** |
| **Total** | **≈ $267/yr** |

> ⚠️ **THE VERCEL AND RESEND LINES ARE SHARED COSTS BOOKED ENTIRELY TO RELAY, and that is the
> bigger distortion than the plan tier ever was.** Added 2026-08-29 (D18/B40).
>
> The `pro` plan is an **account-level** subscription on a team that hosts several projects, not a
> Relay line item — the same account that carries report-bridge, skillcrossroads and second-brain.
> Charging Relay the full ~$240/yr overstates its cost; charging it nothing would understate it.
> Neither is written down as a decision anywhere, so the total above is precise about arithmetic
> and silent about allocation.
>
> **Resend is the same shape and is still unmeasured** (B40): which product carries the
> Transactional Pro line, at what amount, on what renewal day, is read from the receipts and has
> not been. The table above books Resend at **$0** on the free tier, which is right only if Relay
> is not the product paying for Pro.
>
> **What to do with this:** an allocation rule is a decision, not a calculation, and it is Steve's.
> Until one exists, read the total as *"what Relay would cost standalone"* rather than *"what
> Relay costs today"*. The two differ by most of the Vercel line.

At the current price and a typical owner's ~$0.27 of variable cost, contribution per owner is
essentially the whole subscription.

**Break-even is therefore about three paying owners.** Not thirty, not three hundred — three.

⚠️ **And that number is dominated by A1**, the one assumption not verified. If Vercel is on the free
plan, break-even is closer to **one**. If the plan is $20/month/seat with more seats, it rises
proportionally. Verifying that single figure is worth more than refining every variable driver on
this page combined.

## What this means for the demand lane

- **Margin is not the question.** At this price, gross margin per owner is ~99.8%. Nothing about
  the cost structure argues against the price, in either direction.
- **The break-even is three people**, which is a different kind of number from the one the gates
  are chasing. `g1-arms-length-demand` needs **one** person. Three would cover the infrastructure.
- **Scale would change the shape, not the answer.** The free tiers bind first: Resend at roughly 200
  owners (A5), DSQL storage at roughly 20,000 (A3), KMS requests at roughly 800 owners/month of
  reveal traffic. Each is a $20-ish step, not a cliff.
- **The costs that would actually matter are not on this page**, because they are not
  infrastructure: support time, and the third-party security audit that `G5` requires. One audit is
  worth more than a decade of the numbers above.

## Two things this changed

1. **Enabling KMS key rotation is not free.** The first and second rotation each add $1/month,
   capped after that. `ROTATION_INTENDED` in `lib/ops/kms-wall.ts` is currently `false`, recorded as
   the as-provisioned state; if it is ever turned on, that is ~$24/yr, which is ~10% of fixed costs.
   Small, and no longer invisible.
2. **A multi-Region CMK costs $1/month per replica**, on top of the primary — relevant to
   `docs/kms-region-proposal.md`'s Option B, which estimated "~$1/month each" and is confirmed
   correct.

## Post-merge: the one check worth running

```bash
# Verify A1 — the assumption the break-even rests on
vercel teams ls        # or the billing page: which plan, and how many seats
```

And, when there is enough traffic to be worth reading, AWS Cost Explorer filtered to the relay
resources — which needs `.env.admin` and cannot be run from a sprint worktree.
