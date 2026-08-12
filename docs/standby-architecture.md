# Relay standby architecture — the plan (**hybrid+6**)

Status: **proposal, ratified as the direction 2026-08-11.** Supersedes `relay-standby-pivot.md`
(kept for its reasoning and its repo change list, both still valid).

**Version `hybrid+6`** = the standby-account pivot, plus four grafts that close gaps it leaves open
(§1), plus six amendments from the 2026-08-11 QA pass that target the ease-of-use cost (marked
**[A1]**–**[A6]** in place below). Nothing in the amendments relaxes a principle in §2.

This is an architecture plan, not the roadmap. `PROJECT.yaml` remains authoritative for gates and
volatile facts; `specs/Relay_H0_Build_Spec_v2.md` remains the authoritative plan. Numbers from
those files are referenced, never restated.

---

## 1. The recommendation

Stop trying to make credential delivery reliable and **remove the credential from the delivery
path**. Every named person claims a **standby account** in calm, binding their identity to their
own device. At release time nothing secret is transmitted: the person signs into an account they
already have and the dashboard unlocks. Delivery becomes a notification, which is allowed to fail.

Where this plan differs from the pivot it supersedes: the **invitation is also removed from the
email path** (the owner delivers a one-time code through any channel they already use), a
**single-use break-glass** covers the people who never claim, the **delivery webhook is kept** so a
demoted channel is not also an invisible one, and the **challenge-window escalation is built**,
because without it the standby dashboard has nothing to show in the case this product exists for.

---

## 2. Core principles — the things that must not break

These are the invariants. Any future change that violates one is a different product.

1. **No secret is ever transmitted at release time.** The person is already authenticated.
2. **No standing credential is ever printed.** A single-use code that dies on redemption is not a
   standing credential; a permanent one is. This is the line.
3. **Relay never sends a link that signs you in.** Invitations are *codes*, delivered by the owner.
   QR only on physical artifacts. This makes the anti-phishing promise architectural rather than
   aspirational: any link claiming to be Relay is, categorically, not.
4. **The release state machine gains zero new states.** `PERMITTED_TRANSITIONS` stays at seven
   edges (verified 2026-08-11). ARMED remains the safe default; silence never resolves toward open.
5. **Pull before push.** Every participant can do their job by visiting the site. Alerting is
   convenience and is allowed to fail.
6. **Derive on read; do not add a second scheduler.** One scheduler ledger already exists. New
   time-dependent states are computed when someone looks, not swept by a cron.
7. **Plaintext never leaves the browser**, contacts never see vault contents, and every open and
   release lands in the hash-chained audit log. Unchanged, and binding on every new surface.

---

## 3. Architecture

### 3.1 Identity

Three principal types, all real users. `recipients` and `verifiers` remain the owner's roster rows;
each gains a nullable `claimed_user_id` pointing at `users.id`. **The roster row is the
relationship; the user row is the identity.** Binding to a user id rather than an email means a
contact who changes address stays connected with no reconfiguration.

| Principal | Auth | Pays | Sees before release |
|---|---|---|---|
| Owner | passkey or password + TOTP | yes | own vault |
| Recipient (standby) | passkey or bound device | no | that they are on standby and for whom, plus **the shape of the grant — counts and categories** (J4-R10) |
| Verifier (standby) | passkey or bound device | no | pending decisions only, never vault shape |

⚠️ **Corrected 2026-08-11.** This row previously read "**Not** the vault shape," which contradicted
**J4-R10** in `docs/user-journeys.md`: *"The recipient standby view SHALL disclose the shape of the
grant — counts and categories — and SHALL NOT disclose item titles for sensitive categories or any
content."* The journey requirement is the better formulation — it already carves out sensitive
categories, and giving a standby recipient something real to see is what makes **[A6]** work. The
plan yields to it.

### 3.2 Release path

Unchanged: `ARMED → PENDING → GRACE → RELEASED`, CAS-guarded, OCC-retried, safe-reset to ARMED.
What changes is what `RELEASED` *causes*.

