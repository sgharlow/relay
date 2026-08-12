# Relay standby architecture — the plan

Status: **proposal, ratified as the direction 2026-08-11.** Supersedes `relay-standby-pivot.md`
(kept for its reasoning and its repo change list, both still valid).

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
| Recipient (standby) | passkey or bound device | no | that they are on standby, and for whom. **Not the vault shape** |
| Verifier (standby) | passkey or bound device | no | pending decisions only, never vault shape |

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

**Assurance is a fingerprint phrase** confirmed out of band, exactly as the pivot specifies: one
boolean per person, set by the owner after comparing a short phrase with the contact. No webhook
ledger, no ack state machine, no scheduled sweep.

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
