# Relay — Production Roadmap

**Revision 3 — 2026-08-20.** Written after sprints 1–4 (2026-08-19/20) landed on master, deployed,
and were verified live. Revision 2 (2026-08-18) planned that work; this revision records what it
changed, and re-sequences what is left.

**Status of the product:** deployed, live, billing in live mode, ten journeys walked, release gate
in two proven halves. **Status of the business:** `demand_signal: none`. Those two sentences have
been true together for three revisions of this file, and closing the gap between them is the whole
of the remaining work.

> **Authority.** Every checkable number, threshold, date, owner and ruling lives in `PROJECT.yaml`.
> This file is a *plan*, not a record. Where the two disagree, `PROJECT.yaml` is right and this file
> has a defect. Measurements quoted here are dated and carry the command that produced them, so a
> reader can re-run them rather than trust them.

---

## 0. What this revision changed, and why

**Four sprints shipped twenty items and closed fifteen of the eighteen entries in the deferred
register.** The sign-in front door has an attempt budget backed by a durable store; the KMS wall has
a verifier; the failover's inability to decrypt is written down and ruled on; a key alarm exists;
incident, breach and secret-rotation runbooks exist; Stripe is named in the subprocessor list;
support has a stated commitment; Relay's own continuity is written down; the rate limiter's
justification no longer cites a cancelled flight; unit economics are modelled; and a failed renewal
now sends the owner mail.

Re-derive the register's state rather than trusting that sentence:

```
npx tsx -e "const y=require('yaml');const f=require('fs');const p=y.parse(f.readFileSync('PROJECT.yaml','utf8'));
const d=p.deferred??[];console.log(d.length+' total, '+d.filter(x=>!x.resolved&&!x.closed).length+' open')"
```

**That work was obliged and it is now substantially done.** §2-B — the section that dominated
revision 2 — has collapsed to a single open item. The roadmap's centre of gravity moves accordingly.

### The measurement that reorders this document

Taken against production on 2026-08-20:

| what | count |
|---|---|
| `caregiver_leads` (the G1 instrument) | **0** |
| owner accounts | **1** |
| vault items | **0** |
| recipients named · verifiers named | **0** · **0** |
| invitations issued · claimed | **0** · **0** |
| releases that ever left `armed` | **0** |
| active paid subscriptions | **1** (the owner's own card, $119) |

*(re-run: `SELECT count(*) FROM caregiver_leads;` and siblings, through `lib/db/connection` under
`npx tsx --env-file=.env.local`.)*

Read that table plainly. **Four sprints hardened the custody of a vault that holds nothing, for a
population of one, who is paying himself.** That is not wasted work — it is precisely the work that
had to exist *before* a stranger could be invited, and §1's test says so. But it means the custodial
argument for further engineering is now largely spent: there is little left to protect until
somebody arrives.

Three consequences, each new to this revision:

1. **The demand lane did not move at all while those four sprints ran.** The cohort file still holds
   one person and no codes file exists, so `invite:cohort --commit` has never run. No commit has
   touched the op-ed, outlet or partner documents since 2026-08-18. `gates.g3-b2b2c-pilot-loi` is
   still `PROPOSED` and its `ratify_by` is **2026-09-01** — the nearest dated obligation in the
   project, and a *decision* rather than a build.

2. **`ladder: dogfooded` is a claim about 2026-06-27, not about the system as it stands.** The
   dogfood happened and its record is real. But the only account in production holds zero items,
   names nobody, and has never opened a release. A present-tense reading of the ladder does not
   survive the table above.

3. **The beta cohort cannot meaningfully run against an empty vault, and no plan document says so.**
   `invite:cohort` invites people to stand by as recipients and verifiers *for the owner's vault*.
   With zero items, an invitee is standing by for nothing, an access rule has nothing to point at,
   and the readiness banner has nothing to report. This is a hard prerequisite on the demand lane
   that was never written down. It is cheap, it is entirely in hand, and it now leads the sprints.

**Sprints are therefore re-sequenced.** Revision 2 opened with the editorial lane beside a large
engineering lane. Revision 3 keeps three concurrent now-lanes, but the engineering lane shrinks to
*finishing guards that are already built and turning on ones that are decorative*, and a new lane
makes the product true again so the demand lane can actually fire.

---

## 1. What "production" means for this project

Unchanged in substance from revision 2, restated because it is the frame for everything below.

Relay is already **deployed and live**: relaystandby.com serves the product, all ten claimed
journeys are live and walked against production (J10 estate is *withdrawn*, permanently — not
pending), billing is live-mode Stripe, backups run daily with an absence alarm proven to reach a
human, and the release gate is two proven halves (`npm run gate` in CI; the five-walk `verify:live`
chain with a freshness dead-man).

So "moving into production" is **not** a deployment problem. It is two promotions and one standing
obligation.

**The promotions** — in this repo's claim ladder, in order:

1. **`dogfooded` → `customer-used`** — one arms-length person uses Relay. Gated by
   `g1-arms-length-demand` (owner: steve; target, kill and date in `PROJECT.yaml`).
2. **`customer-used` → `revenue-proven`** — arms-length money moves. Per the corrected gate chain
   (`PROJECT.yaml → gates`, header comment): **G1 → G3 (parallel since 2026-08-16) → G4 billing
   MVP → G5 audited crypto**, G4/G5 entering `PROJECT.yaml` as gates once G1 passes.

⚠️ **Revision 3 adds a precondition to the first promotion that revision 2 left implicit.** The
ladder is present-tense. Before Relay can honestly claim an arms-length person *uses* it, the owner
has to use it — because the cohort mechanism, the op-ed's landing experience and the readiness
banner all assume a vault with something in it. Restoring that is Sprint 1, and it gates Sprint 2.

**The obligation** — Relay is a **custodian**. From the moment one person who is not Steve stores a
real credential, the product owes them a standard that has nothing to do with demand: that the front
door cannot be walked through, that the key material cannot be lost, that a failure is noticed by a
machine rather than by the customer, and that what the product says about itself is true. Nothing
about that duty waits for a gate — it *starts* at the first stranger.

✅ **As of 2026-08-20 that obligation is substantially discharged.** The four sprints did it. What
survives in §2-B and §2-D is not "the front door is open" work; it is "a guard exists and nothing
proves it still works" work — a materially weaker and cheaper class.

**The binding business constraint is still demand, not code.** `demand_signal: none`,
`wtp_evidence: none`, Phase 0 claim conversion has measured N = 0 since 2026-08-12, and zero
arms-length users exist. The two sequencing rules stand:

- **Demand gate before horizontal build** (portfolio rule, binding): until an arms-length demand
  signal exists, the only in-scope engineering is the thinnest sellable slice plus the channel tests
  that would produce that signal.
- **`PROJECT.yaml`'s own rule**: *no further building until G1 produces evidence* (its one ratified
  exception, `build-standby-before-g1`, is spent — standby sprints A–E shipped 2026-08-14; Sprint F
  is explicitly post-G1).