- **Today:** mint an 8-character recipient code, email it, recipient redeems it for a JWT scoped to
  `(release_state.id, version)`, dashboard opens at `/access?token=…`.
- **Standby:** flip the row. The already-authenticated session resolves an open release for that
  owner and the dashboard opens. No code minted, nothing secret emailed, no token in the URL bar.

The version check survives — it moves from a JWT claim to a server-side comparison on each request.
A re-arm bumps the version and every open dashboard closes on its next call. Same guarantee,
enforced in a better place.

### 3.3 Invitation and assurance

**The claim ticket is owner-brokered.** Relay generates a one-time code per contact; the owner
delivers it however they like — read aloud on a call, texted, AirDropped, handed over, printed, or
emailed. Email becomes one option among several rather than the only one. The ticket is single-use,
TTL-bounded, and dies on redemption.

Codes must be **voice-safe**, because the guided setup call below is the primary delivery path and
a code that cannot be dictated cleanly breaks it. ✅ **Already satisfied — reuse, do not rebuild:**
`CASE_ID_ALPHABET` (`lib/release/case-id.ts`) is `23456789ABCDEFGHJKLMNPQRSTVWXYZ`, documented
"No I, O, U, 0 or 1 — the characters people mishear or mistype", and already shared by
`recipient-code.ts` and `recovery-code.ts`.

**[A1] Claim is two-stage.** Stage one is *acknowledge and bind this device* — near-instant, no
passkey, no password. Stage two is *add a passkey*, prompted afterwards and deferrable. Anyone who
stops at stage one still holds a bound device and a break-glass code.

> Why: the architecture's whole bet is claim conversion, and the first thing a contact currently
> meets is a security ceremony for a product they do not use. This turns one high-friction gate
> into a low one plus an upgrade — and it makes Phase 0 measurable as a two-step funnel, which is
> what makes the number interpretable at all.

**Assurance is a fingerprint phrase** confirmed out of band: one boolean per person, set by the
owner after comparing a short phrase with the contact. No webhook ledger, no ack state machine, no
scheduled sweep.

**[A2] Delivery and assurance happen in one interaction — the guided setup call.** "Set up Sarah"
shows the code, the phrase, and a script: *call her, read her the code, she'll see a phrase — check
it matches.* She claims during the call; both see the phrase; the owner taps Confirm while still on
the phone. Two async chores collapse into one event.

> ⚠️ **Do not let the contact confirm the phrase alone.** It is the obvious simplification and it
> breaks the property: if a ticket were intercepted, the interceptor sees a phrase too and would
> confirm it, and the owner would go green without ever speaking to the real person. The owner's
> out-of-band act is load-bearing. What is negotiable is *when* it happens, never *whether*.

**[A6] Standby accounts carry a job on day one.** A contact who claims and then experiences nothing
for years will not return, and three-to-five free accounts per owner only become a beachhead if
those people come back. The standby dashboard shows what they would be asked to do, who they stand
by for, current status ("nothing is open"), and **"start your own plan."** That conversion surface
is the mechanism the acquisition argument in `relay-standby-pivot.md` §2 otherwise lacks.

### 3.4 Channels

| Rung | Mechanism | When |
|---|---|---|
| 0 | **The standby dashboard itself** | Always. The contact can look without being told |
| 1 | Email to primary address | Notification only, allowed to fail |
| 2 | Email to secondary address | One nullable column, roughly doubles delivery odds, no vendor |
| 3 | Other circle members | Circle visibility lets humans chase each other |
| 4 | Wallet pass push | Post-G1 |
| 5 | SMS | Post-G1, gated on 10DLC registration |

Rung 0 is the point of the design. Every other rung is convenience.

**Delivery state is still recorded.** Demoting a channel is not a reason to be blind to it: rungs
1–3 are the discovery mechanism for scheduler-originated triggers, and we have measured
(2026-08-11) that Outlook files us in Junk at SCL 5 and that Resend suppression mutes a bounced
recipient permanently while returning 200. A channel allowed to fail must still fail *visibly*.

