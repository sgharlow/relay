# Relay — Production Roadmap

> **Written 2026-08-19** against `master` (derive the SHA: `git rev-parse --short HEAD`). This is
> the **operational roadmap**: the full set of remaining work between the product as it stands and
> a production business, organised into sprints by dependency and impact.
>
> **Authority relationships — this document restates nothing it can point at:**
>
> | Concern | Authority |
> |---|---|
> | Strategy & commercial thesis | `specs/Relay_H0_Build_Spec_v2.md` §16–27 (unchanged by this doc) |
> | Gates, dates, volatile facts, ratified decisions | `PROJECT.yaml` — **where this doc and that file disagree, that file wins** |
> | Release-access architecture | `docs/standby-architecture.md` (hybrid+6) |
> | Journey/build state | `PROJECT.yaml → journeys` + `docs/user-journeys.md` |
> | This document | remaining-work inventory and sprint sequencing, and nothing else |
>
> Numbers and dates that appear below are **renderings** of PROJECT.yaml fields, named where they
> occur. Do not correct a date here without correcting it there; do not quote a number from here
> into anything.
>
> **Mandatory roadmap sections** (portfolio Documentation & Claim Discipline), by reference so they
> have one home each: **gates** → `PROJECT.yaml → gates` (numeric targets, kills, owners, dates);
> **named competitors** → `docs/COMPETITORS.md` (prices re-verified 2026-08-18, 60-day clock);
> **monetization path** → `PROJECT.yaml → monetization_path` (live-mode Stripe annual, charged end
> to end 2026-08-08); **post-event branch plan** → `PROJECT.yaml → post_event_plan` (H0 disposition
> met: commercialize; the commercial fork is the gate chain below).

---

## 1. What "production" means for this project

Relay is already **deployed, live, and dogfooded**: relaystandby.com serves the product, all ten
claimed journeys are live and walked against production (J10 estate is *withdrawn*, permanently —
not pending), billing is live-mode Stripe, backups run daily with an absence alarm proven to reach
a human, and the release gate is two proven halves (`npm run gate` in CI; the five-walk
`verify:live` chain with a freshness dead-man). Test counts, route counts and the deployed SHA are
volatile — derive them with the commands in `PROJECT.yaml → derived`, never from prose.

So "moving into production" here is **not** a deployment problem. In this repo's claim ladder it is
two promotions, in order:

1. **`dogfooded` → `customer-used`** — one arms-length person uses Relay. Gated by
   `g1-arms-length-demand` (owner: steve; target, kill and date in `PROJECT.yaml`).
2. **`customer-used` → `revenue-proven`** — arms-length money moves. Per the corrected gate chain
   (`PROJECT.yaml → gates`, header comment): **G1 → G3 (parallel since 2026-08-16) → G4 billing
   MVP → G5 audited crypto**, G4/G5 entering PROJECT.yaml as gates once G1 passes.

**The binding constraint is demand, not code.** `demand_signal: none`, `wtp_evidence: none`,
Phase 0 claim conversion has measured N = 0 since 2026-08-12, and zero arms-length users exist.
Every sprint below is shaped by the two sequencing rules already in force:

- **Demand gate before horizontal build** (portfolio rule, binding): until an arms-length demand
  signal exists, the only in-scope engineering is the thinnest sellable slice plus the channel
  tests that would produce that signal.
- **`PROJECT.yaml`'s own rule**: *no further building until G1 produces evidence* (its one
  ratified exception, `build-standby-before-g1`, is spent — standby sprints A–E shipped
  2026-08-14; Sprint F is explicitly post-G1).

Consequently sprints 1–3 are **calendar-anchored** (they exist regardless of outcomes) and sprints
4–6 are **event-anchored** (they open when a gate produces evidence, and *must not start early* —
starting them early is the defect, not a head start).

---

## 2. Remaining-work inventory — the complete set

Everything known to remain, before sequencing. Each item names its source of record.

### A. Demand evidence (the critical path — largely Steve's court)