### The test that separates barred work from obliged work

Applied to every item in §2, and stated so it can be applied again rather than re-argued:

> **Barred (horizontal build):** work that adds a capability the product does not have, in the hope
> that someone will want it. Its justification is a *forecast*.
>
> **Obliged (custodial integrity):** work that makes an *existing* capability, or an *existing*
> promise, actually true and safe for the people already using it. Its justification is a *property
> of the live system*, and it would still be justified if no new user ever arrived.

Under that test, "build the SMS factor" is barred; "the front door has no attempt budget" was
obliged, and is now closed.

**Revision 3 adds a third category, which it needed in order to classify its own findings:**

> **Decorative:** a guard that exists, is declared, and is connected to nothing that would fail if it
> were violated. A coverage threshold CI never evaluates, and a report-only CSP whose reports land in
> a log that expires before anyone reads it, are both decorative. Decorative guards are *worse than
> absent ones*, because they are counted as protection in exactly the review that should have caught
> their absence. Converting a decorative guard into a real one is obliged, and it is usually one
> line.

⚠️ **If Steve disagrees with any classification, the disagreement gets recorded, not resolved by
silence.** A ruling that these wait is a legitimate ruling — the repo's own history says an
undecided item is the one that rots. What is not available is leaving them unwritten.

Consequently sprints 1–3 are **calendar-anchored** (they exist regardless of outcomes) and sprints
4–7 are **event-anchored** (they open when a gate produces evidence, and *must not start early* —
starting them early is the defect, not a head start).

---

## 2. Remaining-work inventory — the complete set

Everything known to remain, before sequencing. Each item names its source of record. Items marked
**NEW** were found in the 2026-08-20 pass and appear in no other tracking document; they are
candidates for `PROJECT.yaml → deferred` and should be entered there when they are ruled on.

Items struck through closed in sprints 1–4 and are kept for one revision so a reader can see what
moved. They are struck here and **closed in `PROJECT.yaml`, which is the record.**

### A. Demand evidence — the critical path, and now overwhelmingly the largest remaining category

**Nothing in this section moved between 2026-08-18 and 2026-08-20.** That is the finding.