### 3.5 Artifacts

- **Standby Card**, issued after claim, **no credential on it**: contact name, owner name and
  relationship, role, the domain to type, the `RLY-XXXX-XXXX` case-ID format to expect a caller to
  quote, the fingerprint phrase, and what to do if contacted.
- **Delivery order:** wallet pass (revocable, updatable, survives phone upgrades) → PDF → print.
- **Positioning:** tell owners to keep a copy with their estate-planning documents. The fire safe
  already exists.
- **Never printed:** any standing credential, ever.
- **[A5] The owner's one-page plan.** Per-contact cards exist; an owner-level summary did not. One
  page: who is on standby, in what role, what triggers exist, what happens when one fires, and
  where the cards went. This is the artifact families actually want and do not have, and it is
  demo-able. Same rule as the cards — slow-changing facts only, dashboard canonical for anything
  live, and every printed artifact carries an issue date and points at the site for current status.

### 3.6 Break-glass — the people who never claim

Claim conversion will not be 100%, and a plan that silently excludes the unclaimed is the failure
mode this whole exercise exists to remove.

- A **single-use, self-revoking break-glass code** covers the unclaimed contact and the lost
  authenticator. Using it is a loud, audited event that notifies the owner and invalidates itself.
- It is not a standing credential and therefore does not violate principle 2.
- **Unclaimed contacts do not count toward N.** See §4.3 — this is a correctness requirement, not a
  presentation choice.

---

## 4. State model

### 4.1 Release state: no new states

Two nullable timestamp columns on `release_state`: `notified_at`, `first_access_at`. The three
splits the original brief proposed (`pending_notified`/`pending_acknowledged`,
`grace_owner_notified`/`grace_owner_acknowledged`, `release_offered`/`release_claimed`) are all
cut — nothing behaves differently, an owner who acknowledges during grace is checking in (which
stands the release down), and with no code to redeem "claimed" is a timestamp.

### 4.2 Person state

Replaces the dead `verification_status` column — verified 2026-08-11 as `NOT NULL DEFAULT
'pending'` in migration 001, read with a `?? 'pending'` fallback, and **written by nothing**.

```
invited → claimed → confirmed
             ↓          ↓
          revoked ← ────┘
```

| State | Meaning | Set by |
|---|---|---|
| `invited` | roster row exists, ticket issued | owner adds person |
| `claimed` | standby account bound to `claimed_user_id` | contact completes claim |
| `confirmed` | fingerprint phrase verified out of band | owner presses one button |
| `revoked` | access withdrawn | owner |

`unreachable` is **derived on read** from `invited` plus an elapsed ticket TTL. Not a stored state,
not a scheduled sweep.

Single writer, no concurrency. Do **not** wrap this in `ReleaseStateMachine` or extract a generic
`CasStateMachine<S>`. The release machine exists because three writers race (owner, verifiers,
scheduler). Person state has one. A plain guarded update with a CHECK constraint is correct.

Owner-facing rendering is three positions: **red** = not claimed, **amber** = claimed not confirmed,
**green** = confirmed.

### 4.3 Quorum must be computed over people who can actually act

`N-of-M` validated against roster rows permits an **unsatisfiable quorum**: require 2 confirmations
from a circle where only 1 person has claimed, and the release stalls permanently with no error
anywhere. Revocation can create the same condition after the fact.

- `validateNofM` gains a confirmed-participant count, not a roster count.
- Revoking or un-confirming a person **re-validates every trigger's quorum** and raises a readiness
  blocker if any became unsatisfiable.
- A break-glass-only contact (§3.6) is **not** a confirmed participant and does not count toward N.

### 4.5 [A3] Readiness turns green at *executable*, not at *complete*

Green means the plan can actually run: **N confirmed verifiers plus at least one confirmed
recipient.** Not every roster row confirmed.

