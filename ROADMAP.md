# Relay — Production Roadmap

> **Written 2026-08-19. Revised the same day** after a full re-analysis of the requirements, the
> live code, the live infrastructure and this document's own first pass (derive the SHA:
> `git rev-parse --short HEAD`). This is the **operational roadmap**: the full set of remaining
> work between the product as it stands and a production business, organised into sprints by
> dependency and impact.
>
> **Authority relationships — this document restates nothing it can point at:**
>
> | Concern | Authority |
> |---|---|
> | Strategy & commercial thesis | `specs/Relay_H0_Build_Spec_v2.md` §16–27 (unchanged by this doc) |
> | Gates, dates, volatile facts, ratified decisions, debt register | `PROJECT.yaml` — **where this doc and that file disagree, that file wins** |
> | Release-access architecture | `docs/standby-architecture.md` (hybrid+6) |
> | Journey/build state | `PROJECT.yaml → journeys` + `docs/user-journeys.md` |
> | Invariants a change must not break | `CLAUDE.md` → "Architecture — the non-obvious invariants" |
> | This document | remaining-work inventory and sprint sequencing, and nothing else |
>
> Numbers and dates that appear below are **renderings** of PROJECT.yaml fields, named where they
> occur. Do not correct a date here without correcting it there; do not quote a number from here
> into anything. Code is cited by **file and symbol**, never by line number — a line number is a
> volatile fact too, and this document has no test watching it.
>
> **Mandatory roadmap sections** (portfolio Documentation & Claim Discipline), by reference so they
> have one home each: **gates** → `PROJECT.yaml → gates` (numeric targets, kills, owners, dates);
> **named competitors** → `docs/COMPETITORS.md` (prices re-verified 2026-08-18, 60-day clock);
> **monetization path** → `PROJECT.yaml → monetization_path` (live-mode Stripe annual, charged end
> to end 2026-08-08); **post-event branch plan** → `PROJECT.yaml → post_event_plan` (H0 disposition
> met: commercialize; the commercial fork is the gate chain below).

---

## 0. What this revision changed, and why

The first pass of this document, written this morning, inventoried the remaining work as **demand
evidence plus ops cadence, with all engineering deferred behind a gate**. That framing is correct
about the *business* and it was incomplete about the *system*, because it took "nothing in the
shipping product is broken, half-built or embarrassing" (`docs/product-readiness-assessment-2026-08-16.md`)
as covering the whole question. That assessment measured what a *reader and an editor* would see.
It did not ask what a **custodian of other people's credentials** owes the people already inside.

A deeper pass over the live code and infrastructure found **nine items nothing in this repo was
tracking** — not in `PROJECT.yaml → deferred`, not in any sprint report, not in this roadmap's
first pass. They are inventoried in §2-B and §2-E and each carries its own evidence. The largest of
them is that the owner's front door — the single factor that stands between a stranger and a
family's decrypted vault — has neither an attempt budget nor a rate limit, while four *lesser*
credentials in the same codebase have both.

Three structural changes follow from that:

