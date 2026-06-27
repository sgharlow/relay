# Relay — Devpost Submission Pack

Copy each block into the matching Devpost field. Track: **Monetizable B2C** (locked — the build spec's "Track 1 — Monetizable B2C" is the same track). AWS Database: **Amazon Aurora DSQL**.

---

## Tagline (one line)
Standby access for the people who'll need it — set up who can reach what, and Relay hands it over the moment you can't.

---

## Inspiration
When someone is suddenly in surgery, traveling and unreachable, or gone, the people who depend on them hit a wall: they can't get into the bank, the insurance portal, the kids' school account, or the family documents — and the platforms each have their own slow, fragmented process. Existing tools are built around death, so people avoid them and never finish setup. We flipped it: Relay is about *living* continuity — emergencies, travel, caregiving, business continuity — with estate handoff as the final case of the same mechanism. That reframing is also what makes it something people actually use.

## What it does
Relay lets you build an encrypted vault of accounts, credentials, documents, and instructions, then assign **scoped, reversible access** to the right people under rules you set. When a trigger fires — a missed check-in, a manual emergency request, or a verified estate event — Relay moves through a controlled release process (notify the owner, require N-of-M trusted verifiers, observe a grace window) and only then opens a guided, prioritized access dashboard to the recipient. Emergencies are reversible: when you recover and check in, access closes automatically.

Two things make it more than a vault:
- **An importance engine** turns a bulk import into focus. Import a password-manager export and dozens of accounts populate instantly; Relay ranks them by what matters in a crisis and surfaces the few that count — including the risk-graph insight that your primary email is the key that unlocks most password resets.
- **A release that's correct under pressure.** The irreversible handoff is modeled so it can never double-release, even when the owner, the verifiers, and the scheduler all act at once.

## How we built it
- **Frontend:** a **Next.js** (App Router, TypeScript) app deployed on **Vercel**; route handlers are the API tier.
- **Database:** **Amazon Aurora DSQL**, multi-region active-active, as the system of record for vault metadata, ciphertext, access rules, recipients, verifiers, the release state, and an append-only audit log.
- **Encryption:** client-side envelope encryption with **AWS KMS** — items are encrypted in the browser and only ciphertext plus non-secret metadata are ever uploaded.
- **Release subsystem:** a state machine (ARMED → PENDING → GRACE → RELEASED) whose every transition is a **compare-and-set validated by Aurora DSQL's optimistic concurrency control**; conflicting commits surface as serialization failures and retry or safely abort.
- **Importance engine:** serverless functions running heuristics + an LLM over **non-secret metadata only** (category, root-credential and recurring-billing flags, dependency edges) — so the smartest part of the product never sees a secret and never breaks zero-knowledge.
- **Scheduler:** evaluates check-in heartbeats and advances the release state.

## Which AWS Database — and why Aurora DSQL
We used **Amazon Aurora DSQL**, and the choice is the architecture, not a detail:
1. **Availability at an unpredictable moment.** A release can happen any day — possibly during a regional disruption. Aurora DSQL's active-active, multi-region design keeps the recipient's access path live even if a region goes down. We demonstrate this with a live failover.
2. **Strong consistency for an irreversible action.** Releasing a vault is one-way; a stale read of release state or recipient scope is unacceptable. Aurora DSQL's strong consistency across regional endpoints is the right guarantee.
3. **Optimistic concurrency that fits the workload.** A personal continuity vault is intrinsically low-contention — one owner, rare release events — which is exactly where OCC shines, so we model the release as a conflict-checked compare-and-set.
4. **PostgreSQL compatibility with deliberate adaptation.** Aurora DSQL doesn't enforce foreign keys, so we enforce referential integrity in application logic — a deliberate design choice, surfaced in our data model.

## Challenges we ran into
- Modeling an irreversible release safely under optimistic concurrency, so concurrent actors can never produce a double-release.
- Enforcing referential integrity without foreign keys, including orphan and cascade paths.
- Keeping the importance engine genuinely useful while restricting it to non-secret metadata, so it never compromises the encryption boundary.
- Making a single mechanism serve everything from a reversible emergency to a permanent estate handoff.

## Accomplishments we're proud of
- A release path that is provably safe under concurrency and survives a live region failover.
- An importance engine that converts a noisy import into a short, prioritized, dependency-aware list — and a recipient experience that's a triaged plan, not a scavenger hunt.
- A zero-knowledge-compatible design where the database holds only ciphertext and non-secret metadata.

## What we learned
- Aurora DSQL's optimistic-concurrency model maps cleanly onto exactly-once, irreversible state transitions when you treat them as compare-and-set with retry.
- Designing for "no foreign keys" pushes integrity into the application in ways that are healthy for a distributed system.
- The hardest, most valuable problem in this space isn't storage — it's verified, reversible release.

## Business model — Monetizable B2C
Relay is a consumer subscription product with a clear path to scale.

- **Who pays, and why now.** The wedge is the **caregiver** — an adult child managing an aging parent's accounts feels acute, present pain (they're already doing it manually and badly), and the relationship expands naturally into the estate handoff later. Adjacent consumer segments: frequent travelers, new parents, and small-business owners who need bus-factor continuity.
- **Pricing (B2C).** A free tier (a small vault + one emergency recipient) converts to a **paid annual subscription** for the full living vault — unlimited items, multiple recipients and verifiers, N-of-M release, and active-active availability. A one-time **activation fee at the moment of need** (an emergency or estate release) is easy to justify exactly when it matters most.
- **How the B2C on-ramp compounds.** Direct-to-consumer is the proof and the on-ramp; the durable distribution is **embedded "powered by Relay" continuity** offered through institutions people already trust — banks, employer benefits, wealth managers, insurers — which collapses both the trust barrier and customer-acquisition cost. Same product, two revenue surfaces: consumer subscriptions + partner licensing.
- **Why it's defensible.** Platform-native tools (Apple Legacy Contact, 1Password emergency kit) are single-ecosystem, all-or-nothing, and unverified. Relay's moat is the cross-platform, **verified, reversible, graduated** release layer — human N-of-M verification on a strongly-consistent ledger — which a password manager is neither positioned to build well nor motivated to prioritize.