> Why: the pivot's strongest objection to the design it rejected was "perpetual amber readiness
> that owners learn to ignore." Gating green on M rather than N reintroduces exactly that. Paired
> with §4.3 this also makes green a true claim rather than a decoration.

Anything short of green states the **single fastest next action**, not just a colour — "your plan
cannot run yet; the quickest fix is a two-minute call with Tom to confirm his phrase." A status
light that does not say what to do is the amber owners learn to ignore.

### 4.6 [A4] Any deliberate authenticated owner action counts as a check-in

The signal worth having is "is this person still operating," not "did they press a button." This
removes the only recurring friction in the product and is a more accurate liveness measure. The
reversibility claim is untouched — it broadens what a check-in *is*, not what it *does*, and it
resolves toward ARMED, which is the safe direction (principle 4).

> ⚠️ **Count deliberate actions only — a mutation or a fresh sign-in. Never a passive GET or a
> background refresh.** A phone left logged in in a hospital drawer, polling, would otherwise
> suppress the dead-man's-switch at exactly the moment it exists to fire. This fails safe rather
> than open, so it is a silent-feature-death risk rather than a security hole — which is precisely
> the class of failure this codebase keeps producing.

### 4.4 Challenge-window escalation — the missing transition

Verified 2026-08-11: `CHALLENGE_WINDOW_SECONDS` is documented as *"How long the owner gets to answer
before verifiers are contacted"*, `access_requests.expires_at` is stored `NOT NULL` and returned to
the client, and **nothing reads it** — not `claimRequest` (which accepts only `owner_id`), not a
cron. So when the owner is incapacitated, which is the case this product is sold for, a recipient's
request sits in `awaiting_owner` forever.

This is a state-machine gap that has been read as a notification problem. It is built here, and it
is built **derive-on-read** per principle 6: when a verifier loads their standby dashboard, requests
whose challenge window has lapsed are computed as verifier-actionable. No sweeper is added — Rung 0
guarantees someone is looking, which is precisely what makes derive-on-read viable now and was not
before.

---

## 5. Repo change list

The pivot's change list (`relay-standby-pivot.md` §5) is adopted in full — migrations 020/021/022,
the four new modules, the modified-module table, the new routes, and the deletions. Next migration
number is **020**; 005 is absent from the sequence (verified 2026-08-11).

Deltas this plan adds:

| Area | Addition |
|---|---|
| `lib/rules/access-rules.ts` | `validateNofM` takes a confirmed-participant count (§4.3) |
| `lib/release/access-request.ts` | derive-on-read escalation past a lapsed challenge window (§4.4) |
| `lib/people/invitations.ts` | owner-brokered ticket issuance; single-use break-glass issue + redeem |
| `lib/vault/readiness.ts` | blockers for `unsatisfiable_quorum` and `unclaimed_counts_toward_n` |
| Resend webhook | **kept**, contrary to the pivot's §5.5 deletion (§3.4 rationale) |

`021_invitation_hardening.sql` matters more under this plan than under the pivot: the invitation
code becomes the front door, and `failed_attempts` exists on `verifier_codes` (015) and
`recipient_codes` (017) but **not** on invitations (verified 2026-08-11), leaving redemption guarded
only by `lib/http/rate-limit.ts` — which its own header correctly calls per-instance memory and not
a security boundary.

---

## 6. Sequencing

**Phase 0 — claim conversion test. No code. Runs in parallel with G1, not instead of it.**

The pivot proposes this as a better first G1 instrument. It is not a substitute: G1 asks *will
caregivers pay*, Phase 0 asks *will contacts claim*, and G1 has a dated hard stop
(`PROJECT.yaml: gates.g1-caregiver-wtp`). Phase 0 needs no ad spend and no engineering, so it does
not compete for budget. Run both.

Two confounds must be removed first or the number cannot bear the weight the architecture puts on it:

1. **Delivery.** The existing invite says *"Code from your email"* — it rides the channel measured
   broken on 2026-08-11. A low number would be uninterpretable: *never arrived* and *would not
   claim* produce the same result. **Split the cohort** — half email, half owner-delivered — and
   instrument delivered → opened → completed.
