# Competitors — who else holds the keys when something happens to you

> Authored 2026-07-01 (external claims web-checked that day — sources at bottom). Per the portfolio
> doc-discipline standard, /roadmap-lint flags this file stale at 60 days. Referenced from
> `PROJECT.yaml: market.competitors_doc`. The Build Spec §25 covers the moat argument; this doc
> covers the actual market — including Everplans, which §25 never named.

Buyer moment (the caregiver wedge, per PROJECT.yaml G1): an adult child managing an aging parent's
affairs needs credentials, documents, and instructions to be *accessible under defined conditions* —
reversibly for emergencies, permanently at death. What do they compare Relay against?

## Direct incumbents

**Everplans — the closest incumbent, and the one to study.** Live and active in 2026: a single
premium plan at **$99.99/yr**, with a free tier capped at ~10 items. Strong at structured guidance
(templates, checklists, "deputies" for sharing) — weak exactly where Relay is strong: deputies are
share-grants, not a **verified, reversible release state machine**; there's no N-of-M verification,
no trigger conditions, no cryptographic no-peek guarantee (the platform can read your data). Their
$99/yr anchor is useful: it proves the category supports a meaningful annual price. Relay's pricing
should not undercut it — it should justify parity-or-premium with verification + reversibility.

**GoodTrust and Trustworthy** — the other two names in every 2026 category comparison. Same family:
document/credential organizers with sharing and some legacy features. Same structural gap: storage
and sharing, not *conditional, verified, reversible orchestration*. The category's own reviewers
frame the choice as templates-vs-storage — nobody is competing on release correctness, which is
Relay's whole thesis.

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
2. **Lead the caregiver pitch with reversibility** ("give access during the emergency, take it back
   after") — the one capability literally no competitor has; storage comparisons are a losing frame.
3. **Expect "my phone does that" as the top objection** — the free platform features are the real
   competition for awareness, not the paid organizers.

Sources: [Everplans pricing](https://www.everplans.com/pricing) · [Everplans cost (help center)](https://help.everplans.com/hc/en-us/articles/215665778-How-much-does-Everplans-cost) · [Everplans vs GoodTrust vs Trustworthy (2026)](https://safekeep.co/everplans-vs-goodtrust-vs-trustworthy-review-2026/) · [Everplans review 2026](https://www.finderslist.com/estate-planning-services/tools/everplans)