## What's next for Relay
A graduated-assurance verification engine (identity verification, death/incapacity signals, notarization), productionized zero-knowledge via threshold secret-sharing, per-jurisdiction data residency on Aurora DSQL's multi-region foundation, and distribution as **embedded continuity infrastructure** that banks, employers, and wealth managers offer their clients — beginning with the caregiver wedge.

## Built With
`amazon-aurora-dsql` · `aws-kms` · `vercel` · `next.js` · `typescript` · `node-postgres` · `next-auth` · `openai` · `resend` · `fast-check` · `serverless`

---

## Required submission components (H0 checklist)
- [x] **Text description** — paste the blocks above; state **Amazon Aurora DSQL** as the database used.
- [x] **Live app deployed** — <https://relay-three-henna.vercel.app> (Aurora DSQL, multi-region active-active; dogfooded live end-to-end 2026-06-27).
- [ ] **Demo video (< 3 min, YouTube)** — script below; must explain the problem, who it's for, why, show the working app, include the live failover, and explain the AWS Database.
- [ ] **Published Vercel project link + Vercel Team ID** — Team ID `team_nP3HzRc3PNm6SaWiApTGkEWa`.
- [x] **Architecture diagram** — upload `specs/relay_architecture.png` (PNG; `.svg` source also present).
- [ ] **Screenshot proving AWS Database usage** — Aurora DSQL clusters in the AWS console (primary `frt34b…` us-east-1 / secondary `fjt34b…` us-west-2, Peers tab) and/or Vercel storage configuration.
- [ ] **Bonus content** — a build post on builder.aws.com / dev.to / LinkedIn / Medium with **#H0Hackathon** and the required "created for this hackathon" statement.

---

## Demo video script (target ~2:00, hard cap 3:00)
> "When someone can't be there — a hospital stay, a trip, or worse — the people who depend on them can't get into the accounts that matter. Relay fixes that.
>
> This is Maria. She sets up Relay in one sitting: she imports her password-manager export and dozens of accounts populate instantly. Relay ranks them by what matters in a crisis and flags the one critical gap — her primary email has no recovery note, and it's the key that unlocks everything else. She fixes it, assigns emergency access to her husband Dave, and names her sister and attorney as verifiers.
>
> Months later, Maria is in surgery. Dave needs the insurance login now. He requests emergency access; Relay notifies Maria, gets no response, and asks the verifiers to confirm. *[real confirmation]* Dave's access opens — only what Maria scoped to him, as a clear step-by-step plan.
>
> Here's the part that matters for a moment no one can schedule: Relay runs active-active on **Amazon Aurora DSQL** across two regions. Watch — I disable the primary region *[real failover]* — Dave's access keeps working from the second region, strongly consistent, no interruption.
>
> And it's reversible: Maria recovers, checks in, and the access closes automatically.
>
> Under the hood, the release is a compare-and-set validated by Aurora DSQL's optimistic concurrency, so it can never double-release, and referential integrity is enforced in app logic because DSQL has no foreign keys.
>
> Relay turns 'what happens when I can't be there' into something you set up in fifteen minutes — for an emergency, a trip, a caregiver, or one day, your estate."