2. **Construct validity.** The existing `ClaimClient.tsx` terminates at *"Nothing is being opened.
   Accepting only tells them you have seen it."* It is an acknowledgment, not an account claim.
   Completing it does not predict completing a passkey registration. Treat the result as an **upper
   bound**, or build the real terminal step first.

**Phase 1 — passkey claim.** The direct mitigation for the category's known failure mode.

**Phase 2 — standby resolution and the release-path swap.** Claimed recipients stop receiving
codes; person state replaces the dead column; three-position light.

**Phase 3 — fingerprint confirm, secondary address, readiness blockers, quorum validation (§4.3),
escalation (§4.4).**

**Phase 4, post-G1 — Standby Card, wallet pass, circle visibility, SMS.**

⚠️ `PROJECT.yaml` sequencing says no further building until G1 produces evidence. Phase 0 is
evidence work and is in bounds. Phases 1–4 are building and the rule applies. The one item with a
defensible claim to jump the queue is **§4.4**, which is a shipped product not serving its headline
use case — closer to a defect than a feature.

---

### 3.7 Event transparency (J6 step 6) — an anti-abuse control, not roster exposure

When a request is made, **every other member of the circle sees that it happened.** Covert access
requests become impossible. Under standby this is nearly free: everyone has a dashboard, so rung 0
carries it with no delivery dependency.

**This is distinct from circle visibility and must not be conflated with it.** Risk 3 puts the
*roster* behind an owner toggle, default off, because a list of who is trusted is reconnaissance
for a controlling household member. An *event* notice — "someone requested access on 3 August" —
exposes no roster and is a defence against exactly that person acting covertly. Events on by
default; roster off by default.

---

## 7. Risks

1. **Claim conversion is the whole bet.** Phase 0 exists to find out before Phase 1 is built.
   Break-glass (§3.6) bounds the downside; it does not remove the bet.
2. **Differentiation cost.** Standby accounts move Relay structurally closer to Bitwarden and Proton
   emergency access, which are free. Remaining differentiators: reversibility, the importance engine
   and risk graph, and scope beyond passwords into documents and instructions. Decide deliberately.
3. **Coercion.** A visible circle roster is reconnaissance for a controlling household member, and a
   break-glass code is something a coercer can demand. Circle visibility ships behind an owner
   toggle, default off. Belongs in the G2 counsel brief beside the RUFADAA question.
4. **Free-account population** brings auth surface, reset flows, deletion requests and support load
   from people who are not customers. Cap and monitor. A standby user deleting their account must
   degrade the owner's circle to red, never break it silently.
5. **Fingerprint decay.** A phrase confirmed in 2026 says nothing in 2030. Annual re-confirm at
   most, satisfiable in one click, and it must not become the nagging problem it replaced.
6. **Recovery must not reintroduce email.** Standby account recovery is break-glass plus owner
   re-issue, not an emailed reset link.
7. **Shared devices.** An elderly couple on one iPad means a passkey either of them can use. No
   clean fix; accept and note.
8. **Fingerprint invalidation on re-claim.** A new `claimed_user_id` correctly changes the derived
   phrase and invalidates the owner's confirmation. The light must drop to amber **and say why**.
9. **Role collision.** A user who is both an owner and someone else's standby. Minor — and it is
   the *expected* state if the acquisition argument works, so the UI should assume it, not treat
   it as an edge case.

---

## 8. QA findings carried forward (2026-08-11)

Three things the QA pass surfaced that are not design changes and must not be lost.

### 8.1 The break-glass tension — read §3.6 again before building

Principle 2 says "a single-use code that dies on redemption is not a standing credential." That
sentence carries more weight than it can. For an **unclaimed** contact — the 70-year-old with no
smartphone — break-glass must be issuable *without* a claim, and then sits unused in a drawer for
years. **Until redeemed it is functionally indistinguishable from the standing printed credential
this architecture exists to eliminate**, and it lands with the population most exposed to it.