| # | Item | Court | Source of record |
|---|---|---|---|
| **A0** 🔴 **NEW** | **The owner's vault is empty, so no demand instrument can fire against it.** Zero items, zero recipients, zero verifiers. A cohort invitee would stand by for nothing; an op-ed reader would land on a product whose own author does not use it. **This gates A3 and it is the cheapest item in the document.** | Claude preps, Steve supplies content | the measurement in §0 |
| A1 | Op-ed voice pass + cover email, Word doc derived from final text with the contact block, submitted to caregiver.com | steve | `docs/oped-angle-3-draft.md` send checklist |
| A2 | Second outlet: The Caregiver Space — the submission IS the finished piece; no pitch is reviewed | steve | `docs/g1-outlet-dossier.md` |
| A3 | Beta cohort: run `invite:cohort --commit` (or re-defer with a record). **Blocked on A0.** Phase 0 claim conversion is the number two shipped security decisions rest on | steve | `ratified.beta-cohort-deferred-four-days`; `docs/beta-cohort-handoff.md` |
| ~~A4~~ | ~~Ratify (or amend/decline) gate `g3-b2b2c-pilot-loi`; name two target organisations~~ | ✅ **Closed 2026-08-20 — RATIFIED AS AMENDED** by Steve, twelve days before `ratify_by`: `wealth manager` dropped from the metric, first targets named (Homethrive → Wellthy; NAC Innovation Collaborative in parallel). `due:` 2026-11-30 now governs; kill is measured on meetings | `PROJECT.yaml → gates.g3-b2b2c-pilot-loi.ratified` |
| ~~A5~~ | ~~Rule on dropping `wealth manager` from G3's categories~~ | ✅ **Closed 2026-08-20** — dropped, inside the G3 ratification (A4) | `PROJECT.yaml → gates.g3-b2b2c-pilot-loi.ratified` |
| A6 | Partner outreach → **meetings** (G3's kill is measured on meetings, not LOIs) | steve | `PROJECT.yaml → gates.g3.leading_indicator` |
| A7 | Editorial thresholds: ✅ **ratified 2026-08-20** (pass ≥6% @ N≥50 · kill <2% @ N≥150 · floor N=50 — `PROJECT.yaml → gates.g1-arms-length-demand.editorial_instrument`; reverses the 08-18 deferral on Steve's confirmation, which was named as a reversal before it was taken). **Still owed on placement day:** the `ed-*` src enters `GATE_LANES` in the commit that records the placement, then day-of `verify:funnel` + `flight:snapshot`, then flight-log entries | steve | `ratified.g1-editorial-thresholds-ratified`; `lib/ops/editorial-preflight-claims.test.ts` |
| A8 | The gate itself: ONE arms-length person who pays or writes that they would, at a seen price | steve | `PROJECT.yaml → gates.g1-arms-length-demand` |

⚠️ **A7 is the one that cannot be done late.** Thresholds calibrated against *bought clicks* do not
transfer to editorial readers, and a number chosen after the result is a fabricated gate. The
register says so in `g1-caregiver-wtp.instrument_retired.thresholds_do_not_transfer`.

### B. Custodial integrity — the live system's own standard

The section that dominated revision 2. **Eight of nine items closed in sprints 1–2.**

| # | Item | State |
|---|---|---|
| ~~B1~~ | ~~The owner's front door has no attempt budget and no rate limit~~ | ✅ **Closed 2026-08-19** — `lib/auth/signin-throttle.ts`, per-address failure budget + per-source limit, backed by the durable store in `lib/auth/signin-attempts.ts` (migration 036, applied both regions). A store that cannot answer returns `null`, never zero |
| ~~B2~~ | ~~The guess alarm covers four credentials and not this one~~ | ✅ **Closed 2026-08-19** — `totp` kind added; misses recorded from `authorize`, shipped with B1 as designed |
| ~~B3~~ | ~~The crypto path is single-region while the data path is not~~ | ✅ **Closed 2026-08-19** — limitation written down; **Steve ruled Option A: accept the single-Region CMK**, recorded rather than silently carried. `docs/kms-region-proposal.md` holds the reversal path if a partner's diligence demands it |
| ~~B4~~ | ~~Nothing watches the key the whole product depends on~~ | ✅ **Closed 2026-08-19** — `lib/ops/kms-wall.ts` + `scripts/verify-kms.ts`; `ROTATION_INTENDED = false` records the as-provisioned state rather than an aspiration. ⚠️ **Still to do: fold it into the restore drill (D3)** — a drill that never unwraps an item has not proven a recovery |
| **B5** ⚠️ | **Tenant separation at the KMS boundary is authorization, not cryptography.** `generateDataKey`/`decryptDataKey` pass no `EncryptionContext` and `DecryptCommand` names no `KeyId`, so any blob wrapped under the CMK unwraps for any caller the *application* lets through. The application-layer hole this permitted was found and closed 2026-08-13; the structure that allowed it is unchanged | 🔵 **OPEN — design done, build deferred by ruling.** `docs/encryption-context-design.md` and `docs/encryption-context-rollout.md` are written; migration 037 (`kms_context_era`) is applied in both regions so the rollout has its column. ⚠️ **Compatibility is the whole risk**: every pre-change blob has no context and must keep decrypting forever. Deliberately *not* started ahead of demand |
| ~~B6~~ | ~~The in-app alarm shares fate with product email~~ | ✅ **Closed 2026-08-19** — ruled and written down rather than rebuilt |
| ~~B7~~ | ~~No security-incident or breach-notification runbook~~ | ✅ **Closed 2026-08-19** — `docs/security-incident-runbook.md` |
| ~~B8~~ | ~~No secret rotation runbook~~ | ✅ **Closed 2026-08-19** — `docs/secret-rotation-runbook.md`. ⚠️ **The clock half is still open — see D11** |
| ~~B9~~ | ~~The privacy page names three of the four companies that receive customer data~~ | ✅ **Closed 2026-08-19** — Stripe named; the guard asserts the negative case too, after a plant matched inside `NotStripe` |

### C. Trust, identity and communications (unblocked; small; mixed court)

| # | Item | Court | Source of record |
|---|---|---|---|
| C1 | DMARC report rescue: Gmail filter + untrash before the ~2026-09-10 trash purge — 2 minutes, **hard expiry** | steve | `docs/deliverability-options-3-and-5.md` §"A deadline nobody set" |
| C2 | Outlook sender-support submission — Resend ticket, then the Microsoft form; ready-to-send, evidence must not be touched | steve | `docs/outlook-sender-support-submission.md` |
| C3 | DMARC posture step-up (`p=none`→`quarantine`, `~all`→`-all`) — only after reports accumulate post-C1 | steve | same doc, recommendation 3 |
| C4 | SMS / A2P 10DLC: **parked** 2026-08-15; route settled as Sole Proprietor (⚠️ the A2P doc's "Standard, LLC" line predates that ruling and is stale). 2–4 week lead — resume at Sprint 6, not before | steve | `docs/a2p-registration-prep.md` |
| C5 | Stripe merchant name (shared personal account header): re-decide **only if** a real customer remarks | steve | `ratified.relay-operator-is-an-individual.consequences.stripe` |
| ~~C6~~ | ~~Support has an address and no commitment~~ — ✅ **Closed 2026-08-19**: **"within one business day"**, ruled by Steve and stated on the acute paths | — | `deferred → support-has-an-address-and-no-commitment` |
| ~~C7~~ | ~~Relay's own continuity is unstated~~ — ✅ **Closed 2026-08-19**: written, not built; the mechanism already existed | — | `deferred → relays-own-continuity-is-unstated` |

### D. Operational hardening — protecting the live product; largely Claude's court

| # | Item | Source of record |
|---|---|---|
| D1 | `verify:live` cadence: the freshness dead-man fires 14 days after the newest stamp — currently ~2026-09-03 (stamped 2026-08-20). Firing is the design working; the response is to run the chain, or record a pause with a raised threshold | `lib/ops/verify-live-freshness.ts`; CLAUDE.md |
| D2 | `verify:orphans` after every walk day / interrupted fixture run | CLAUDE.md |
| D3 | **Restore drill** — a restore has run once (2026-08-08, timed); no recurring drill exists. Schedule quarterly restore-to-new-cluster with data verification. ⚠️ **Fold `verify:kms` (B4) into the success criteria** — a restored cluster is ciphertext without the key | `docs/backup-restore-runbook.md` |
| D4 | Separate test cluster so `verify:live` could enter CI: 🔵 **OPEN — RULED 2026-08-20: deferred until the first paying customer** (a priced single-region cluster was offered and declined for now). `verify:orphans` + the freshness dead-man stand in; the cause — the walks write to production — is unchanged | `deferred → verify-live-cannot-enter-ci.ruled` |
| D5 | Quarterly re-verification clocks: competitor prices (60-day clock from 2026-08-18); outlet routes re-checked before any send (they moved twice in three days) | `docs/COMPETITORS.md`; `docs/g1-outlet-dossier.md` |
| ~~D6~~ | ~~The rate limiter's upgrade trigger died with the channel that wrote it~~ | ✅ **Closed 2026-08-19** — `docs/rate-limit-stance-2026-08-20.md` re-derives the argument against the world that exists |
| ~~D7~~ | ~~Unit economics are unmodelled~~ | ✅ **Closed 2026-08-19** — `docs/unit-economics.md`. Break-even ~3 owners; the Vercel-plan assumption behind it was **resolved with evidence 2026-08-20**: production cron runs hourly (59–61 min gaps over 12 runs) and Hobby caps cron at daily, so it is a paid plan |
| ~~**D8**~~ | ~~The coverage gate is declared, passing, and enforced by nothing~~ | ✅ **Closed 2026-08-20** (`241955a`) — `test:coverage` runs in CI and the declared thresholds are evaluated on every push; proven by a planted violation. Re-derive the figures with `npm run test:coverage`, never from this row | `deferred → the-coverage-gate-is-declared-and-unenforced` |
| ~~**D9**~~ | ~~The report-only CSP cannot accumulate the evidence its own next step needs~~ | ✅ **Closed 2026-08-20, option C** (`4499a56`, `ed59864`) — the safe four stay enforced, `script-src` moves to a stricter report-only rung, and reports are PERSISTED (migration 038 `csp_reports`, both regions; `lib/ops/csp-report-store.ts`, fail-open). A real browser delivered a row the same day. ⚠️ An empty `csp_reports` still has two opposite meanings — "nothing violates" and "reports never arrive" — so read it in a real browser before trusting it | `deferred → the-csp-report-sink-expires-before-anyone-reads-it` |
| **D10** ⚠️ **NEW** | **The journey sweep is stale by a wide margin, and has been known to be.** `docs/user-journeys.md` records a walk of **2026-08-08** — **444 commits back** as measured 2026-08-20 (`git rev-list --count --since=2026-08-08 HEAD`). It was *already* flagged stale inside the document itself on 2026-08-13 ("five days and a great deal of function old", 264 commits back) and has not been re-walked in the 264 commits since that note. `verify:live` covers five walks and **J3, J6 and J9 are not among them**, so those three have no automated cover either | `docs/user-journeys.md` sweep table, and its own ⚠️ header |
| **D11** ⚠️ **NEW** | **Every secret's age is recorded as "unknown".** B8 shipped the rotation *procedure*; the clock it needs has no starting point. The AWS access key's age is discoverable without asking anyone (`aws iam list-access-keys` returns `CreateDate`; note `@aws-sdk/client-iam` is **not** a dependency, so this is CLI-side). The Vercel-held secrets need Steve | `docs/secret-rotation-runbook.md` |
| **D12** ℹ️ **NEW — watch item, not work** | Dependency currency: patch/minor drift only and **0 advisories** as of 2026-08-20. Two structural facts worth a diary entry rather than a sprint: `next-auth ^4.24.15` is the legacy line (v5/Auth.js is current), and React 18 runs under Next 16. ⚠️ **A major upgrade here is barred** by the Infrastructure Change Policy absent a documented problem — recorded so the next reviewer does not "discover" it and start one | `npm outdated`, `npm audit` |

### E. Billing and subscription lifecycle

Checkout works, the webhook reconciles, cancellation is self-serve, and `past_due` is deliberately
inside `ACTIVE_STATUSES` so a card that fails on renewal does **not** revoke access during Stripe's
retry window.

| # | Item | State |
|---|---|---|
| **E1** 🔴 | **A failed renewal now sends mail — and the wiring has never been exercised against Stripe.** `lib/billing/lapse-notice.ts` ships `notifyRenewalFailed` / `notifySubscriptionLapsed`, deduped on the Stripe event id via `audit_log`, ordered check → send → record | 🔵 **`wired`, not `live-proven`.** ⚠️ **Owed to Steve, and it is two halves:** fire a test-mode `invoice.payment_failed` at the production webhook and confirm **exactly one** email; then **re-deliver the same event and confirm nothing is sent**. The second half is the only thing that proves the dedupe, and it is the half that gets skipped |
| ~~E2~~ | ~~The post-lapse state is undefined~~ | ✅ **Closed 2026-08-19** — decided and written. Existing items are untouched by a lapse; the free-tier cap gates *adding* only (`assertWithinItemCap` / `assertBatchWithinItemCap`) |
| E3 | Renewal receipt + owner-reminder ladder before a heartbeat transition — needed before the **first real renewal** | gated with F-d |

### F. Product work already identified — gated on demand evidence

All known, scoped, and deliberately unbuilt. Building it before a gate produces evidence is the
horizontal-build pattern the rules exist to stop. **Unchanged from revision 2 — no item here moved,
and none should have.**

| # | Item | Unlocks when |
|---|---|---|
| F-a | D2 — remaining requirable factors (sms, email, passkey, hardware_key, security_questions). 🔵 **OPEN, HELD on a number**, not a date: resumes when owners are observed answering the first question | first real declaration answers |
| F-b | Field-level vault-item editing (single-item ciphertext endpoint + its step-up decision, in the same change) | first real owner maintains a vault over time |
| F-c | J8 completion slice: single-next-action card, ephemeral reveal, shared progress | a real recipient's observed need |
| ~~F-d~~ | ~~J5 retention: owner-reminder ladder before a heartbeat transition~~ — ✅ **the LADDER shipped 2026-08-21** (`wired`, not live-proven) under `ratified.journey-safety-subset-2026-08-21`: it was reclassified as a custodial false-positive guard rather than retention, because a living owner who missed one interval had verifiers asked he was incapacitated. **Still gated:** the renewal receipt, the quarterly continuity review and life-event prompts | first arms-length subscription approaching renewal |
| F-e | J2: by-exception review screen, top-three framing, continuity-ready state, document + email ingestion lanes | demand evidence |
| F-f | J3: monthly delegate digest | demand evidence |
| F-g | Secret-types Phase 2: QR scanning; AI inference of `factors_required` (advisory, owner-override) | D2 evidence + demand |
| F-h | Standby Sprint F / Phase 4: Standby Card, owner one-page plan, wallet pass, circle visibility (default off), SMS channel, re-confirm cadence | **post-G1 by ratified plan** |
| F-i | KYC at claim — vendor needed (Persona/Onfido/Stripe Identity class) | a partner's diligence or a real user demands it |
| F-j | Beta paywall ON: `TIER_LIMITS.free.canRelease` flip + un-skip the entitlements test + user-guide §2.7 — three artifacts that must move together (guarded). ⚠️ **E1's live proof is a precondition**: flipping this while an untested renewal-failure notice sits behind it converts an expired card into a blocked release | `ratified.beta-free-release` revisit 2026-10-01; changeset pre-written in `docs/paywall-flip-changeset.md` |

### G. Commercial hardening — the Build Spec Phase 2 planks that survive the narrowing

**Survives, sequenced into sprints 6–7:** B2B2C/white-label tenancy (§22) — *only against a signed
pilot*; identity verification at claim (§18, narrowed to KYC — F-i); third-party security audit +
pen test + NextAuth session-hardening review (§20; scoped to "G5, once G4 exists"); zero-knowledge
productionization — threshold crypto, HSM-backed custody, recovery quorums (§20, post-G3 scale
work); mobile (§23); provider handoff integrations and ingestion tiers 2–4 (§21) by partner pull;
per-jurisdiction residency (§22) by partner pull.

**Also here:** the **entity and insurance re-decision**. The operator ruling is right for today and
its consequences list is written for a pre-revenue product. Arms-length money, or a partner's
diligence, is the trigger to re-ask it alongside E&O/cyber cover — the same "funded from the
opportunity, not ahead of it" logic that declined counsel.

**Superseded — do not resurrect from the spec** (see §6): everything estate; paid advertising and
the Google lane.

---

## 3. The sprints

Effort labels: **S** ≤ a day · **M** ≤ a week · **L** longer. Court: who must act.

**Sprints 1–3 run concurrently, in different courts, starting now.** They are ordered by what blocks
what, not by importance: Sprint 1 is small and gates Sprint 2; Sprint 2 is the only lane that moves a
gate; Sprint 3 depends on neither and can proceed whenever Claude has a session.

### Sprint 1 — Make the claim true again *(calendar: now → 2026-08-24 · mixed court · gates Sprint 2)*

**Why first:** it is the cheapest sprint in the document and it unblocks the cohort. An empty vault
cannot host recipients, and `ladder: dogfooded` should describe the system as it is.

| # | Item | Effort | Court |
|---|---|---|---|
| 1.1 | Owner's vault holds **real** items again — enough to exercise the real shapes, not fixtures: a few credentials, at least one with `factors_required` set, at least one document-class entry | S | steve supplies, claude walks |
| 1.2 | Name at least one recipient and one verifier, with an access rule that points at real items | S | steve |
| 1.3 | Set a real release configuration and confirm the readiness banner reports something true | S | claude |
| 1.4 | Re-stamp the ladder: either `ladder: dogfooded` is re-earned present-tense, or the register says plainly that it describes 2026-06-27. **One of the two, recorded** | S | claude drafts, steve rules |
| 1.5 | `verify:orphans` after the walk (D2) | S | claude |

**Done when:** the production counts in §0 are no longer zero, and a cohort invitee would find
something to stand by for.

⚠️ **Not a fixture run.** `scripts/reset-demo.ts` exists and would produce numbers that satisfy the
table above while proving nothing. The point of this sprint is that the owner's vault is *real* — if
it is seeded, the claim ladder has not moved and the entry in 1.4 must say so.

### Sprint 2 — The demand lane, actually fired *(calendar: now → 2026-09-01 · Steve's court)*

**Why now:** it is the only lane that moves a gate, it has the longest and least predictable lead
time, and it has been stationary for four sprints. **The 2026-09-01 date is not chosen — it is
`gates.g3.ratify_by`, mechanically enforced by `lib/ops/gates.test.ts`.**

| # | Item | Effort | Blocks on |
|---|---|---|---|
| ~~**2.1**~~ | ~~Ratify, amend or decline `g3-b2b2c-pilot-loi`, and name two target organisations (A4)~~ ✅ **Done 2026-08-20** — ratified as amended | S | — |
| ~~2.2~~ | ~~Rule on dropping `wealth manager` from G3's categories (A5)~~ ✅ **Done 2026-08-20** — dropped, inside 2.1 | S | 2.1 |
| ~~**2.3**~~ | ~~Re-derive and ratify the editorial threshold and N (A7) — before any placement is live~~ ✅ **Done 2026-08-20** — ratified as proposed | M | — |
| 2.4 | Op-ed voice pass, cover email, Word doc, submit to caregiver.com (A1) | M | 2.3 |
| 2.5 | The Caregiver Space submission — the piece *is* the submission (A2) | M | 2.3 |
| 2.6 | Beta cohort `invite:cohort --commit`, or re-defer with a record (A3) | S | **Sprint 1** |
| 2.7 | Partner outreach → meetings (A6) | M | 2.1 |
| 2.8 | DMARC report rescue before the ~2026-09-10 purge (C1) — 2 minutes, hard expiry | S | — |
| 2.9 | Outlook sender-support submission (C2) | S | — |

**Done when:** G3 is ratified or declined with a record; the editorial threshold is ratified; at
least one outlet has the piece; and the cohort is either invited or deferred *with a record*.

⚠️ **2.6 is where the cohort has been deferred twice.** A third deferral is a legitimate ruling and
an unrecorded one is not. If it defers again, it needs a `revisit` date the way the first two did.

### Sprint 3 — Turn the decorative guards real *(calendar: now → 2026-09-05 · Claude's court, no dependencies)*

**Why here:** every item is obliged under §1's third category, none of it is horizontal build, and
none of it waits on anyone. It is small.

| # | Item | Effort | Notes |
|---|---|---|---|
| **3.1** | **Coverage gate into CI (D8)** — one line; it passes today, so the change is free and the protection is real | S | Re-measure in the same commit so the recorded figure is not a copy |
| **3.2** | **Decide the CSP report sink (D9)** — either persist reports somewhere that outlives a day, or enforce `script-src` on a written argument and stop pretending a report-only period is gathering data | S | ⚠️ Do not silently extend the report-only period; that is the decorative state continuing |
| 3.3 | Re-walk the journey sweep (D10); decide whether J3/J6/J9 join `verify:live` or are explicitly walk-only | M | The staleness figure is derived, never copied |
| 3.4 | Restore drill scheduled and run once, **with `verify:kms` folded into its success criteria** (D3 + B4) | M | A drill that never unwraps an item has not proven a recovery |
| 3.5 | Secret ages (D11): read the AWS key's `CreateDate` via CLI; ask Steve for the rest; start the clock | S | Steve for the Vercel-held half |
| 3.6 | **E1's live proof** — fire a test-mode `invoice.payment_failed`, confirm exactly one email; **re-deliver the same event, confirm silence** | S | **Steve's court.** Both halves or it is not proven |

**Done when:** no guard in the repo is declared-but-unevaluated, the sweep is current, the drill has
run end to end including a decrypt, and E1 has moved from `wired` to `live-proven`.

### Sprint 4 — The placement *(event: an outlet accepts)*

Opens on acceptance, not before. Ratify editorial thresholds **in the same commit** the `ed-*` src
enters `GATE_LANES`; day-of `verify:funnel` and `flight:snapshot`; flight-log entries as readers
arrive; watch the funnel for the first qualified visitors the instrument has ever seen.

### Sprint 5 — The first stranger *(event: an arms-length person appears — editorial, cohort, or partner intro)*

The moment the custodial obligation in §1 starts for real. Expect the first genuinely unknown
failure mode here; the four sprints of §2-B work exist so that it is a *usability* failure and not a
security one. Phase 0 claim conversion finally has an N. **B5 re-enters scope here if the first
stranger stores anything real** — cross-tenant separation by KMS rather than by application check is
the difference between one tenant and two.

### Sprint 6 — Distribution *(event: a G3 meeting advances toward a pilot)*

White-label tenancy scoped against the *signed* pilot's actual requirements, never speculatively.
KYC vendor selection (F-i) if diligence demands it. SMS / A2P 10DLC (C4) resumes here — 2–4 week
lead time, so it starts when a concrete need exists, not before.

### Sprint 7 — Revenue-proven and the GA bar *(event: arms-length money moves / G1 passes)*

Ladder promotion to `revenue-proven`. G4 billing MVP and G5 audited crypto enter `PROJECT.yaml` as
gates. Third-party security audit and pen test (§20). The entity/insurance re-decision (§2-G).
Zero-knowledge productionization as scale demands.

---

## 4. Dated obligations calendar — a rendering, `PROJECT.yaml` wins

| date | what | owner |
|---|---|---|
| ~2026-09-03 | `verify:live` freshness dead-man fires (14 days from the 2026-08-20 stamp) | claude |
| ~~**2026-09-01**~~ | ~~`gates.g3-b2b2c-pilot-loi.ratify_by`~~ — ✅ **met 2026-08-20**, ratified as amended; the gate's `due:` 2026-11-30 now governs | steve |
| ~2026-09-10 | DMARC reports purge from trash — hard expiry, unrecoverable after | steve |
| 2026-09-30 | `gates.g2-counsel-opinion` due date — **declined**, estate-gated instead; the date survives as a record | steve |
| 2026-10-01 | `ratified.beta-free-release` revisit — the paywall flip (F-j), preconditioned on E1 | steve |
| 2026-10-17 | competitor-price re-verification clock (60 days from 2026-08-18) | claude |
| 2026-11-30 | `gates.g3-b2b2c-pilot-loi` due | steve |
| 2026-12-31 | `gates.g1-arms-length-demand` due | steve |

---

## 5. Standing cadence (not sprint work)

- `verify:orphans` after every walk day or interrupted fixture run.
- `verify:live` when the freshness dead-man fires — or a recorded pause with a raised threshold.
- `npm run gate` on every change; it is credential-free and belongs in CI.
- Outlet routes re-checked before any send; they moved twice in three days.
- Quarterly: restore drill (including a decrypt), competitor prices, secret-rotation clock.

---

## 6. Explicitly not planned — with what would reopen each

- **Estate, in any form** — death verification, activation fees, RON-for-estate, the §24 estate
  revenue line. Withdrawn permanently with J10; `gates.g2-counsel-opinion.declined` is the record and
  `lib/ops/gates.test.ts` enforces the ordering. Reopens only by reversing that decision first, in
  its own change.
- **Paid advertising** in any channel (`ratified.retire-paid-advertising`,
  `ratified.g1-google-lane-cancelled`). The editorial instrument replaced it.
- **Caregiver Action Network sponsorship** — paid tiered marketing before one arms-length person;
  ruled out under the demand gate. Reopens when G1 passes or a Tier-1 partner requires it.
- **Feature work ahead of demand evidence** — the entire §2-F list stays behind its named unlocks.
  ⚠️ §2-B and §2-D are **not** exceptions to this rule; they are different categories, and §1 gives
  the test.
- **J9 steps 5–7** (`ratified.j9-5-7-dropped`) and **`POST /api/ai/prioritize`** — decided, not
  deferred.
- **Test-cluster build before its D4 ruling**, a **multi-Region CMK** (B3 is *ruled*: single-Region
  accepted), and a **shared-state rate limiter** (D6 is *ruled*) — infrastructure changes to a
  working system, each needing the 5-gate policy and Steve's explicit request, not a roadmap entry
  as authorisation.
- **A `next-auth` v5 / React 19 upgrade** — **NEW to this list.** D12 records the currency gap so it
  is known; the Infrastructure Change Policy bars a major-version upgrade of a working system
  without a documented problem. Reopens on a security advisory or a feature the product actually
  needs.
- **A second demand instrument before the first one reads** — the thresholds deferral guards the
  counting side; the same restraint applies to building new funnels.
- **Seeding the owner's vault with fixtures to satisfy Sprint 1** — named explicitly because it is
  the shortcut this revision's own headline invites.

---

## 7. How to keep this document honest

This file deliberately restates no number a test could catch drifting — everything checkable lives
in `PROJECT.yaml`, which the suite reads. Where revision 3 quotes a measurement, it carries its date
and the command that produced it, so the reader can re-run rather than trust.

When a sprint closes, strike its items with a date and a commit, in place. When a gate outcome
changes the plan, the change is made **here and in `PROJECT.yaml` in the same commit**, and if the
two ever disagree, `PROJECT.yaml` is right and this file has a defect. A sprint that starts before
its entry event is not ahead of schedule; it is the horizontal-build failure this roadmap exists to
prevent.

✅ **The weakness revision 2 recorded against itself is closed.** Its §2-B and §2-E findings lived in
this file and nowhere else; all fifteen became entries in `PROJECT.yaml → deferred`, each with an
owner and an `ends_when` that is a condition rather than a date. Fifteen of the eighteen are now
closed there. **The rule that produced that fix still binds everything added here: a finding
recorded only in this file is one session away from being lost.** ~~The seven items revision 3 adds — A0, D8, D9, D10, D11, D12 and E1's unproven half — are not
yet in the register~~ — ✅ **all seven were entered on 2026-08-20** by sprint-1 item S1-I3
(`d84a7e5`), which took the register from 18 entries to 25. The sentence above was true when
revision 3 was written and false within hours of it, which is exactly the failure mode §7 is
about. Re-derive the register's state with the command in §0 rather than trusting either
sentence.

⚠️ **The weakness revision 3 records against itself:** this document has now twice been rewritten to
say that demand is the binding constraint, and twice been followed by a period in which only the
engineering lane moved. The engineering lane moves because it is in Claude's court and needs nobody.
That asymmetry is not a scheduling problem to solve inside this file — but the next revision should
open by measuring §2-A's movement first, because if that section is unchanged again, no amount of
re-sequencing below it is the reason.
