# Competitors — who else holds the keys when something happens to you

> Authored 2026-07-01. **Prices and plan shapes re-checked against each vendor's own pricing page
> on 2026-08-18** — that refresh is marked inline and the findings changed three of the four
> conclusions below. Per the portfolio doc-discipline standard, /roadmap-lint flags this file stale
> at 60 days; the clock restarts today. Referenced from `PROJECT.yaml: market.competitors_doc`. The
> Build Spec §25 covers the moat argument; this doc covers the actual market — including Everplans,
> which §25 never named.
>
> ⚠️ **Everything dated 2026-07-01 below is UNVERIFIED as of today** unless it carries a
> 2026-08-18 note. The qualitative claims (no rival does verified reversible release) were not
> re-tested this pass; only the volatile facts were.

Buyer moment (the caregiver wedge, per PROJECT.yaml G1): an adult child managing an aging parent's
affairs needs credentials, documents, and instructions to be *accessible under defined conditions* —
reversibly for emergencies, permanently at death. What do they compare Relay against?

## Direct incumbents

**Everplans — the closest incumbent, and the one to study.** Live and active: a single premium
plan at **$99.99/yr** — ✅ **re-verified 2026-08-18, unchanged.** The price anchor holds.
⚠️ **Two corrections from that check.** Its free tier is **3 items**, not the ~10 recorded here on
2026-07-01 — so Relay's free tier (10 items) is now the *more generous* of the two, which is a
positioning fact rather than a cost. And Everplans is distributed through partners at a **fraction
of retail**: VSP offers it at **$27/yr**. That is simultaneously the B2B2C precedent this category
supports and a live risk to the $99 anchor — a prospect who meets it through a benefits portal has
seen a different number than the one we are testing against. Strong at structured guidance
(templates, checklists, "deputies" for sharing) — weak exactly where Relay is strong: deputies are
share-grants, not a **verified, reversible release state machine**; there's no N-of-M verification,
no trigger conditions, no cryptographic no-peek guarantee (the platform can read your data). Their
$99/yr anchor is useful: it proves the category supports a meaningful annual price. Relay's pricing
should not undercut it — it should justify parity-or-premium with verification + reversibility.

**GoodTrust and Trustworthy** — the other two names in every category comparison. The structural
gap is unchanged: storage and sharing, not *conditional, verified, reversible orchestration*.
Nobody is competing on release correctness, which is Relay's whole thesis.

⚠️ **But "same family" no longer describes their pricing, and that was the useful part.** Checked
2026-08-18:

| | Plan shape | Annualised | Bearing on Relay's $119 |
|---|---|---|---|
| **Trustworthy** | Free · Silver $10/mo · Gold $20/mo · Platinum $40/mo, *paid annually* | **$120 / $240 / $480** | Silver at $120/yr is **within a dollar of Relay's $119**. The nearest competitor is no longer $99.99 — it is a tiered product whose entry paid tier lands exactly on our price |
| **GoodTrust** | $149 one-time, or promotional $99 first year then **$39/yr** | **$39/yr renewing** | Undercuts everyone on renewal, and has **pivoted toward full estate planning** — wills, trusts, POA, healthcare and funeral directives — which is the ground `g2-counsel-opinion` withdrew Relay from permanently |

The GoodTrust pivot is the more strategically interesting of the two: the cheapest rival has moved
*into* the regulated estate work Relay has ruled out, which widens the gap between the two products
rather than narrowing it. It also means a price comparison against GoodTrust is comparing different
products, and should be refused rather than won.

## Platform features (free, and therefore the anchor competitors)

**Apple Legacy Contact · Google Inactive Account Manager · Meta memorialization** — free,
single-ecosystem, all-or-nothing, mostly death-only, unverified. They set the consumer's default
expectation ("my phone handles that"), which is the real acquisition obstacle: Relay must sell the
*cross-platform + verified + reversible* delta, not the concept. (Build Spec §25 already positions
these; R13.4's triage agent treats them as integration targets — both true.)

**1Password emergency kit / Bitwarden emergency access** — the password-manager answer: one trusted
contact, waiting-period access, all-or-nothing vault handoff. Bitwarden's emergency access is the
most credible free rival for the credentials slice. No scoping, no verification, no reversible
emergency-vs-permanent-estate distinction, nothing beyond credentials (no documents/instructions).
The "why won't 1Password build this?" question is pre-answered in Build Spec §25.

## Adjacent spend

**Trust & Will / estate-planning platforms and attorneys** — where the money in the category
actually goes (wills, trusts, directives). Complementary more than competitive: they produce the
legal documents; nobody operationalizes *access* when the trigger fires. Partnership channel
(estate attorneys as B2B2C distributors) per the Build Spec's GTM — also the segment counsel (G2)
must clear before Relay touches estate releases for money.

## Implications (feed G1 directly)

1. **Price test at or above Everplans' $99/yr**, not below — the WTP question is whether verified
   reversible release justifies parity with a better-known organizer, not whether cheap wins.
   ✅ **Still the right call after the 2026-08-18 check, and now better supported:** Relay's $119
   sits between Everplans ($99.99) and Trustworthy Silver ($120), so the price is *inside* the
   established band rather than above it. Do not read GoodTrust's $39 renewal as a floor — it buys a
   different product.
2. **Lead the caregiver pitch with reversibility** ("give access during the emergency, take it back
   after") — the one capability literally no competitor has; storage comparisons are a losing frame.
3. **Expect "my phone does that" as the top objection** — the free platform features are the real
   competition for awareness, not the paid organizers.

Sources re-checked 2026-08-18: [Everplans pricing](https://www.everplans.com/pricing) · [Trustworthy pricing](https://www.trustworthy.com/pricing) · [GoodTrust](https://mygoodtrust.com/) · [Everplans via VSP at $27/yr](https://www.vsp.com/offers/special-offers/healthcare-financing/everplans)

Sources from 2026-07-01: [Everplans pricing](https://www.everplans.com/pricing) · [Everplans cost (help center)](https://help.everplans.com/hc/en-us/articles/215665778-How-much-does-Everplans-cost) · [Everplans vs GoodTrust vs Trustworthy (2026)](https://safekeep.co/everplans-vs-goodtrust-vs-trustworthy-review-2026/) · [Everplans review 2026](https://www.finderslist.com/estate-planning-services/tools/everplans)
