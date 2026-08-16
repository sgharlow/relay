# Sprint 7 — complete and polished enough for an editor to publish

**Branch:** `sprint/2026-08-16-3` · **Iterations:** 5 of 5 · **Date:** 2026-08-16 (UTC)
**Scope:** *"to enable the outreach articles to land, we need to ensure the product is complete and
polished. Assess and plan the remaining work."*

## 1. Backlog source

No pre-existing queue applied — the previous sprint's deferred list was written for a paid-ads
world that was retired hours earlier. The backlog was **inferred from a survey against a new lens**:
what does a stranger arriving from an AARP or caregiver.com op-ed encounter, and what does the
editor check before publishing? Marked inferred, deliberately, and the survey is the deliverable in
`docs/product-readiness-assessment-2026-08-16.md`.

## 2. Baseline

| Gate | Start | End |
|---|---|---|
| Types | green | green |
| Lint | green | green |
| Build | green | green |
| Tests | 2492 passed, 1 skipped | **2507 passed, 1 skipped** |

No newly skipped tests. The single skip is the pre-existing beta-paywall case, owned and dated.

## 3. The finding, before the items

**The product is complete and polished. The gap was that it named nobody.**

Evidence gathered before touching anything: all 10 public pages 200; **23 internal links crawled,
zero broken**; no console errors; J1–J9 live and J10 withdrawn deliberately; a11y 0 serious/critical
across 34 pages; a real design system with a semantic state palette. Nothing shipping was broken,
half-built or embarrassing.

What was missing was not a feature. The **Terms of Service — a contract a paying customer enters —
named no party.** It said *"Relay is early-stage software"* and *"provided as-is"* and never said by
whom. No About page, no company, no named human, one contact address in a footer.

That was survivable while the plan was paid advertising, where nobody checks who you are. It stopped
being survivable the moment the plan became editorial, which has two gatekeepers who both check.
`/security` had already written the problem down about itself — *"a caregiver about to put their
mother's bank login into a website run by someone they have never heard of"*.

**The repo had hit the same unresolved fact three times without settling it:** the legal pages named
no entity, Stripe's checkout header reads `Relay/ReportBridge/LearningAI365` from a shared personal
account, and the 10DLC route could not be chosen because nobody knew *"if Relay has an EIN"*.
Editorial made it four. One question — *who operates Relay?* — unblocked all of them.

## 4. Shipped

| Item | Axis | Commit | Proven by |
|---|---|---|---|
| **I1** Readiness assessment | assessment | `d19f7cb` | evidence table; states what is sound, what is missing, and what is explicitly not worth doing |
| **I3** J9 5–7 dropped by decision | documentation | `fb5205f` | `ratified.j9-5-7-dropped`; step 4 was built 2026-08-08 and carries the payoff |
| **I2** Relay names its operator | completeness | `d568a4d` | `operator-named.test.ts`, 6 assertions, proven by reverting `/terms` to its exact pre-today wording |
| **I4** Press boilerplate | completeness | `a7042fc` | `press-kit.test.ts`, 9 assertions, proven by planting a stale price, an estate promise and a dead asset path |
| **I5** Editorial destination reaches About | wiring | `b12f518` | assertion proven by deleting the footer entry |

Two details worth keeping:

- **The name was checked, not assumed.** 436 commits said "Steve Gharlow", GitHub said "Steve
  Harlow". The LinkedIn slug `stevengharlow` reconciled it — *Steven G. Harlow*, so `sgharlow@` is
  initials and the git config had merged the middle initial into the surname. Asked rather than
  guessed, because it was going onto a contract.
- **The press numbers are composed, not typed.** `$119` and the free cap come from
  `PRICE_YEARLY_USD` and `TIER_LIMITS.free.items`. A journalist quoting a stale price in a published
  article is the one drift bug a commit cannot fix.

## 5. Blocked / escalated

### The H0 hackathon badge, in front of a caregiver audience
Owner: **steve** · Category: decision needed (ratified copy)
`/caregivers` carries *"Winner — Most Impactful, H0 Hackathon 2026"*. For a technical audience it is
a credential. For the audience an AARP piece delivers, "hackathon" may read as *weekend project*, on
the page asking that reader to trust the product with their family's accounts. `/security` already
reached this conclusion for the front door — it moved the hackathon artefacts off it because *"on a
landing page it frames a credential vault as a weekend project"*. The badge is the remaining
instance. **Not changed:** the copy is ratified and pinned by `content.test.ts`, and changing it
unilaterally is what that pinning exists to prevent.

### Nothing from today is live
Owner: **steve** · Category: decision needed
21 commits sit on `sprint/2026-08-16-3`. **relaystandby.com still has no `/about`, and its Terms
still name nobody.** Every finding in this report is true of the branch, not of the site an editor
would check today.

## 6. Deferred, with scores

| Item | Score | Note |
|---|---|---|
| Stripe merchant name `Relay/ReportBridge/LearningAI365` | 4 | `ratified.stripe-merchant-name` left it "for the G1 flight", and that flight is cancelled — the stated reason has expired. With no entity, separating it means a second personal account. Not urgent at zero volume |
| 10DLC Sole Proprietor registration | 3 | now unblocked — `relay-operator-is-an-individual` settles the route. One number, low throughput |
| `PROMPTS.md` palette table omits `sage`/`clay` | 1 | wrong, and in a document retired with advertising. Tidying a file nobody will open |

## 7. Debt created

- `lib/g1/press-kit.ts` is a fifth place the price appears — but **composed, not copied**, and
  pinned. Noted so the count is honest rather than hidden.
- `/about` is prose that will age. Nothing tests that it stays *true*, only that it names the
  operator and routes to a human.

## 8. Recommended top 3

1. **Deploy.** Everything here is inert until it is. An editor checking today still finds a site
   that names nobody — which is the exact gap this sprint closed.
2. **Rule on the hackathon badge** before the first pitch, since a piece may point at that page.
3. **Draft angle 3** — *"the one account that unlocks the other six"*. The product is ready; the
   article is now the work. It is genuinely useful to a reader who never buys anything, which is
   what makes it publishable rather than promotional.

## 9. The honest answer to the sprint's own question

**No material incremental product work remains identifiable.** The remaining items are a positioning
decision, a deploy, and writing. Adding more surface before the first reader arrives is the
horizontal build the demand gate exists to stop — and the demand evidence is still zero.