It is bounded: single-use, audited, notifies the owner, and §4.3 excludes break-glass-only contacts
from N. So the plan is internally consistent. The question to answer deliberately is narrower than
a redesign:

> Is a break-glass-only contact **covered**, or a **documented exclusion**?

§4.3's answer is *exclusion*. If that is what we mean, the product must say so plainly rather than
let a red light imply "not yet" when the truth is "not ever, on this device."

### 8.2 A promise that outruns its implementation

`src/app/how-it-works/page.tsx` tells customers: *"Margaret gets a record of exactly what was
opened while she was away."* The only surface is `/audit` — a raw hash-chained log whose sole
"summary" is an HTML `<details>` toggle. The data exists; the experience does not.

This matters more under this plan than before, because the post-incident record is the **emotional
payoff of the reversibility story** — the thing that turns "access closed itself" from an absence
into evidence of control. It is invisible in the plan precisely because the audit log technically
satisfies the claim.

### 8.3 A limitation to state, not solve

Rung 0 answers *"can they act,"* not *"do they know to look."* For requester-initiated cases the
family already knows — that is the insight the design rests on. For a **heartbeat lapse nobody has
noticed**, rungs 1–3 are all measured-unreliable and the re-confirm cadence is annual (Risk 5).

The plan is sound here because it is honest that alerting is best-effort. What is missing is that
this is not written as a scope boundary: **marketing must not promise the nobody-noticed case.**
Claim discipline, not architecture.

---

## 9. Consistency with the rest of the repo

### 9.1 Corroboration — this is a convergence, not a departure

Checked 2026-08-11 against the specs, journeys and site copy. Three independent places already
carry this design:

- **`specs/Relay_H0_Build_Spec_v2.md` line 3** — the product's own tagline is *"**Standby access**
  for the people who'll need it — when you can't be there,"* and "Standby" is listed as an
  alternate product name. This plan returns to the spec's original vocabulary.
- **`docs/user-journeys.md` J4-R9** — *"Recipients SHALL claim their role and complete identity
  verification **before** any trigger fires,"* annotated as *"the single highest-leverage change in
  this document,"* and it already names the referral loop. The acquisition argument predates the
  pivot by days and was reached independently.
- **`docs/user-journeys.md` J6 step 4c** — the challenge-window escalation was already classified
  `[BUILT]` transition, `[GAP]` routing. §4.4 closes a gap that was already diagnosed correctly.
- **`.kiro/specs/relay-h0-mvp/design.md`** state diagram carries the same seven transitions this
  plan preserves. No conflict.

### 9.2 Deltas recorded, deliberately not edited

- **`.kiro/specs/**` describe verifier confirmation as scoped-JWT-only (`design.md` §635, §677).
  Under this plan that is the *unclaimed fallback*. Left unedited by repo convention: the `.kiro`
  specs are records of what H0 built, not claims about today.
- **`docs/COMPETITORS.md`** names 1Password and Bitwarden emergency access but not Proton, and its
  differentiation reasoning predates an architecture change that moves Relay structurally closer to
  both. Tied to Risk 2 — revise deliberately when that risk is decided, not blindly now.

### 9.3 Ship-gates — must be true before this ships, not before it is built

- **Terms.** `src/app/terms/page.tsx` describes a free tier for *owners* ("a free tier you can stay
  on indefinitely", free-tier limits on adding items). A standby account is a different principal
  with no vault of its own and must never be billed or counted against a cap. **Terms need a
  standby clause before standby accounts exist in production** — and not before, because Terms
  describing an unbuilt capability is the estate error in reverse.
- **Privacy.** The claim is scoped to "no *advertising or tracking* cookies," which functional
  session cookies do not violate — owners already carry one. Re-read when standby sessions ship.
- **`/caregivers` copy** promises access *"NOW."* That is only true once §4.4 is built. Until then
  the fast path for incapacity is the heartbeat lapse.