1. **Two lanes, not one queue.** The demand lane (Steve's court) and the custodial-integrity lane
   (Claude's court) run **concurrently**. They contend for nothing: one is writing and sending, the
   other is changing code. Sequencing them would be a choice to do less for no gain.
2. **A dependency the first pass missed.** Sprint 1's beta cohort is the act that puts *real people
   with real credentials* behind that front door. The integrity work is therefore a **precondition
   of the cohort**, not a competitor to it.
3. **The demand gate is named more precisely.** It bars **horizontal build** — new surface ahead of
   evidence. It has never barred **keeping the live system trustworthy for the people already in
   it**, and reading it that way would make it a rule against maintenance. §1 states the test used
   to tell the two apart, so a future session can apply it rather than re-derive it.

Everything the first pass got right is retained, mostly verbatim: the demand sprint is still the
highest-impact block of work in the project, the product backlog stays behind its named unlocks,
and the "explicitly not planned" list is unchanged.

**Verified live in this pass, rather than read from prose:** the suite runs green under `TZ=UTC`;
`master` and `origin/master` agree and the deployed production build on Vercel is that commit; nine
public routes (`/`, `/caregivers`, `/about`, `/terms`, `/privacy`, `/security`, `/claim`,
`/standby`, `/verify`) answer 200 from relaystandby.com and `/api/health/scheduler` reports
healthy. That is a sample, not the full page list — `docs/product-readiness-assessment-2026-08-16.md`
holds the last complete crawl. Derive counts and SHAs with the commands in `PROJECT.yaml → derived`
— none are restated here.

---

## 1. What "production" means for this project

Relay is already **deployed, live, and dogfooded**: relaystandby.com serves the product, all ten
claimed journeys are live and walked against production (J10 estate is *withdrawn*, permanently —
not pending), billing is live-mode Stripe, backups run daily with an absence alarm proven to reach
a human, and the release gate is two proven halves (`npm run gate` in CI; the five-walk
`verify:live` chain with a freshness dead-man).

So "moving into production" is **not** a deployment problem. It is two promotions and one standing
obligation, and the first pass of this document named only the promotions.

**The promotions** — in this repo's claim ladder, in order:

1. **`dogfooded` → `customer-used`** — one arms-length person uses Relay. Gated by
   `g1-arms-length-demand` (owner: steve; target, kill and date in `PROJECT.yaml`).
2. **`customer-used` → `revenue-proven`** — arms-length money moves. Per the corrected gate chain
   (`PROJECT.yaml → gates`, header comment): **G1 → G3 (parallel since 2026-08-16) → G4 billing
   MVP → G5 audited crypto**, G4/G5 entering PROJECT.yaml as gates once G1 passes.

**The obligation** — Relay is a **custodian**. From the moment one person who is not Steve stores a
real credential, the product owes them a standard that has nothing to do with demand: that the
front door cannot be walked through, that the key material cannot be lost, that a failure is
noticed by a machine rather than by the customer, and that what the product says about itself is
true. Nothing about that duty waits for a gate — it *starts* at the first stranger, and the beta
cohort in Sprint 1 is what starts it.

**The binding business constraint is still demand, not code.** `demand_signal: none`,
`wtp_evidence: none`, Phase 0 claim conversion has measured N = 0 since 2026-08-12, and zero
arms-length users exist. The two sequencing rules stand:

- **Demand gate before horizontal build** (portfolio rule, binding): until an arms-length demand
  signal exists, the only in-scope engineering is the thinnest sellable slice plus the channel
  tests that would produce that signal.
- **`PROJECT.yaml`'s own rule**: *no further building until G1 produces evidence* (its one
  ratified exception, `build-standby-before-g1`, is spent — standby sprints A–E shipped
  2026-08-14; Sprint F is explicitly post-G1).

### The test that separates barred work from obliged work

Applied to every item in §2, and stated so it can be applied again rather than re-argued:

> **Barred (horizontal build):** work that adds a capability the product does not have, in the hope
> that someone will want it. Its justification is a *forecast*.
>
> **Obliged (custodial integrity):** work that makes an *existing* capability, or an *existing*
> promise, actually true and safe for the people already using it. Its justification is a
> *property of the live system*, and it would still be justified if no new user ever arrived.

Under that test, "build the SMS factor" is barred; "the front door has no attempt budget" is
obliged. "Build the monthly delegate digest" is barred; "the privacy page names three of the four
companies that receive customer data" is obliged. The four §2-B findings marked 🔴 are obliged
under this test and would each be a defect in a product with one paying customer, which is the
product this roadmap is trying to reach.

⚠️ **If Steve disagrees with that classification, the disagreement gets recorded, not resolved by
silence.** A ruling that these wait is a legitimate ruling — the repo's own history says an
undecided item is the one that rots. What is not available is leaving them unwritten, which is the
state this revision found them in.

Consequently sprints 1–3 are **calendar-anchored** (they exist regardless of outcomes) and sprints
4–7 are **event-anchored** (they open when a gate produces evidence, and *must not start early* —
starting them early is the defect, not a head start).

---

## 2. Remaining-work inventory — the complete set

Everything known to remain, before sequencing. Each item names its source of record. Items marked
**NEW** were found in the 2026-08-19 deep pass and appear in no other tracking document; they are
candidates for `PROJECT.yaml → deferred` and should be entered there when they are ruled on.

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

### B. Custodial integrity — the live system's own standard

**The section the first pass did not have.** Every item is a property of the code that is deployed
right now. None of them adds a feature; each makes an existing promise true. Ordered by
consequence.

> **Each item below is now an entry in `PROJECT.yaml → deferred`** (added 2026-08-20), which is the
> authoritative debt register and the file the next session reads. Every entry carries its short
> code here — `B1`, `C7`, `E2` — as a comment on its `id:`, so searching that file for the code
> finds it. The mapping is deliberately not restated as a table: two copies of a mapping is two
> things to drift. **Where this document and that file disagree about an item's state, that file
> wins.**

| # | Item | Evidence | What closes it |
|---|---|---|---|
| **B1** 🔴 **NEW** | **The owner's front door has no attempt budget and no rate limit.** Owner sign-in is `email` + a 6-digit TOTP code and nothing else — there is no password (`SignInForm.tsx` says so in a comment). The `email-totp` provider's `authorize` in `lib/auth/auth-options.ts` performs a database lookup and a code comparison per attempt, with no per-account failure counter and no call into `lib/http/rate-limit`. A takeover yields decrypted items: `/api/kms/unwrap` requires only an owner session — `lib/ops/step-up-guard.ts` elevates bulk export, recovery codes and account deletion, and correctly does not elevate item-by-item reveal | Read the provider and grep for a limiter: there is none. **The asymmetry is the proof this is an oversight rather than a decision** — `recipient-code.ts`, `verifier-code.ts` and `recovery-code.ts` each carry `MAX_FAILED_ATTEMPTS`, `/api/account/step-up` calls `rateLimit`, and `break-glass` carries a written argument for why it needs neither (~59 bits of entropy). The 6-digit code is the *shortest* secret in the product and the only one with no argument attached | A per-account attempt budget on `email-totp` (the shape `recipient-code.ts` already uses), plus the `rateLimit` call the step-up route already makes. Verify whether a Vercel WAF rule covers `/api/auth/callback/credentials` — currently unknown, and unknown is not covered |
| **B2** 🔴 **NEW** | **The guess alarm covers four credentials and not this one.** `lib/ops/guess-watch.ts` exists precisely because "a guess at a code that does not exist left no trace at all". Its `GuessKind` union is `recipient \| verifier \| invitation \| recovery`. TOTP is absent, so a walk through the sign-in keyspace is not only unlimited, it is **unobserved** | The union, and its call sites: `recipient-code.ts`, `verifier-code.ts`, `recovery-code.ts`, `people/claim.ts`. No call from the auth provider | Add a `totp` kind and record misses from `authorize`. Ships in the same change as B1 — a limiter without the alarm hides the attack it deflects |
| **B3** 🔴 **NEW** | **The crypto path is single-region while the data path is not.** `lib/kms/kms-client.ts` builds one `KMSClient` from `AWS_REGION` (default `us-east-1`) against one CMK. `lib/db/connection.ts` keeps primary + secondary pools and `DSQL_USE_SECONDARY=true` fails the *database* over to us-west-2 — **the failover the demo relies on does not carry the ability to decrypt with it.** A us-east-1 KMS impairment makes every vault unreadable from both regions, and nothing in the repo says so | Read both modules. `docs/aws-setup.md` creates a single-region key and never revisits it. No doc in `docs/` mentions a replica key, a multi-Region key, or KMS in a failover context | First: **write the limitation down** — in the runbook and in whatever the product tells an owner about availability. Then a decision, under the 5-gate infrastructure policy, on whether a multi-Region CMK is warranted (it is an AWS-native, backwards-compatible option; it is still an infra change to a working system and therefore Steve's call, snapshot and rollback included) |
| **B4** 🔴 **NEW** | **Nothing watches the key the whole product depends on.** Ciphertext without the CMK is unrecoverable — a deleted key, a scheduled deletion, or a key policy edited to exclude the runtime principal destroys every vault permanently, and none of it appears in a diff, a test run or a build. This is exactly the class `verify:roles` and `verify:iam` were built for, one layer down | Compare: two walls have re-measuring probes and this one has none. `docs/backup-restore-runbook.md` covers the *database*; the key is what makes the database mean anything, and a restored cluster is ciphertext without it | A `verify:kms` in the same shape as `verify:iam`: key exists, is `Enabled`, has no pending deletion, rotation state is as intended, and the key policy still names the runtime principal and no one else. Read-only, no mutation, proven to fail on a planted change |
| **B5** ⚠️ **NEW** | **Tenant separation at the KMS boundary is authorization, not cryptography.** `generateDataKey` and `decryptDataKey` pass no `EncryptionContext`, and `DecryptCommand` names no `KeyId`, so any blob wrapped under the CMK unwraps for any caller the *application* lets through. The application-layer hole this permitted was found and closed on 2026-08-13 (the route header tells the story: a body-supplied `wrapped_data_key` was an oracle across tenants). The fix was correct and the structure that allowed it is unchanged | `lib/kms/kms-client.ts`, and the 🔴 header comment in `src/app/api/kms/unwrap/route.ts` which states the property in its own words: *"the KMS Decrypt call names no key and carries no EncryptionContext"* | Bind new wraps to an `EncryptionContext` (owner id, or item id) so a cross-tenant unwrap is refused **by KMS** rather than by a check somebody has to keep writing. Portfolio rule: structural safety over convention. ⚠️ **Compatibility is the whole risk**: every blob wrapped before the change has no context and must keep decrypting forever — the same permanent-legacy rule `lib/crypto/secret-payload.ts` already lives under. Design it that way or do not start it |
| **B6** ⚠️ **NEW** | **The in-app alarm shares fate with the thing most likely to be broken.** `lib/ops/error-reporter.ts` and `lib/ops/incident.ts` alert through `sendEmailBestEffort` — Resend, the same provider whose Outlook deliverability is an open ticket (B-C2 below) and whose DMARC posture is still `p=none`. If Resend is degraded, or the alert lands in a junk folder, the 500s stop being reported and the silence reads as health | The import in `error-reporter.ts`; `docs/deliverability-options-3-and-5.md` for the state of that channel. The GitHub-hosted monitors do **not** share this fate — they alert through GitHub — so the exposure is specific to the in-app half | A second, independent path for in-app alerts (the monitors' own channel is the cheapest existing one), or an explicit ruling that the GitHub monitors are the alarm of record and the in-app mail is advisory. Either is fine; the current state is neither |
| **B7** ⚠️ **NEW** | **No security-incident or breach-notification runbook.** `docs/` holds a backup/restore runbook, an email-DNS runbook and a submission runbook. For a product holding credentials there is no written answer to: what is done first, what is preserved, who is told, and what state law requires of a custodian who has to tell them | `ls docs/*runbook*` | One page. Containment order (revoke sessions — `session_epoch` already exists for exactly this; rotate; preserve the audit chain), the notification obligation, and the decision of who writes the notice. Cheap now, unwritable at 3am |
| **B8** ⚠️ **NEW** | **No secret rotation runbook and no rotation clock.** `NEXTAUTH_SECRET`, `RECIPIENT_JWT_SECRET`, `VERIFIER_JWT_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, the Stripe keys and a long-lived AWS access key pair all sit in Vercel with no recorded age, no rotation procedure and no owner. Rotating the two JWT secrets invalidates live recipient and verifier links — which is a *procedure*, not a blocker, and the procedure does not exist | `.env.example` is the inventory; nothing in `docs/` rotates anything (the only "rotate" hits are Norton's CA bundle and unrelated prose) | A rotation page per secret: blast radius, the safe order, what breaks mid-flight, and the date each was last set. Then a clock. This is the operational half of the least-privilege arc that `docs/least-privilege-cutover.md` closed on identity |
| **B9** ⚠️ **NEW** | **The privacy page names three of the four companies that receive customer data.** It lists AWS, Vercel, OpenAI and Resend under "Who else is involved" — and omits **Stripe**, which processes the payment details of every paying customer. Live-mode Stripe has been charging since 2026-08-08 | `src/app/privacy/page.tsx`; `PROJECT.yaml → monetization_path` | One line in the list. Trivial to fix, and it is a factual defect on a page whose entire value is that it is accurate — the same class as the `og:description` that still sold estate after estate was withdrawn |

### C. Trust, identity and communications (unblocked; small; mixed court)

| # | Item | Source of record |
|---|---|---|
| C1 | DMARC report rescue: Gmail filter + untrash before the ~2026-09-10 trash purge — 2 minutes, hard expiry | `docs/deliverability-options-3-and-5.md` §"A deadline nobody set" |
| C2 | Outlook sender-support submission — Resend ticket, then the Microsoft form; the doc is ready-to-send and the evidence must not be touched | `docs/outlook-sender-support-submission.md` |
| C3 | DMARC posture step-up (`p=none`→`quarantine`, `~all`→`-all`) — only after reports accumulate post-C1 | same doc, recommendation 3 |
| C4 | SMS / A2P 10DLC: **parked** 2026-08-15; the route is settled as Sole Proprietor by the operator ruling (⚠️ the A2P doc's "Standard, LLC" line predates that ruling and is stale). 2–4 week lead time — resume when a concrete need exists (Sprint 6), not before | `docs/a2p-registration-prep.md`; `PROJECT.yaml → ratified.relay-operator-is-an-individual.consequences.sms_10dlc` |
| C5 | Stripe merchant name (shared personal account header): re-decide **only if** a real customer remarks | `ratified.relay-operator-is-an-individual.consequences.stripe` |
| C6 **NEW** | **Support has an address and no commitment.** `hello@relaystandby.com` is offered on the acute paths — the access screen tells a recipient whose reveal failed to write in "so a person can look" — with no stated response time and no defined monitoring. A promise of a human, made to someone in an emergency, is either kept or it should not be on that screen | `src/app/(access)/access/AccessClient.tsx`, `src/app/(owner)/challenge/ChallengeClient.tsx`; `/api/support` |
| C7 **NEW** | **Relay's own continuity is unstated.** The product's entire subject is what happens when the person holding everything cannot act. Relay is operated by one individual (`ratified.relay-operator-is-an-individual`) and says nothing about what becomes of a customer's vault if that individual is the one who stops. The *mechanism* exists — self-serve export, step-up guarded, and the encryption means the operator was never able to read anything — so this is a **statement to write, not a system to build**, and it is the single most on-brand piece of trust copy available | `src/app/api/account/export`; `/about`, `/terms` |

Closed, for orientation (the 2026-08-16 readiness assessment's blockers): the operator question is
**ruled** — Steve personally, no entity — and implemented on `/about`, `/terms`, `/privacy`; the
press kit exists (`lib/g1/press-kit.ts`, test-pinned); the H0 badge is reframed
(`ratified.h0-badge-reframed`). The `security-remediation-plan.md` §B jose migration is **shipped**
(`recipient-token.ts` and `verifier-token.ts` both import `jose`) — its inventory table still reads
"designed", which is a stale row in a doc whose header records the execution.

### D. Operational hardening (protecting the live product; largely Claude)

| # | Item | Source of record |
|---|---|---|
| D1 | `verify:live` cadence: the freshness dead-man fires 14 days after the newest stamp — currently ~2026-09-02. Firing is the design working; the response is to run the chain (or record a pause with a raised threshold) | `lib/ops/verify-live-freshness.ts`; CLAUDE.md |
| D2 | `verify:orphans` after every walk day / interrupted fixture run | CLAUDE.md |
| D3 | Restore **drill**: a restore has run once (2026-08-08, timed); no recurring drill exists. Schedule quarterly restore-to-new-cluster with data verification. ⚠️ **Fold B4 into the drill's success criteria** — a restored cluster is ciphertext, and a drill that never unwraps an item has not proven a recovery | `docs/backup-restore-runbook.md` |
| D4 | Separate test cluster so `verify:live` could enter CI: **open, Steve's call, cost attached.** Two symptoms now mitigated (orphan count, dead-man); the cause is not. Recommend: defer until the first paying customer, then re-argue under the 5-gate infra policy | `PROJECT.yaml → deferred → verify-live-cannot-enter-ci` (incl. `partially_mitigated`) |
| D5 | Quarterly re-verification clocks: competitor prices (60-day clock from 2026-08-18); outlet routes re-checked before any send (they moved twice in three days) | `docs/COMPETITORS.md`; `docs/g1-outlet-dossier.md` |
| D6 **NEW** | **The rate limiter's upgrade trigger died with the channel that wrote it.** `lib/http/rate-limit.ts` is per-instance memory and says so; its stated argument for staying that way is that a shared store is not worth adding "for a $250 ad test", and that flight was cancelled (`ratified.g1-google-lane-cancelled`). The reasoning needs re-deriving against the world that exists: real users, free standby accounts, and public endpoints that cost money (`/api/ai/intake` reaches OpenAI, `/api/stripe/checkout` reaches Stripe) | `lib/http/rate-limit.ts` header vs `ratified.retire-paid-advertising` |
| D7 **NEW** | **Unit economics are unmodelled.** Nothing anywhere derives the per-owner cost of DSQL, KMS requests, Vercel functions, OpenAI intake and Resend against the $119/yr price. At current scale it does not matter; it is the arithmetic that decides whether the *next* two sprints of demand work are selling something with a margin | no source of record — that is the finding |

### E. Billing and subscription lifecycle — **NEW section**

Checkout works, the webhook reconciles, cancellation is self-serve, and `past_due` is deliberately
inside `ACTIVE_STATUSES` so a card that fails on renewal does **not** revoke access during Stripe's
retry window. That is correct and better than this pass expected. What is missing is everything
that happens *around* a renewal. As with §2-B, **each item is an entry in `PROJECT.yaml → deferred`**
carrying its short code on its `id:`.

| # | Item | Evidence | Why it is not "retention work" |
|---|---|---|---|
| E1 **NEW** | **A failed renewal tells the owner nothing.** `invoice.payment_failed` is not a handled event; the webhook handles `checkout.session.completed` and `customer.subscription.updated/deleted`. When a subscription finally lapses, the handler writes an audit entry and sends no mail | `src/app/api/stripe/webhook/route.ts` | The paywall flag is a dated decision away from flipping (`ratified.beta-free-release`, revisit 2026-10-01). The moment `TIER_LIMITS.free.canRelease` becomes `false`, **an expired card is a blocked release** — the one thing the product exists to do, stopped by a billing event nobody was told about |
| E2 **NEW** | **The post-lapse state is undefined.** A lapsed owner drops to the free tier holding a vault that may exceed the free item cap. `assertCanAddItems` gates *adding* only, so existing items are untouched — which is the humane behaviour and it is an emergent property of where the check sits, not a decision anybody made or wrote down | `lib/billing/entitlements.ts` | A custodian must be able to answer "what happens to my data if I stop paying" in one sentence, and the Terms cannot answer it because nothing has decided it |
| E3 | Renewal receipt + owner-reminder ladder before a heartbeat transition (needed before the **first real renewal**) | `docs/user-journeys.md` J5 | Carried from §F-d below; E1/E2 are its billing-side half and are due earlier |

### F. Product work already identified — **gated on demand evidence**

All of this is known, scoped, and deliberately unbuilt. Building it before a gate produces evidence
is the horizontal-build pattern the rules exist to stop. Unchanged from the first pass.

| # | Item | Unlocks when | Source of record |
|---|---|---|---|
| F-a | D2 — remaining requirable factors (sms, email, passkey, hardware_key, security_questions). **HELD**: resumes on a *number* (owners observed answering the first question), not a date | first real declaration answers | `PROJECT.yaml → deferred → D2.held` |
| F-b | Field-level vault-item editing (single-item ciphertext endpoint + its step-up decision, made in the same change) | first real owner maintains a vault over time | `ratified.no-single-item-ciphertext-endpoint-yet` |
| F-c | J8 completion slice: single-next-action card, ephemeral reveal, shared progress | a real recipient's observed need | `docs/user-journeys.md` "genuinely open" |
| F-d | J5 retention: renewal receipt + owner-reminder ladder before a heartbeat transition; quarterly review + life-event prompts stay behind demand | first arms-length subscription approaching renewal | same |
| F-e | J2: by-exception review screen, top-three framing, continuity-ready state, document + email ingestion lanes | demand evidence | same |
| F-f | J3: monthly delegate digest | demand evidence | same |
| F-g | Secret-types Phase 2: QR scanning; AI inference of `factors_required` (advisory, owner-override) | D2 evidence + demand | `docs/secret-types-design.md` §Phase 2 |
| F-h | Standby Sprint F / Phase 4: Standby Card, [A5] owner one-page plan, wallet pass, circle visibility (default off), SMS channel, re-confirm cadence | **post-G1 by ratified plan** | `docs/standby-sprint-plan.md` §Sprint F; `docs/standby-architecture.md` §6 |
| F-i | KYC at claim — vendor needed (Persona/Onfido/Stripe Identity class) | a partner's diligence or a real user demands it | `docs/user-journeys.md` [P2]; Build Spec §18 |
| F-j | Beta paywall ON: `TIER_LIMITS.free.canRelease` flip + un-skip the entitlements test + user-guide §2.7 — three artifacts that must move together (guarded). ⚠️ **E1 and E2 are now preconditions**, not niceties: flipping this without a renewal-failure notice converts an expired card into a blocked release | `ratified.beta-free-release` revisit (2026-10-01); `lib/ops/gates.test.ts` |

### G. Commercial hardening — the Build Spec Phase 2 planks that survive the narrowing

Build Spec §17–27 was written pre-win and pre-narrowing. Reconciled against ratified decisions:

**Survives, sequenced into sprints 6–7:** B2B2C/white-label tenancy (§22) — *only against a signed
pilot*; identity verification at claim (§18, narrowed to KYC — F-i); third-party security audit +
pen test + NextAuth session-hardening review (§20; `docs/security-remediation-plan.md` scopes these
to "G5, once G4 exists"); zero-knowledge productionization — threshold crypto, HSM-backed custody,
recovery quorums (§20, post-G3 scale work); mobile (§23); provider handoff integrations and
ingestion tiers 2–4 (§21) by partner pull; per-jurisdiction residency (§22) by partner pull.

**Also here, and previously unplaced:** the **entity and insurance re-decision**. The operator
ruling (`ratified.relay-operator-is-an-individual`) is right for today and its own consequences
list is written for a pre-revenue product. Arms-length money, or a partner's diligence, is the
trigger to re-ask it alongside E&O/cyber cover — the same "funded from the opportunity, not ahead
of it" logic that declined counsel. Recorded here so the trigger has a home.

**Superseded — do not resurrect from the spec** (see §6): everything estate — death verification,
the estate activation fee, RON-for-estate, "highest-WTP estate moment" (withdrawn with J10;
`gates.g2-counsel-opinion.declined`); paid advertising and the Google lane
(`ratified.retire-paid-advertising`, `ratified.g1-google-lane-cancelled`).

---

## 3. The sprints

Effort labels: **S** ≤ a day · **M** ≤ a week · **L** longer. Court: who must act.

**Sprints 1 and 2 run concurrently** — different courts, no shared resource. Sprint 3 follows both.
Sprints 4–7 are event-anchored and open only on their entry condition.

### Sprint 1 — Into an editor's inbox *(calendar: now → 2026-09-01 · Steve's court)*

The single highest-impact block of work in the project. Everything in it is already unblocked, and
nothing in any later sprint matters commercially if this one stalls: the gate that defines
production waits on a stranger, and this sprint is every path a stranger could arrive by.

| # | Work | Court | Effort |
|---|---|---|---|
| 1.1 | Voice pass on the op-ed + cover email (planned 2026-08-19; AARP's AI-pitch blacklist is why neither can be delegated) | **Steve** | S |
| 1.2 | Produce the Word document from the final text — derived, not retyped — with the row-7a contact block read from `.relay-submitter.json` (gitignored; the values never enter the repo) | Claude | S |
| 1.3 | Send to nancy@caregiver.com per the send checklist | **Steve** | S |
| 1.4 | Beta cohort ruling at the 2026-08-23 revisit: run `invite:cohort` dry-run → `--commit`, or re-defer with a record. The staged `.relay-cohort.json` must not sit in the third state. ⚠️ **Gated on Sprint 2.1** — see the entry note below | **Steve** (Claude co-pilots) | S |
| 1.5 | G3 ruling by 2026-09-01 (mechanically enforced): ratify/amend/decline; name two organisations; rule on A5 (wealth-manager category) | **Steve** | S |
| 1.6 | First partner-outreach drafts for the named orgs — Steve sends; NAC's named contact is the cheap parallel probe (ask about fees and startup eligibility in the first email) | Claude drafts, **Steve** sends | S |
| 1.7 | DMARC rescue (C1) — before ~2026-09-10, hard expiry | **Steve** | S |
| 1.8 | Outlook sender-support submission (C2) — Resend ticket, then the form | **Steve** | S |

> ⚠️ **The one new dependency in this sprint.** 1.4 is the act that creates accounts held by people
> who are not Steve. B1/B2 — an unbudgeted, unwatched front door — should be closed **before** those
> accounts exist, and Sprint 2.1 is scoped at under a day precisely so it cannot become a reason to
> defer the cohort a third time. If the cohort would otherwise slip, run it: five known people on
> known addresses is a bounded exposure, and Steve can make that trade knowingly. What is not
> acceptable is making it unknowingly, which is the state before this document.

**Exit:** the piece is in an editor's inbox; the cohort is running or explicitly re-deferred; G3 is
ruled; both deliverability actions filed. **Explicit non-goal:** any feature work.

### Sprint 2 — The front door, the key, and the alarm *(calendar: now → 2026-09-01 · Claude's court, concurrent with Sprint 1)*

Everything the custodial standard in §1 obliges and no more. Each item is small; the sprint is here
because the *set* of them is what makes the beta cohort a responsible act rather than a hopeful one.
Ordered so that the two items gating Sprint 1.4 come first.

| # | Work | Court | Effort |
|---|---|---|---|
| 2.1 | **B1 + B2 together** — a per-account attempt budget on the `email-totp` provider in the shape `recipient-code.ts` already uses, a `rateLimit` call in the shape `/api/account/step-up` already makes, and a `totp` kind in `guess-watch` so a keyspace walk is *seen*. A limiter without the alarm hides the attack it deflects, which is why they are one change. Prove it fails on a plant, as this repo requires of every guard | Claude | S |
| 2.2 | **B4** — `npm run verify:kms`: the key exists, is enabled, has no pending deletion, its rotation state is what was intended, and its policy names the runtime principal and nobody else. Read-only, both the shape and the standard set by `verify:iam`. Wire it into the pre-release list beside `verify:roles` | Claude | S |
| 2.3 | **B3** — write the single-region-crypto limitation down where a person doing a failover will meet it (the backup runbook and `CLAUDE.md`'s failover invariant, which currently reads as though the env switch is sufficient). The *fix* (a multi-Region CMK) is an infrastructure change and is proposed to Steve with a snapshot and rollback, not taken | Claude writes, **Steve** rules on the change | S |
| 2.4 | **B6** — give the in-app alerter a path that does not share fate with product email, or rule that the GitHub monitors are the alarm of record and say so in `error-reporter.ts` | Claude proposes, **Steve** picks | S |
| 2.5 | **B9** — Stripe joins the subprocessor list on `/privacy`. Pin it the way `operator-named.test.ts` pins the operator, so the next omission fails a test rather than waiting for a reader | Claude | S |
| 2.6 | **B7** — the incident and breach-notification runbook, one page: containment order (session-epoch revocation first — the mechanism already exists), evidence preservation, who is told and by when | Claude drafts, **Steve** owns | S |
| 2.7 | **C7** — the operator-continuity statement on `/about` (what happens to a vault if the operator stops; the export that already exists; the fact that the operator was never able to read anything). The most on-brand trust copy available and it costs an afternoon | Claude drafts, **Steve** approves | S |
| 2.8 | **B8** — the rotation runbook: per secret, blast radius, safe order, what breaks mid-flight, last-set date. ⚠️ Rotating the recipient/verifier JWT secrets invalidates live links — the procedure has to say that before anyone reaches for it | Claude | M |
| 2.9 | **B5** — design note only, decision recorded: bind wraps to an `EncryptionContext`, with the permanent-legacy compatibility rule written first (old blobs must decrypt forever, exactly as legacy secret payloads must decode forever). **Do not implement inside this sprint** — it touches the one path where a mistake is unrecoverable, and it deserves its own change with its own live proof | Claude scopes, **Steve** sequences | S (design) / M (build, later) |

**Exit:** the front door is budgeted and watched; the key is watched; the alarm has a path of its
own; every claim on the legal pages is true; and the three things a custodian must be able to say
in one sentence (what we do if we are breached, what happens if the operator stops, how a secret is
rotated) are written down. **Explicit non-goal:** anything in §2-F. **Explicit non-goal:** the
multi-Region key, the shared-state rate limiter, and the EncryptionContext build — all three are
proposals out of this sprint, not work inside it.

### Sprint 3 — Hold the bar while the mail is out *(calendar: ~2026-09-01 → 2026-10-01)*

Editorial responses take 2–6 weeks. This sprint keeps the product's evidence fresh and closes the
operational decisions that need no demand signal — without inventing work to fill the wait.

| # | Work | Court | Effort |
|---|---|---|---|
| 3.1 | `verify:live` before ~2026-09-02 (dead-man) and at every release thereafter; `verify:orphans` after each walk day | Claude (needs `.env.local` machine) | S |
| 3.2 | D4 ruling: recommend **defer to first paying customer**, recorded on the deferred item — not silence | **Steve** | S |
| 3.3 | Quarterly restore drill (D3) scheduled, and the first one run — **including an unwrap**, so what is proven is a recovery and not a cluster | Claude, Steve approves the restore | M |
| 3.4 | caregiver.com follow-up if silent ~2 weeks; then The Caregiver Space submission (the finished piece adapted to their guidelines — *"we do not publish marketing fluff"* is their stated bar) | **Steve** (Claude adapts text) | S–M |
| 3.5 | Partner meetings from 1.6 — log each against G3's leading indicator | **Steve** | — |
| 3.6 | Phase 0 reads as claims occur (`phase0-report`); if the cohort shows claim-conversion problems, that is *evidence work* and in bounds to fix | Claude | S |
| 3.7 | **E1 + E2 before the 10-01 paywall revisit, not after it.** A renewal-failure notice to the owner, and a written answer to "what happens to my vault if I stop paying" that the Terms can carry. These are what make F-j a safe flip rather than a release-blocking one | Claude builds E1, **Steve** rules E2 | M |
| 3.8 | The 2026-10-01 revisits, on time: `beta-free-release` (paywall decision — F-j's three artifacts move together if flipped, with 3.7 done first) and the `g1-arms-length-demand` revisit cadence | **Steve** | S |
| 3.9 | C3 DMARC posture step-up, only after C1 reports accumulate | Claude proposes, **Steve** applies DNS | S |
| 3.10 | **D7** — one page of unit economics: per-owner DSQL, KMS, function, OpenAI and Resend cost against $119/yr, with the assumption set named. It is arithmetic, and it is what tells the demand lane whether it is selling something with a margin | Claude | S |
| 3.11 | **C6** — decide the support commitment (a response time, and who watches the inbox), then make the acute-path copy match it | **Steve** decides, Claude implements | S |
| 3.12 | **D6** — re-derive the rate limiter's stance now the flight that justified it is cancelled. A shared store is infrastructure and therefore a proposal; the *decision* is what is owed here | Claude proposes, **Steve** rules | S |

**Exit:** every dated obligation through 10-01 dispatched on its date; at least one partner meeting
taken or every named route exhausted and recorded; the paywall decision is takeable without it
being a release hazard. **Explicit non-goal:** SMS registration (nothing needs it yet), feature
work, test-cluster build.

### Sprint 4 — The placement *(event: an outlet accepts)*

Short, sharp, and entirely about not fumbling the measurement the whole demand lane exists for.

| # | Work | Court | Effort |
|---|---|---|---|
| 4.1 | Ratify the editorial thresholds **in the same commit** that moves the `ed-*` slug from `PLANNED_EDITORIAL_SRCS` into `GATE_LANES` — the ordering is guarded; the alternative (counting without thresholds) requires a recorded decision | **Steve** ratifies, Claude commits | S |
| 4.2 | Publication day: `verify:funnel` + `flight:snapshot`; confirm the byline link carries the placement's own src | Claude | S |
| 4.3 | Flight-log entries per the log's own rules; no-read floor below N=50 — a placement driving <10 qualified visits is a *distribution* finding, not a demand finding | Claude | S |
| 4.4 | Any G1 date consequence handled by a `moved:` block, never silently | **Steve** | S |

### Sprint 5 — The first stranger *(event: an arms-length person appears — via editorial, cohort, or a partner intro)*

This is the `customer-used` promotion, and the first sprint where **building resumes** — pulled by
an observed person, one thinnest slice at a time.

| # | Work | Court | Effort |
|---|---|---|---|
| 5.1 | Support the person directly; record `demand_signal` with evidence in PROJECT.yaml; promote `ladder` to `customer-used` only on the gate's own definition of counting | **Steve** + Claude | S |
| 5.2 | D3 evidence read: are owners answering the declaration prompt? → unlock **or re-hold** F-a (its `resumes_when` is a number) | Claude | S |
| 5.3 | Field-level item editing (F-b) the first time a real owner needs to add a factor without retyping a password — the `/api/kms/unwrap` step-up decision lands in the same change, per the ratified entry | Claude | M |
| 5.4 | J8 slice (F-c) — only the piece a real recipient's experience shows is missing | Claude | M |
| 5.5 | Renewal-path pieces of J5 (F-d/E3) before the first real renewal date: renewal receipt, pre-heartbeat reminder ladder — on top of E1's failure notice, which shipped in Sprint 3 | Claude | M |
| 5.6 | Paywall decision if still open (F-j) — a paying stranger is what the flag was waiting for | **Steve** | S |
| 5.7 | **B5 build**, if it was sequenced: the EncryptionContext change, with legacy blobs proven to decrypt in the same walk. A real vault existing is the reason to do it and also the reason to be careful | Claude | M |

**Entry:** `g1-arms-length-demand` met, or a named person actively converting. **Not** a calendar
date. **Exit:** `demand_signal` ≠ none in PROJECT.yaml, with evidence.

### Sprint 6 — Distribution *(event: a G3 meeting advances toward a pilot)*

| # | Work | Court | Effort |
|---|---|---|---|
| 6.1 | Partner-diligence pack: security posture (audit-log chain, least-privilege walls, backup/restore evidence, the `verify:*` suite as demonstrable controls — **now including `verify:kms`, which is the question a partner asks second**), operator disclosure, and prepared answers to counsel questions Q1/Q3/Q11 — this conversation is `g2-counsel-opinion`'s own `revisit` trigger (a): **counsel gets funded from the opportunity, not ahead of it** | Claude prepares, **Steve** presents | M |
| 6.2 | Sprint F artifacts as partner-facing collateral (F-h): Standby Card, [A5] one-page plan, wallet pass, circle visibility (default off), re-confirm cadence — their post-G1 gate is satisfied by this sprint's entry condition | Claude | L |
| 6.3 | SMS: resume A2P registration (C4, Sole-Proprietor route) the moment a partner or the escalation channel needs it — the 2–4 week clock is the reason this is here and not later | **Steve** (~45 min) + Claude (~1 day post-approval) | M |
| 6.4 | KYC-at-claim vendor selection (F-i) if diligence demands it | **Steve** decision, Claude integration | L |
| 6.5 | B2B2C tenancy scoping (Build Spec §22) **only against a signed pilot's actual requirements** — explicitly not speculative | Claude | L |
| 6.6 | **Entity + insurance re-decision** (§2-G) — a partner's paper is the trigger the operator ruling's consequences list was waiting for | **Steve** | M |

### Sprint 7 — Revenue-proven and the GA bar *(event: arms-length money moves / G1 passes)*

Per the corrected gate chain, G4 and G5 enter `PROJECT.yaml` as gates when G1 passes; this sprint
is their execution shell.

| # | Work | Court | Effort |
|---|---|---|---|
| 7.1 | **G4 — billing MVP as a gate**: paywall enforced for arms-length signups; entitlements live end to end; the lapse path (E1/E2) proven with a real card, not reasoned about; ladder → `revenue-proven` on the gate's evidence | **Steve** ratifies gate, Claude ships | M |
| 7.2 | **G5 — audited crypto as a gate**: third-party security audit + penetration test; NextAuth session-hardening review folded into the audit scope (per the security plan's out-of-scope ledger). ⚠️ Sprint 2's items are the ones an auditor finds in the first hour; closing them early is what makes this audit about design rather than about hygiene | **Steve** engages, Claude remediates | L |
| 7.3 | Zero-knowledge productionization scoped from Build Spec §20 (threshold crypto, HSM custody, recovery quorums) — post-G3 scale work by its own plan. B3 (multi-Region key) and B5 (EncryptionContext) are its first two rungs and should be closed before, not inside, it | Claude scopes, **Steve** sequences | L |
| 7.4 | D4 re-ruling at first paying customer: a test cluster now protects real customer data from the walks — re-argue under the 5-gate infra policy with that documented problem | **Steve** | M |
| 7.5 | Remaining §21–23 planks (mobile, ingestion tiers, residency, editions) strictly by partner/customer pull, each entering PROJECT.yaml with its own gate | both | L |

---

## 4. Dated obligations calendar — a rendering, PROJECT.yaml wins

| Date | Obligation | Owning record |
|---|---|---|
| 2026-08-19 | Voice pass + cover email (planned) | `docs/oped-angle-3-draft.md` checklist rows 1–2 |
| 2026-08-23 | Beta cohort ruling | `ratified.beta-cohort-deferred-four-days.revisit` |
| ~2026-09-02 | `verify:live` freshness dead-man fires unless the chain runs | `lib/ops/verify-live-freshness.ts` (14d from newest stamp) |
| 2026-09-01 | G3 ratify-by (suite goes red if unratified); G1 revisit cadence begins | `gates.g3.ratify_by`; `gates.g1-caregiver-wtp.revisit` |
| ~2026-09-10 | DMARC reports purged from Gmail trash — evidence destroyed | `docs/deliverability-options-3-and-5.md` |
| 2026-10-01 | `beta-free-release` revisit (paywall); `g1-arms-length-demand` revisit cadence begins. **E1/E2 due before this**, per Sprint 3.7 | both in PROJECT.yaml |
| 2026-11-30 | Editorial-thresholds deferral revisit; G3 due (kill measured on **meetings**) | `ratified.g1-editorial-thresholds-deferred`; `gates.g3.due` |
| 2026-12-31 | **G1 due: one arms-length person, or park D2C / B2B2C-only / archive** | `gates.g1-arms-length-demand` |

## 5. Standing cadence (not sprint work)

`verify:live` at every release and within every 14 days · `verify:orphans` after walk days ·
`verify:schema` after any migration and before any release · `verify:roles` + `verify:iam`
(+ `verify:kms` once it exists) before a release that touches identity or keys ·
`flight:snapshot` daily only while a measurement window is open · restore drill quarterly,
including an unwrap (first: Sprint 3) · competitor prices and outlet routes re-verified on their own
clocks (§2-D5) · every `revisit:` date in PROJECT.yaml surfaced at `/daily-priority`.

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
- **Feature work ahead of demand evidence** — the entire §2-F list stays behind its named unlocks.
  ⚠️ §2-B is **not** an exception to this rule; it is a different category, and §1 gives the test.
- **J9 steps 5–7** (`ratified.j9-5-7-dropped`) and **`POST /api/ai/prioritize`**
  (`docs/retired-surface.md`) — decided, not deferred.
- **Test-cluster build before its D4 ruling**, the **multi-Region CMK** before B3's ruling, and the
  **shared-state rate limiter** before D6's ruling — three infrastructure changes to a working
  system, each of which needs the 5-gate policy and Steve's explicit request, not a roadmap entry
  as authorisation.
- **A second demand instrument before the first one reads** — the thresholds deferral already
  guards the counting side; the same restraint applies to building new funnels.

## 7. How to keep this document honest

This file deliberately restates no number a test could catch drifting — everything checkable lives
in `PROJECT.yaml`, which the suite reads. When a sprint closes, strike its items with a date and a
commit, in place. When a gate outcome changes the plan, the change is made **here and in
PROJECT.yaml in the same commit**, and if the two ever disagree, PROJECT.yaml is right and this
file has a defect. A sprint that starts before its entry event is not ahead of schedule; it is the
horizontal-build failure this roadmap exists to prevent.

✅ **The weakness this section recorded against itself is closed (2026-08-20).** It read: *"The §2-B
and §2-E findings are in this file and nowhere else, which is a known weakness of this revision…
Each finding should be entered there with an owner and an `ends_when` as it is ruled on."* All
fifteen are now entries in `PROJECT.yaml → deferred`, each with an owner, an `ends_when` that is a
condition rather than a date, and its short code on its `id:`. Two of them — `B1` and `B2` — went in
already closed, because the change that closed them landed first in the same sprint.

The paragraph is kept rather than deleted because it is the reasoning that produced the fix, and
because the rule it states still binds everything added here later: **a finding recorded only in
this file is one session away from being lost.** New work goes into `PROJECT.yaml` as it is ruled
on, and is struck from here when it closes there.