| # | Item | Source of record |
|---|---|---|
| A1 | Op-ed voice pass + cover email (planned 2026-08-19), Word doc derived from final text with the contact block, submitted to caregiver.com | `docs/oped-angle-3-draft.md` send checklist |
| A2 | Second outlet: The Caregiver Space — the submission IS the finished piece; no pitch is reviewed | `docs/g1-outlet-dossier.md` |
| A3 | Beta cohort: run `invite:cohort` (or re-defer with a record) — Phase 0 claim conversion is the number two shipped security decisions rest on | `PROJECT.yaml → ratified.beta-cohort-deferred-four-days` (revisit 2026-08-23); `docs/beta-cohort-handoff.md` |
| A4 | Ratify (or amend/decline) gate `g3-b2b2c-pilot-loi`; name two target organisations | `PROJECT.yaml → gates.g3` (ratify_by 2026-09-01, mechanically enforced); `docs/g3-partner-dossier.md` (rec: Homethrive → Wellthy; NAC Innovation Collaborative in parallel) |
| A5 | Rule on dropping `wealth manager` from G3's categories — inherited from the withdrawn estate product | `docs/g3-partner-dossier.md` §7–9 |
| A6 | Partner outreach → **meetings** (G3's kill is measured on meetings, not LOIs) | `PROJECT.yaml → gates.g3.leading_indicator` |
| A7 | On acceptance of a placement: ratify editorial thresholds **in the same commit** the `ed-*` src enters `GATE_LANES` (guarded), then day-of `verify:funnel` + `flight:snapshot`, then flight-log entries | `docs/g1-editorial-threshold-proposal.md`; `lib/ops/editorial-preflight-claims.test.ts` |
| A8 | The gate itself: ONE arms-length person who pays or writes that they would, at a seen price | `PROJECT.yaml → gates.g1-arms-length-demand` |

### B. Trust, identity and communications (unblocked; small; mixed court)

| # | Item | Source of record |
|---|---|---|
| B1 | DMARC report rescue: Gmail filter + untrash before the ~2026-09-10 trash purge — 2 minutes, hard expiry | `docs/deliverability-options-3-and-5.md` §"A deadline nobody set" |
| B2 | Outlook sender-support submission — Resend ticket, then the Microsoft form; the doc is ready-to-send and the evidence must not be touched | `docs/outlook-sender-support-submission.md` |
| B3 | DMARC posture step-up (`p=none`→`quarantine`, `~all`→`-all`) — only after reports accumulate post-B1 | same doc, recommendation 3 |
| B4 | SMS / A2P 10DLC: **parked** 2026-08-15; the route is now settled as Sole Proprietor by the operator ruling (⚠️ the A2P doc's "Standard, LLC" line predates that ruling and is stale). 2–4 week lead time — resume when a concrete need exists (Sprint 5), not before | `docs/a2p-registration-prep.md`; `PROJECT.yaml → ratified.relay-operator-is-an-individual.consequences.sms_10dlc` |
| B5 | Stripe merchant name (shared personal account header): re-decide **only if** a real customer remarks | `ratified.relay-operator-is-an-individual.consequences.stripe` |

Closed, for orientation (the 2026-08-16 readiness assessment's blockers): the operator question is
**ruled** — Steve personally, no entity — and implemented on `/about`, `/terms`, `/privacy`; the
press kit exists (`lib/g1/press-kit.ts`, test-pinned); the H0 badge is reframed
(`ratified.h0-badge-reframed`).

### C. Operational hardening (protecting the live product; largely Claude)

| # | Item | Source of record |
|---|---|---|
| C1 | `verify:live` cadence: the freshness dead-man fires 14 days after the newest stamp — currently ~2026-09-02. Firing is the design working; the response is to run the chain (or record a pause with a raised threshold) | `lib/ops/verify-live-freshness.ts`; CLAUDE.md |
| C2 | `verify:orphans` after every walk day / interrupted fixture run | CLAUDE.md |
| C3 | Restore **drill**: a restore has run once (2026-08-08, timed); no recurring drill exists. Schedule quarterly restore-to-new-cluster with data verification | `docs/backup-restore-runbook.md` |
| C4 | D4 — separate test cluster so `verify:live` could enter CI: **open, Steve's call, cost attached.** Two symptoms now mitigated (orphan count, dead-man); the cause is not. Recommend: defer until the first paying customer, then re-argue under the 5-gate infra policy | `PROJECT.yaml → deferred → verify-live-cannot-enter-ci` (incl. `partially_mitigated`) |
| C5 | Quarterly re-verification clocks: competitor prices (60-day clock from 2026-08-18); outlet routes re-checked before any send (they moved twice in three days) | `docs/COMPETITORS.md`; `docs/g1-outlet-dossier.md` |

### D. Product work already identified — **gated on demand evidence**

All of this is known, scoped, and deliberately unbuilt. Building it before a gate produces evidence
is the horizontal-build pattern the rules exist to stop.

| # | Item | Unlocks when | Source of record |
|---|---|---|---|
| D-a | D2 — remaining requirable factors (sms, email, passkey, hardware_key, security_questions). **HELD**: resumes on a *number* (owners observed answering the first question), not a date | first real declaration answers | `PROJECT.yaml → deferred → D2.held` |
| D-b | Field-level vault-item editing (single-item ciphertext endpoint + its step-up decision, made in the same change) | first real owner maintains a vault over time | `ratified.no-single-item-ciphertext-endpoint-yet` |
| D-c | J8 completion slice: single-next-action card, ephemeral reveal, shared progress | a real recipient's observed need | `docs/user-journeys.md` "genuinely open" |
| D-d | J5 retention: renewal receipt + owner-reminder ladder before a heartbeat transition (needed before the **first real renewal**); quarterly review + life-event prompts stay behind demand | first arms-length subscription approaching renewal | same |
| D-e | J2: by-exception review screen, top-three framing, continuity-ready state, document + email ingestion lanes | demand evidence | same |
| D-f | J3: monthly delegate digest | demand evidence | same |
| D-g | Secret-types Phase 2: QR scanning; AI inference of `factors_required` (advisory, owner-override) | D2 evidence + demand | `docs/secret-types-design.md` §Phase 2 |
| D-h | Standby Sprint F / Phase 4: Standby Card, [A5] owner one-page plan, wallet pass, circle visibility (default off), SMS channel, re-confirm cadence | **post-G1 by ratified plan** | `docs/standby-sprint-plan.md` §Sprint F; `docs/standby-architecture.md` §6 |
| D-i | KYC at claim — vendor needed (Persona/Onfido/Stripe Identity class) | a partner's diligence or a real user demands it | `docs/user-journeys.md` [P2]; Build Spec §18 |
| D-j | Beta paywall ON: `TIER_LIMITS.free.canRelease` flip + un-skip the entitlements test + user-guide §2.7 — three artifacts that must move together (guarded) | `ratified.beta-free-release` revisit (2026-10-01) or beta end | `PROJECT.yaml → ratified.beta-free-release`; `lib/ops/gates.test.ts` |

### E. Commercial hardening — the Build Spec Phase 2 planks that survive the narrowing

Build Spec §17–27 was written pre-win and pre-narrowing. Reconciled against ratified decisions:

**Survives, sequenced into sprints 5–6:** B2B2C/white-label tenancy (§22) — *only against a signed
pilot*; identity verification at claim (§18, narrowed to KYC — D-i); third-party security audit +
pen test + NextAuth session-hardening review (§20; `docs/security-remediation-plan.md` scopes these
to "G5, once G4 exists"); zero-knowledge productionization — threshold crypto, HSM-backed custody,
recovery quorums (§20, post-G3 scale work); mobile (§23); provider handoff integrations and
ingestion tiers 2–4 (§21) by partner pull; per-jurisdiction residency (§22) by partner pull.

**Superseded — do not resurrect from the spec** (see §6 below): everything estate — death
verification, the estate activation fee, RON-for-estate, "highest-WTP estate moment" (withdrawn
with J10; `gates.g2-counsel-opinion.declined`); paid advertising and the Google lane
(`ratified.retire-paid-advertising`, `ratified.g1-google-lane-cancelled`).

---

## 3. The sprints

Effort labels: **S** ≤ a day · **M** ≤ a week · **L** longer. Court: who must act.

### Sprint 1 — Into an editor's inbox *(calendar: now → 2026-09-01)*

The single highest-impact block of work in the project. Everything in it is already unblocked, and
nothing in any later sprint matters if this one stalls: the gate that defines production waits on a
stranger, and this sprint is every path a stranger could arrive by.

| # | Work | Court | Effort |
|---|---|---|---|
| 1.1 | Voice pass on the op-ed + cover email (planned 2026-08-19; AARP's AI-pitch blacklist is why neither can be delegated) | **Steve** | S |
| 1.2 | Produce the Word document from the final text — derived, not retyped — with the row-7a contact block read from `.relay-submitter.json` (gitignored; the values never enter the repo) | Claude | S |
| 1.3 | Send to nancy@caregiver.com per the send checklist | **Steve** | S |
| 1.4 | Beta cohort ruling at the 2026-08-23 revisit: run `invite:cohort` dry-run → `--commit`, or re-defer with a record. The staged `.relay-cohort.json` must not sit in the third state | **Steve** (Claude co-pilots) | S |
| 1.5 | G3 ruling by 2026-09-01 (mechanically enforced): ratify/amend/decline; name two organisations; rule on A5 (wealth-manager category) | **Steve** | S |
| 1.6 | First partner-outreach drafts for the named orgs — Steve sends; NAC's named contact is the cheap parallel probe (ask about fees and startup eligibility in the first email) | Claude drafts, **Steve** sends | S |
| 1.7 | DMARC rescue (B1) — before ~2026-09-10, hard expiry | **Steve** | S |
| 1.8 | Outlook sender-support submission (B2) — Resend ticket, then the form | **Steve** | S |

**Exit:** the piece is in an editor's inbox; the cohort is running or explicitly re-deferred; G3 is
ruled; both deliverability actions filed. **Explicit non-goal:** any feature work.

### Sprint 2 — Hold the bar while the mail is out *(calendar: ~2026-09-01 → 2026-10-01)*

Editorial responses take 2–6 weeks. This sprint keeps the product's evidence fresh and closes the
operational decisions that need no demand signal — without inventing work to fill the wait.

| # | Work | Court | Effort |
|---|---|---|---|
| 2.1 | `verify:live` before ~2026-09-02 (dead-man) and at every release thereafter; `verify:orphans` after each walk day | Claude (needs `.env.local` machine) | S |
| 2.2 | D4 ruling: recommend **defer to first paying customer**, recorded on the deferred item — not silence | **Steve** | S |
| 2.3 | Schedule the quarterly restore drill (C3); run the first one | Claude, Steve approves the restore | M |
| 2.4 | caregiver.com follow-up if silent ~2 weeks; then The Caregiver Space submission (the finished piece adapted to their guidelines — *"we do not publish marketing fluff"* is their stated bar) | **Steve** (Claude adapts text) | S–M |
| 2.5 | Partner meetings from 1.6 — log each against G3's leading indicator | **Steve** | — |
| 2.6 | Phase 0 reads as claims occur (`phase0-report`); if the cohort shows claim conversion problems, that is *evidence work* and in bounds to fix | Claude | S |
| 2.7 | The 2026-10-01 revisits, on time: `beta-free-release` (paywall decision — D-j's three artifacts move together if flipped) and the `g1-arms-length-demand` revisit cadence | **Steve** | S |
| 2.8 | B3 DMARC posture step-up, only after B1 reports accumulate | Claude proposes, **Steve** applies DNS | S |

**Exit:** every dated obligation through 10-01 dispatched on its date; at least one partner meeting
taken or every named route exhausted and recorded. **Explicit non-goal:** SMS registration
(nothing needs it yet), feature work, test-cluster build.

### Sprint 3 — The placement *(event: an outlet accepts)*

Short, sharp, and entirely about not fumbling the measurement the whole demand lane exists for.

| # | Work | Court | Effort |
|---|---|---|---|
| 3.1 | Ratify the editorial thresholds **in the same commit** that moves the `ed-*` slug from `PLANNED_EDITORIAL_SRCS` into `GATE_LANES` — the ordering is guarded; the alternative (counting without thresholds) requires a recorded decision | **Steve** ratifies, Claude commits | S |
| 3.2 | Publication day: `verify:funnel` + `flight:snapshot`; confirm the byline link carries the placement's own src | Claude | S |
| 3.3 | Flight-log entries per the log's own rules; no-read floor below N=50 — a placement driving <10 qualified visits is a *distribution* finding, not a demand finding | Claude | S |
| 3.4 | Any G1 date consequence handled by a `moved:` block, never silently | **Steve** | S |

### Sprint 4 — The first stranger *(event: an arms-length person appears — via editorial, cohort, or a partner intro)*

This is the `customer-used` promotion, and the first sprint where building resumes — pulled by an
observed person, one thinnest slice at a time.

| # | Work | Court | Effort |
|---|---|---|---|
| 4.1 | Support the person directly; record `demand_signal` with evidence in PROJECT.yaml; promote `ladder` to `customer-used` only on the gate's own definition of counting | **Steve** + Claude | S |
| 4.2 | D3 evidence read: are owners answering the declaration prompt? → unlock **or re-hold** D2 (its `resumes_when` is a number) | Claude | S |
| 4.3 | Field-level item editing (D-b) the first time a real owner needs to add a factor without retyping a password — the `/api/kms/unwrap` step-up decision lands in the same change, per the ratified entry | Claude | M |
| 4.4 | J8 slice (D-c) — only the piece a real recipient's experience shows is missing | Claude | M |
| 4.5 | Renewal-path pieces of J5 (D-d) before the first real renewal date: renewal receipt, pre-heartbeat reminder ladder | Claude | M |
| 4.6 | Paywall decision if still open (D-j) — a paying stranger is what the flag was waiting for | **Steve** | S |

**Entry:** `g1-arms-length-demand` met, or a named person actively converting. **Not** a calendar
date. **Exit:** `demand_signal` ≠ none in PROJECT.yaml, with evidence.

### Sprint 5 — Distribution *(event: a G3 meeting advances toward a pilot)*

| # | Work | Court | Effort |
|---|---|---|---|
| 5.1 | Partner-diligence pack: security posture (audit-log chain, least-privilege walls, backup/restore evidence, the `verify:*` suite as demonstrable controls), operator disclosure, and prepared answers to counsel questions Q1/Q3/Q11 — this conversation is `g2-counsel-opinion`'s own `revisit` trigger (a): **counsel gets funded from the opportunity, not ahead of it** | Claude prepares, **Steve** presents | M |
| 5.2 | Sprint F artifacts as partner-facing collateral (D-h): Standby Card, [A5] one-page plan, wallet pass, circle visibility (default off), re-confirm cadence — their post-G1 gate is satisfied by this sprint's entry condition | Claude | L |
| 5.3 | SMS: resume A2P registration (B4, Sole-Proprietor route) the moment a partner or the escalation channel needs it — the 2–4 week clock is the reason this is here and not later | **Steve** (~45 min) + Claude (~1 day post-approval) | M |
| 5.4 | KYC-at-claim vendor selection (D-i) if diligence demands it | **Steve** decision, Claude integration | L |
| 5.5 | B2B2C tenancy scoping (Build Spec §22) **only against a signed pilot's actual requirements** — explicitly not speculative | Claude | L |

### Sprint 6 — Revenue-proven and the GA bar *(event: arms-length money moves / G1 passes)*

Per the corrected gate chain, G4 and G5 enter `PROJECT.yaml` as gates when G1 passes; this sprint
is their execution shell.

| # | Work | Court | Effort |
|---|---|---|---|
| 6.1 | **G4 — billing MVP as a gate**: paywall enforced for arms-length signups; entitlements live end to end; ladder → `revenue-proven` on the gate's evidence | **Steve** ratifies gate, Claude ships | M |
| 6.2 | **G5 — audited crypto as a gate**: third-party security audit + penetration test; NextAuth session-hardening review folded into the audit scope (per the security plan's out-of-scope ledger) | **Steve** engages, Claude remediates | L |
| 6.3 | Zero-knowledge productionization scoped from Build Spec §20 (threshold crypto, HSM custody, recovery quorums) — post-G3 scale work by its own plan | Claude scopes, **Steve** sequences | L |
| 6.4 | D4 re-ruling at first paying customer: a test cluster now protects real customer data from the walks — re-argue under the 5-gate infra policy with that documented problem | **Steve** | M |
| 6.5 | Remaining §21–23 planks (mobile, ingestion tiers, residency, editions) strictly by partner/customer pull, each entering PROJECT.yaml with its own gate | both | L |

---

## 4. Dated obligations calendar — a rendering, PROJECT.yaml wins

| Date | Obligation | Owning record |
|---|---|---|
| 2026-08-19 | Voice pass + cover email (planned) | `docs/oped-angle-3-draft.md` checklist rows 1–2 |
| 2026-08-23 | Beta cohort ruling | `ratified.beta-cohort-deferred-four-days.revisit` |
| ~2026-09-02 | `verify:live` freshness dead-man fires unless the chain runs | `lib/ops/verify-live-freshness.ts` (14d from newest stamp) |
| 2026-09-01 | G3 ratify-by (suite goes red if unratified); G1 revisit cadence begins | `gates.g3.ratify_by`; `gates.g1-caregiver-wtp.revisit` |
| ~2026-09-10 | DMARC reports purged from Gmail trash — evidence destroyed | `docs/deliverability-options-3-and-5.md` |
| 2026-10-01 | `beta-free-release` revisit (paywall); `g1-arms-length-demand` revisit cadence begins | both in PROJECT.yaml |
| 2026-11-30 | Editorial-thresholds deferral revisit; G3 due (kill measured on **meetings**) | `ratified.g1-editorial-thresholds-deferred`; `gates.g3.due` |
| 2026-12-31 | **G1 due: one arms-length person, or park D2C / B2B2C-only / archive** | `gates.g1-arms-length-demand` |

## 5. Standing cadence (not sprint work)

`verify:live` at every release and within every 14 days · `verify:orphans` after walk days ·
`verify:schema` after any migration and before any release · `flight:snapshot` daily only while a
measurement window is open · restore drill quarterly (first: Sprint 2) · competitor prices and
outlet routes re-verified on their own clocks (§2-C5) · every `revisit:` date in PROJECT.yaml
surfaced at `/daily-priority`.

## 6. Explicitly not planned — with what would reopen each

- **Estate, in any form** — death verification, activation fees, RON-for-estate, the §24 estate
  revenue line. Withdrawn permanently with J10; `gates.g2-counsel-opinion.declined` is the record
  and `lib/ops/gates.test.ts` enforces the ordering. Reopens only by reversing that decision first,
  in its own change.
- **Paid advertising** in any channel (`ratified.retire-paid-advertising`;
  `ratified.g1-google-lane-cancelled`). The editorial instrument replaced it.
- **Caregiver Action Network sponsorship** — paid tiered marketing before one arms-length person;
  ruled out under the demand gate (`docs/g3-partner-dossier.md` §6). Reopens when G1 passes or a
  Tier-1 partner requires it.
- **Feature work ahead of demand evidence** — the entire §2-D list stays behind its named unlocks.
- **J9 steps 5–7** (`ratified.j9-5-7-dropped`) and **`POST /api/ai/prioritize`**
  (`docs/retired-surface.md`) — decided, not deferred.
- **Test-cluster build before its D4 ruling**, and any infra change outside the 5-gate policy
  (DB moves, proxy layers, auth-provider changes, major-version upgrades).
- **A second demand instrument before the first one reads** — the thresholds deferral already
  guards the counting side; the same restraint applies to building new funnels.

## 7. How to keep this document honest

This file deliberately restates no number a test could catch drifting — everything checkable lives
in `PROJECT.yaml`, which the suite reads. When a sprint closes, strike its items with a date and a
commit, in place. When a gate outcome changes the plan, the change is made **here and in
PROJECT.yaml in the same commit**, and if the two ever disagree, PROJECT.yaml is right and this
file has a defect. A sprint that starts before its entry event is not ahead of schedule; it is the
horizontal-build failure this roadmap exists to prevent.
