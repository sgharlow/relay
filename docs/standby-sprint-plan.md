# Standby — sprint execution plan

How the code moves from what is built today to `docs/standby-architecture.md` (**hybrid+6**)
without breaking production on the way.

This elaborates the phases in that plan's §6; it does not compete with them. Where the two
disagree, the ordering here wins and §6 is corrected — see §5. Gates and volatile facts stay in
`PROJECT.yaml`.

---

## 1. Current built state — verified 2026-08-11, not remembered

Most of the target already has rails in the repo. This is the single biggest de-risking fact in
this plan.

| Exists today | What it gives us |
|---|---|
| `delegations.delegate_user_id UUID NOT NULL`, status `pending → active → revoked`, `consent_artifact_id` | **A claimed-user principal type already ships.** Standby accounts extend a proven pattern, and the status shape is nearly `invited → claimed → confirmed → revoked` |
| `invitations`: `owner_id`, `person_id`, `person_type ∈ {recipient,verifier}`, `token_hash`, `claimed_at`, `expires_at` | The claim ticket, its person mapping and its TTL are **reuse, not new build**. "Claimed" is already a column |
| `subscriptions` keyed by `owner_id`, tier `free`/`paid` | Standby → owner conversion is an INSERT against the existing user id |
| `CASE_ID_ALPHABET` = `23456789ABCDEFGHJKLMNPQRSTVWXYZ` | Voice-safe codes, already shared by `recipient-code.ts` / `recovery-code.ts` |
| `PERMITTED_TRANSITIONS` = 7 edges, CAS + OCC + safe-reset | Untouched by this plan |
| `detectRoleConcentration`, email-normalised | Upgrades to identity-keyed for free |
| `src/app/(access)/claim/ClaimClient.tsx` | A claim *page* exists — it terminates at acknowledgment and creates no user |

Genuinely missing: passkeys (`auth-options.ts` has only `CredentialsProvider`, `strategy: 'jwt'`,
no adapter), `claimed_user_id`, person state, standby resolution, break-glass, escalation routing,
`invitations.failed_attempts`.

### Migration risk is near zero, and that is temporary

`users` held **2 rows** on 2026-08-11 — the demo account and one live paying subscriber — and
`caregiver_leads` held 0. There are effectively no real circles to migrate. **This is the cheapest
moment this change will ever have**, and every claimed contact added later raises the cost.

---

## 2. Sprint sequence

Each sprint is independently shippable and leaves production working. Nothing below may ship
before the G1 gate except **Sprint A**, which is a defect fix in the current product — see §6.

### Sprint A — Challenge-window escalation *(no standby dependency)*

Closes `docs/standby-architecture.md` §4.4. Derive-on-read: a request whose challenge window has
lapsed becomes verifier-actionable. No sweeper.

- **Why first:** it is independent of standby entirely, it benefits the product as it stands, and
  every later sprint's value depends on it. A standby dashboard that resolves correctly still shows
  an empty screen in the incapacity case if nothing ever moves a request past `awaiting_owner`.
- **Exit:** a request left unanswered past `CHALLENGE_WINDOW_SECONDS` is actionable by a verifier,
  live-proven on production, and `claimRequest`'s owner-only path is unchanged for the in-window case.

> ⚠️ **Design correction found while building (2026-08-11).** The architecture plan §4.4 specifies
> **derive-on-read**, justified by "rung 0 guarantees someone is looking." **That reader does not
> exist until Sprint D.** Wiring escalation only to a read would mean it never fires for an
> incapacitated owner — nobody is looking, which is precisely why the request is stuck. So Sprint A
> runs it from the **existing heartbeat cron**, which honours the principle as written ("do not add
> a *second* thing that can silently stop") because it adds no new scheduler. Sprint D adds the read
> path as an additional, faster trigger; both are CAS-guarded and idempotent, so running both is
> safe.
>
> Two implementation notes worth carrying forward. `access_requests.status` **already permits
> `'escalated'`** in its CHECK constraint — the schema anticipated this, so no migration was needed.
> And escalation must **not** copy the owner-consent path's quorum auto-satisfaction: an owner
> agreeing is stronger than third parties attesting for them, but a lapse is the *absence* of a
> signal, so N-of-M applies in full.

### Sprint B — Foundations *(all additive; no path switches)*

- Migration **020** (nullable `claimed_user_id`, `email_secondary`, `standby_state`,
  `fingerprint_confirmed_at` on both roster tables; `notified_at`, `first_access_at` on
  `release_state`; two ASYNC indexes).
- Migration **021** `invitations.failed_attempts` — standalone security value, and it matters more
  once the invitation code becomes the front door.
- `lib/people/standby-state.ts` — constants, permitted edges, NULL→`invited` read helper, derived
  `unreachable` from `invitations.expires_at`.
- Replace the dead `verification_status` chip with the three-position light.
- **Exit:** the circle page shows real person states; no release or auth path has changed; rollback
  is reverting a render.

### Sprint C — Identity: claim becomes an account

- Migration **022** `webauthn_credentials`; `lib/auth/webauthn.ts` via `@simplewebauthn/server`
  behind a custom provider, keeping the JWT session model. **Budget honestly — this is the largest
  single item in the plan.**
- **[A1] two-stage claim**: acknowledge + bind device, then passkey prompted and deferrable.
- `invitations.ts` redemption creates or links a `users` row and sets `claimed_user_id`.
- **Claim while already signed in** — links a second relationship, never a second account.
- **[A6] standby dashboard with a day-one job**, including *start your own plan* — **conversion
  upgrades in place** (`subscriptions` INSERT against the existing user id).
- **Decline and resign** (§4, N15/N16).
- **Exit:** a contact claims and lands somewhere useful; an existing user claims a second
  relationship without minting a second account; a claimed contact can leave.

### Sprint D — The release path swap *(the risky one)*

- `lib/access/standby-resolve.ts`; `AccessClient` reads the release from the session, not `?token=`.
- Stop minting recipient codes for **claimed** recipients; retain for unclaimed.
- Version check moves to a server-side comparison per request.
- **Quorum counts `claimed`** at this stage — see the staging note in §5.
- **Exit:** a claimed recipient opens the dashboard with no token in the URL; an unclaimed one still
  works via the existing path; a re-arm closes an open dashboard on its next call.
- **Rollback is inherent:** the token path still exists, so reverting the code restores the old
  behaviour with no data change.

### Sprint E — Correctness and assurance

- `lib/people/fingerprint.ts`; **[A2] the guided setup call**; confirm/unconfirm.
- **§4.3 quorum tightens from `claimed` to `confirmed`**, plus revalidation on revoke/unconfirm,
  separation of duties (a verifier who is also a recipient on the same release does not count), and
  owner-is-not-an-independent-verifier.
- **§3.6 break-glass** issue and redeem, single-use and self-revoking.
- **[A3] readiness green at executable** + single fastest next action.
- **[A4] passive check-in**, scoped to the user's own owner context (§3.7 rule 8) — these two must
  ship together or check-in leaks across hats.
- **§3.8 event transparency**; `email_secondary`.
- **Exit:** no configuration can produce an unsatisfiable quorum; readiness green is a true claim.

### Sprint F — Artifacts *(post-G1)*

Standby Card, **[A5]** owner one-page plan, wallet pass, circle visibility (default off), SMS,
re-confirm cadence.

---

## 3. Flow coverage

### Existing journeys — must not regress

| Journey | Touched by | Note |
|---|---|---|
| J1 worry → commitment · J2 cold start · J3 delegation | — | Unaffected. J3 is the pattern precedent |
| J4 building the circle | B, C, E | Invitation *email* path retired rather than fixed |
| J5 the living habit | E | [A4] passive check-in |
| J6 someone requests access | **A**, E | Escalation + event transparency |
| J7 the verifier's moment | C, D | Session replaces `/verify?token=` for claimed verifiers |
| J8 hands on the account | D | Session replaces token |
| J9 standing down | D | Server-side version check closes open dashboards |
| J10 permanent handoff | — | Gated on `g2-counsel-opinion` |

### New flows this architecture introduces

| # | Flow | Sprint |
|---|---|---|
| N1 | Contact claims a standby account (two-stage) | C |
| N2 | Guided setup call — issue, read phrase, confirm | E |
| N3 | Standby dashboard, nothing open | C |
| N4 | Standby → owner conversion, in place | C |
| N5 | Break-glass issue and redeem | E |
| N6 | Multi-hat context switching | C |
| N7 | Verifier acts on a lapsed challenge window | A |
| N8 | Circle sees that a request happened | E |
| N9 | Circle degrades when a standby user deletes or is revoked | C rules, E revalidation |
| N10 | Ticket expiry → reissue | B (reuses `invitations.expires_at`) |
| N11 | Deferred passkey → later prompt | C |
| N12 | Device change → re-bind via break-glass | E |
| N13 | **Claim while already signed in** — second relationship, not a second account | C |
| N14 | **Fingerprint MISMATCH** — see §4 | C + E |
| N15 | **Contact resigns from a circle** | C |
| N16 | **Contact rejects an invitation they did not expect** | C |

---

## 2a. ▶️ Phase 0 — UNPARKED 2026-08-12, instrument live in the product

Parked earlier the same day ("build first, measure later"), on the stated risk
that every sprint compounds on an unvalidated bet. The build is now done, so the
reason for parking has expired and the measurement is live.

**Unparking it exposed two defects that would have made the number meaningless.**
Phase 0 was designed when a script was the only way to invite; the product grew
its own invite path on 2026-08-12 and the instrument was never connected to it.

1. 🔴 **The product recorded no arm.** `inviteAndNotify` called `createInvitation`
   without `deliveryChannel`, so every invitation issued through `/circle` landed
   in the report's `unknown` bucket. The split is the entire de-confounding
   mechanism — without it, *"people will not claim"* and *"the code never
   arrived"* produce the same number and have opposite consequences.
2. 🔴 **`opened_at` was lost on successful claims.** `markInvitationOpened`
   guarded on `claimed_at IS NULL`, and `ClaimClient` fires it fire-and-forget
   immediately before `signIn` — so when the claim won the race the marker was
   never written. That drops the marker precisely on the claims that SUCCEEDED,
   which can make `opened` read lower than `claimed`: an impossible funnel, and
   one that reads as "nobody is opening it" when they opened it and finished.

**The product now asks how the code will be delivered**, and honours the answer:
the owner-delivered arm sends no email at all. That is both the measurement and
the better product — emailing a code the owner is about to read aloud puts a live
credential into the channel measured broken on 2026-08-11, for no benefit, and it
would have put every invitation in both arms at once.

### Reading it

```
npx tsx --env-file=.env.local scripts/phase0-report.ts        # all invitations
npx tsx --env-file=.env.local scripts/phase0-report.ts <tag>  # one deliberate run
```

### What it cannot tell us yet

**N is 0 and will stay 0 until real owners invite real people.** The instrument
is correct and live-proven; it cannot manufacture demand. The threshold is
already recorded in `phase0-report.ts` so it cannot move after seeing the result:
below roughly 50% the fallback carries more traffic than the primary path and the
ranking swings back toward durable artifacts. ⚠️ Twenty invitations is a
directional read, not a decisive one — the same limitation ratified for G1.

## 3a. 🔴 Found while building Sprint D — a session outlives its account

**A deleted user's session keeps working until the JWT expires.** Proven on
production 2026-08-12: a browser holding a session for a user that had been
deleted from `users` was still accepted — `/api/standby` answered **200** rather
than 401, because `getOwnerSession` reads a self-contained JWT and nothing checks
that `users.id` still exists.

Impact **today is low**: every owner query is scoped by `owner_id`, so a deleted
account's session reads its own absent data and nothing else, and
`resolveStandbyFor` returns zero relationships. Nothing leaks.

It matters because of what it means rather than what it does: **"delete my
account" does not mean "signed out", and revocation is not immediate.** That is
the §3.7 rule 1 concern made real — the JWT is a snapshot, and the gap between
snapshot and truth is exactly where revocation lives. §3.7 rule 3 already
requires a standby deletion to degrade the owner's circle, which it does in the
database; the person simply keeps a working cookie for up to 24 hours.

Not fixed here, deliberately: the honest fix is session invalidation (a token
version on `users`, checked per request), which is a design decision with a
per-request cost, not something to bolt on at the end of a sprint. **Do it before
beta**, since a beta is when real people start deleting real accounts.

## 4. Gaps this analysis found

**N14 — the fingerprint mismatch path was unspecified, and it is the whole point of the control.**
The plan says the owner compares a phrase and confirms if it matches. It never says what happens
when it *does not*. A security control that detects an interception and then offers no response is
decoration. Required: the owner can reject the claim, which NULLs `claimed_user_id`, returns the
person to `invited`, invalidates the ticket, writes an audit entry, and reissues. Treat as a
security event, not a typo.

**N15 / N16 — a standby user could not leave.** Standby accounts are free users with rights. Two
flows were missing entirely: *resign from a circle* ("remove me from Margaret's plan"), and *reject
an invitation* ("I don't know this person"). Both must degrade the owner's circle the same way a
deletion does (§3.7 rule 3): drop to red, tell the owner, revalidate quorum — never silently shrink
it. N16 is also the contact-side half of N14.

**N13 was implicit.** §3.7 gives the identity *rules* for multi-hat users but no *flow*. Claiming
while signed in must link a relationship; routing it through signup mints a second account and
severs every existing standby link.

---

## 5. Ordering inconsistencies found, and how they are resolved

**1. Escalation was sequenced after the release swap; its value runs the other way.**
`docs/standby-architecture.md` §6 puts §4.4 in Phase 3, after the Phase 2 release-path swap. But a
swapped release path still shows an empty standby dashboard in the incapacity case if requests
stall at `awaiting_owner`. **Resolved: escalation becomes Sprint A, before all standby work.** It
has no standby dependency and improves the product as it stands.

**2. 🔴 Shipping §4.3 as written before assurance exists would brick every release.**
§4.3 requires quorum to count **confirmed** participants. `confirmed` requires the fingerprint flow,
which is Sprint E. Ship §4.3 in Sprint D and *nobody is confirmed*, so **every quorum becomes
unsatisfiable and no release can ever complete.** Resolved: quorum counts `claimed` in Sprint D and
tightens to `confirmed` in Sprint E. This is the most dangerous ordering trap in the plan.

**3. Break-glass and the emailed-code fallback serve the same population.** Not a contradiction —
belt and braces, and deliberate, because the email path is the one measured broken. Until Sprint E
the emailed code is the only fallback for unclaimed contacts, which is a knowingly weak window.

**4. [A4] and multi-hat rule 8 must ship together**, or a user acting on someone else's standby
dashboard extends their own liveness.

**5. [A3] depends on both person state and quorum-on-confirmed**, so it cannot precede Sprint E.
Correctly placed.

---

## 6. Gate discipline

`PROJECT.yaml` sequencing says no further building until G1 produces evidence.

- **Sprint A is a defect fix** in a shipped product that does not serve its headline use case. That
  is the one item with a defensible claim to jump the queue.
- **Phase 0** (claim-conversion measurement, de-confounded per the architecture plan §6) is evidence
  work and is in bounds. It should run in parallel with G1, not instead of it.
- **Sprints B–F are building** and the rule applies.

## 7. Verification

Every sprint ends with a live probe against production, not a green suite — this codebase has
produced silent failures behind passing tests repeatedly. Sprint D additionally requires **both**
modes proven in one session: a claimed contact resolving by session, and an unclaimed one still
resolving by token.

## 8. Passkey ceremony — tested with a virtual authenticator, 2026-08-12

Driven against **production** with a CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`,
resident key, UV on), as a real claimed standby contact. Fixtures created and torn down; the estate
ended at the two protected baselines with zero orphans.

### The ceremony itself — all green, nothing changed

Register → sign out → sign back in **with no identifier typed** → session restored → `/api/standby`
200. Adversarially: a registration challenge replayed on the authentication path is refused, a
tampered signature is refused, a forged challenge token is refused, a replayed assertion is refused,
unauthenticated registration is 401, and `excludeCredentials` stops a second enrolment of the same
device. The signature counter advances and persists (observed 0 → 9), and `last_used_at` stamps.
An epoch bump kills a live session while passkey re-entry still works — so revocation does not lock
a passkey user out.

### Four defects found, all fixed and live-proven

None were visible to the API tests, because each is about **reachability or aftermath** rather than
whether a call succeeds.

1. **Enrolment was unreachable for the people it was for.** The only UI was `/account`, inside the
   *owner* route group — a standby contact who found it landed in a vault dashboard being told their
   vault was empty. [A1]'s "offered afterwards, deferrable" had no afterwards. Now a card on the
   standby dashboard in access mode, shown only to someone covering a person who has not enrolled.

2. **An already-enrolled device was reported as broken.** `InvalidStateError` — the *correct*
   response to a duplicate enrolment — displayed "Your device could not complete that." The taxonomy
   now lives in `lib/auth/passkey-errors.ts` with tests, shared by both surfaces.

3. **Sign-in destinations were hardcoded** — passkey → `/start`, email-and-code → `/vault`. Neither
   asked who the person was, so a contact signing in with their new passkey got an onboarding funnel.
   `/continue` resolves it from the database. Relatedly, owner mode linked to `/standby` from
   **nowhere**, so a §3.7 both-hats user could not reach it; the sidebar now carries "Standing by (n)".

4. **Deleting an account left other people's circles bound to a ghost.** `deleteAccount` is scoped
   `WHERE owner_id = $1`, but standby roles live in *other* owners' rosters: after deletion the owner
   still read `standby_state = 'claimed'` pointing at a user id that no longer existed — a covered
   circle that is not covered, which only reveals itself on the day it is needed. Deletion now
   resigns from every circle first (reusing `resignFromCircle`, so the other owner gets the audit
   entry) and removes passkeys and invitations.

### Known and accepted

A resident credential whose database row is gone yields "That passkey was not recognised" with no
recovery guidance. Reachable today only by deleting rows out of band, which is what made it visible;
worth a friendlier message if passkey deletion is ever offered in-product.

## 9. Beta readiness — reassessed 2026-08-12

The sprint shipped real, tested backend capability and **wired almost none of it to a surface**. Four
blockers, all of the same shape: server built and correct, client never connected. Two are now closed.

### ✅ Closed 2026-08-12, live-proven on production

**Decrypt on the session path.** Sprint D swapped the recipient READ path to sessions and stopped
there, so `/api/access` resolved a full plan for a claimed recipient while every Reveal posted
`{ token: '' }` and took a 401 — a dashboard that listed everything and opened nothing. **J8, the
journey carrying primary demand, did not work on the architecture built to replace the token.**

*Decision: the route ACCEPTS A SESSION rather than minting a short-lived token.* Minting one would
put a bearer credential back in the browser — precisely what hybrid+6 removes — and restore the
staleness window a session does not have. The version check exists only because a token carries a
snapshot; a session reads the row on the request, so a re-arm closes access by construction. `version`
is therefore optional on the shared authorization core, and its absence is not a weaker check.

Proven by the gate gradient, each step past the previous door: **401 at the door (before) → 403
"Release is not active" while ARMED → 403 on an out-of-scope item (Property 6) → reaches KMS on the
in-scope released item** (`InvalidCiphertextException` in the runtime log, on deliberately-junk
fixture ciphertext). `/access` renders the plan with a session and no token in the URL.

Found while proving it: standing down showed *"This access link is invalid or has expired"* on the
session path — no link exists there, and it is the exact sentence J9's graceful close replaced.
Fixed on both sides (`getClosureSummaryForUser`; the client treats `closed` alone as sufficient).

**Owner-initiated invitation.** `POST /api/invitations` was complete and **nothing called it**.
Adding a person auto-mints and emails an invitation, but the owner could not see the code, resend, or
learn whether delivery worked — `inviteOnCreateBestEffort` promises "the owner can always resend from
the invitations surface" and no such surface existed. Every invitation in testing came from a script.

The card shows the CODE, because delivery is the measured-broken part: the owner reads it down the
phone, which is both the reliable channel and stronger assurance than an inbox. Live-proven end to
end — owner clicks *Get a code to read them* → code displayed → a different person types it at
`/claim` → lands on `/standby` bound to that owner. No scripts.

### ✅ Also closed 2026-08-12 — Option 1, and the plan gap behind it

**The verifier now acts from rung 0, and the dashboard routes.** `resolveVerifierFor` +
`/api/verify` (no token segment) + a session branch in `VerifyClient`; the standby card gains a CTA
per principal. `buildVerifierContext` and `submitConfirmation` are untouched — both already took a
plain `releaseStateId` + `verifierId`, so this is the same core-plus-two-doors split used for
recipient decrypt and the closure summary. `/api/verify/[token]` is permanent, per amended J7-R1.

**The gap was in the PLAN first**, which is why the code had it — see `standby-architecture.md` §3.2
(amended). §6 Phase 2 said "claimed *recipients* stop receiving codes"; §5 named no verifier module;
this plan's own flow-coverage table promised *"Session replaces `/verify?token=` for claimed
verifiers"* under sprints C–D while Sprint D's task list said recipients only. Core principle 5 —
*every participant can do their job by visiting the site* — was **false for claimed verifiers**, and
§4.4's escalation ran on dashboard load and then stranded the person it had made responsible.

Two defects found while proving it: the card said **"Open now"** for `pending`/`grace`/`released`
alike, telling a recipient access was open while a release was merely being confirmed; and a
verifier who had answered was **still being asked** (safe — `submitConfirmation` intent-reads and
returns `duplicate` — but it reads as the product having lost their answer). Both fixed; the second
is resolved server-side as `awaitingDecision` so the card and `/api/verify` cannot disagree.

### ✅ Break-glass redeem — shipped and live-proven 2026-08-12

`redeemBreakGlass` had sat in `lib` since sprint E with no route, so §3.6's answer for the lost
authenticator and the contact who never claimed could not be exercised by anyone. Now a `break-glass`
credentials provider (the code IS the authentication, exactly once, mirroring `standby-claim`) plus
`/break-glass` in access mode.

Walked on production: redeem → session → `/standby` 200; the same code again → refused, no session;
the person drops to `claimed` with `fingerprint_confirmed_at` cleared, so the owner's light goes
amber; `break_glass_redeemed` in the audit chain. Runtime log shows **200** on the redeem and **401**
on both refusals, worded identically.

**🔴 A security hole was found while wiring it and fixed before shipping.** Nothing retires a
break-glass code when an owner revokes somebody, and `redeemBreakGlass` never read `standby_state` —
so a revoked contact holding a year-old code could redeem it and set themselves back to `claimed`
with a session. The person an owner most urgently removes is the controlling household member of
Risk 3, and revocation is the control that answers them; a bearer credential outliving it makes
revocation decorative. It was latent only because the function was unreachable. The guard runs
**before the burn**, so a refused attempt does not consume a legitimate holder's only way in —
verified live: after the refusal the code was still unused.

**§3.6's required owner notification did not exist either.** The audit entry recorded the event for
anyone who went looking, which is not telling the one person who needs to know — and "loud" is
exactly what §8.1 accepts this credential in exchange for. `notifyOwnerOfBreakGlass` now says what
happened, that the light is amber and why, and the one action that matters if it was not them. It
deliberately does not say what the person can now reach: if the code was used by the wrong hands,
that message is going to the right ones and must not become a map.

### Option 2 is unblocked — but it needs a decision, not just a code change

Ceasing to mint codes for claimed verifiers is now *safe to build*: a claimed verifier who cannot
sign in has a working fallback for the first time. Two things should be settled first, because the
change is one string and the consequences are not:

- **§8.1's question is still unanswered.** Is a break-glass-only contact **covered** or a
  **documented exclusion**? §4.3 says exclusion; the product says nothing, and the circle light
  shows red — which reads "not yet" when the truth may be "not ever, on this device".
- **The fallback is only as good as its distribution.** A code that exists but was never handed over
  is not cover. Nothing yet tells an owner which of their people hold an unredeemed code, so
  "everyone has a fallback" is currently unknowable from inside the product.

### ✅ Assurance — shipped and live-proven 2026-08-12

**The circle light goes green for the first time.** Walked on production: B claims → A's circle shows
amber with *Check it is really them* → the phrase appears → *The words matched* → **green**, and
`standby_state = 'confirmed'`. The phrase the owner is shown was verified identical to
`fingerprintFor` derived from the binding.

`/api/circle` never returned the phrase, so a confirm button would have asked the owner to assert "I
compared a phrase and it matched" having never been shown one — the assurance model deleting itself.
It is derived per request and never stored, so it changes the moment a different human claims the
slot and an old confirmation stops reading as valid (Risk 8).

**N14 was still missing and is now built.** `unconfirmPerson` is guarded on `confirmed`, so it could
not touch the case that actually happens: a mismatch found during the setup call, when the person is
`claimed` and never was confirmed. `rejectClaim` treats it as a security event — severs the binding,
returns to `invited`, and kills every live ticket, because the ticket channel is what was
compromised. Proven live: reject → `invited`, phrase gone, light red, outstanding invitation marked
spent, and the re-invite control offered in its place. Reissue is deliberately manual: after an
interception the owner should choose the channel.

Both answers carry equal weight in the UI, and reject asks once before acting. §3.3's warning is
honoured — the control lives in owner mode only and says *call them*, because letting the contact
confirm alone is the simplification that breaks the property.

### ✅ Leaving a circle — shipped and live-proven 2026-08-12

N15/N16. `/api/standby/leave` had existed since sprint C4 with no caller. Walked on production for
both reasons: card disappears, `relationships` drops to 0, the contact stays signed in, and the
owner's roster row survives unbound at `invited` with `claimed_user_id` NULL — **degrade, never
delete** (§3.7 rule 3). The two reasons record distinctly in the owner's audit chain,
`standby_resigned` vs `standby_rejected`, because "an invitation reached the wrong inbox" is a
different thing for an owner to learn than "I am stepping down".

Warns when a release is open for that owner but does **not** block: this is a right, and a product
that traps somebody in an obligation during another person's emergency has misunderstood which of
the two it serves.

### ✅ §4.3 quorum + [A3] readiness — shipped and live-proven 2026-08-12

**The count was the bug.** `assessReadiness` compared a trigger's threshold against the ROSTER COUNT
of verifiers, so two verifiers who had both been revoked read as able to give two confirmations.
Now it counts people who could answer, and a new fatal `unsatisfiable_quorum` blocker names it.

Proven live: healthy plan (2 confirmed verifiers, N=2) → green, banner silent. Revoke one → *"A
trigger needs 2 confirmations but only 1 of your trusted contacts could give one — 1 has been
removed. An emergency could start and never resolve."*

**ABLE means "by any route"** — claimed people act from their session, unclaimed ones still hold the
emailed-code path J7-R1 keeps permanently, and only `revoked` is genuinely incapable. Deliberately
*not* confirmed-only even though §4.3's end state is confirmed: this blocker is FATAL, and a fatal
warning that is untrue for a plan that would in fact run teaches owners to disbelieve the banner,
which then fails for the cases that are real.

**[A3] grades that separately, and finally has a consumer.** `circle-readiness.ts` had been written
and tested since sprint E with zero importers, so the light it computed reported to nobody.
Readiness returns it and the banner shows the single fastest next action. Proven live: verifier
restored + recipient un-confirmed → no false fatal, *"Your plan cannot run yet — Confirm a recipient
who has already claimed…"* with a link to the circle. The two signals do not collide; the [A3] card
is suppressed while a fatal blocker is speaking.

Derive-on-read rather than a stored blocker (principle 6): a stored one needs clearing on every path
that fixes it, and each is a chance to leave a stale alarm.

### 🔴 Still open — rewritten 2026-08-12, the earlier numbering had gone stale

1. ✅ **Quorum tightened to `confirmed` 2026-08-12 — §5's ordering trap #2, closed.** Count, runtime
   and readiness now share one predicate (`isEligibleVerifier`). Tightening the count alone would
   have shipped a lie: `countEligibleVerifiers` only ever governed *configuration*, and nothing
   checked eligibility when a confirmation actually arrived, so the config check and the banner
   would both have asserted something the release path does not enforce.

   **Answering and counting are now separate**, which is what lets J7-R1 and §4.3 both hold: an
   unverified verifier may still decide, the answer is audited, and it does not advance the
   threshold. The verify screen says so plainly rather than thanking them. Gated before the decision
   branches, so an unverified *deny* cannot halt a genuine release either.

   ⚠️ **Blast radius, measured before the change:** both configured triggers on the live demo
   account became unsatisfiable, because both its verifiers are `invited`. Not a regression — the
   true state, reported for the first time — but **every beta owner must make the confirm call
   before their plan can fire**, and the banner now says so on every screen.

   🔴 **A defect in the change itself, found by walking it live and fixed:** the idempotency
   intent-read keys on `verifier_confirmations`, so writing the non-counting answer there made every
   later attempt return `duplicate` — a verifier who answered before being verified could never
   count, permanently and silently. That is the *ordinary* beta sequence, not an edge case. The
   non-counting answer now lands in the audit log only. Proven live end to end: answered unverified
   → recorded, count 0 → owner verifies → answered again → count 1.
2. ✅ **Option 2 — SHIPPED and live-proven 2026-08-12.** Both preconditions were met first: §8.1 was
   ruled (documented exclusion) and fallback visibility shipped, so *"everybody has a fallback"*
   became answerable from inside the product rather than assumed. Detail in §12 item 5.

   The condition landed as **confirmed and able to sign in**, not *claimed* — and "able to sign in"
   is a passkey **or** an authenticator, which widened during the build once the multi-hat case was
   considered. Live-proved against production DSQL with a five-verifier fixture covering all four
   classes: **exactly one code minted for five verifiers**, four messages sent, none carrying a
   token link, and the revoked person receiving nothing at all. Fixture torn down; estate back to
   baseline.

   Part **B** of the ruling — a second look at what the sign-in branch's message should say — stays
   deferred until after Phase 0, as Steve ruled.
3. ✅ **§9.3's Terms ship-gate — CLOSED 2026-08-12.** Terms gained *"If someone names you"* and
   Privacy gained *"If someone named you"*; both live. Counsel review under `g2-counsel-opinion` is
   still outstanding and this does not substitute for it — what it does is make the documents true,
   which is the part that could not wait.

   Writing them found three defects, all the same class in different directions: `deleteAccount`
   did **not** remove `break_glass_codes` (the privacy page was about to claim it did — fixed,
   tested, and proven live: 1 → 0 with zero orphans); a first draft claimed a trusted contact is
   *"never shown anything about their vault"*, which is false at decision time and is the same
   content-not-scale correction made to §3.1 that morning; and another claimed a standby account
   *"does not count against anyone's limits"* when the free tier does cap recipients. Also corrected
   a pre-existing **understatement** — Privacy told people to email us to delete their account,
   months after self-serve deletion shipped.
4. **Deferred sprint E items:** §3.8 event transparency, `email_secondary` (rung 2), and [A2]'s
   guided-setup-call UI. The assurance flow works without [A2]; it is a smoother packaging of the
   same two acts.

### Verified sound, unchanged

[A4] passive check-in is genuinely wired (`recordDeliberateActivity` in `lib/http/owner-route.ts`),
and §5's ordering trap #2 was navigated exactly as the plan called for: quorum counted `claimed`
while nobody could yet be `confirmed`, and tightened the same day assurance made `confirmed`
reachable.

---

## 10. Beta readiness — reassessed 2026-08-12 (second pass)

**The product is beta-ready; the estate is not yet configured for it.** Every journey now works end
to end on production without a script, and the remaining items are operational or decisions rather
than engineering.

### What a beta owner can now do, all live-proven
Invite someone from `/circle` and read them the code · have them claim, land on a standby dashboard,
and enrol a passkey · verify a fingerprint phrase by phone and watch the light go green · be told the
single fastest next action when their plan cannot run · issue and redeem an emergency code · have a
claimed verifier answer from their dashboard with no token · have a claimed recipient open the plan
and reach the KMS boundary with no token · stand somebody down and watch access close · leave a
circle · close an account and have every circle degrade visibly.

### The one thing that changed for beta today
Quorum now counts only verified people. **An owner who never makes the confirm call has a plan that
does nothing** — which is the correct security posture and a new operational requirement. The
readiness banner is the mitigation and it is loud, but beta onboarding should say it out loud too:
*naming people is not enough; you have to check it is really them.*

### Blockers to a beta cohort — none are code
1. ✅ **The demo account is fixed** (2026-08-12). It went red / `unsatisfiable_quorum` the moment
   quorum tightened, because the seed left every contact at `invited`. Fixed in the **generator**,
   not the rows — hand-editing would have drifted back on the next reset — and the seed now BINDS
   contacts to standby accounts rather than writing `confirmed` onto an unbound row, which would be
   a state the product itself can never produce. Live: green, executable, no fatal blockers, with
   one contact deliberately left amber so the demo also shows the confirm control. Seeded standby
   users are flagged `is_demo_account` so they cannot inflate a signup count.
2. ✅ **Phase 0 is unparked and the instrument is live** — see §2a. N stays 0 until real owners
   invite real people; it cannot manufacture demand.
3. ✅ **Fallback visibility shipped 2026-08-12.** `/api/circle` returns `has_passkey` and
   `has_break_glass` per claimed contact, and the circle says plainly when somebody could not get
   back in. A passkey and an unredeemed code are deliberately **not** treated as equal evidence: a
   passkey is on a device they demonstrably used, while an unredeemed code proves one was *issued*,
   not that they can still find it. Booleans only, never the credential.

4. ✅ **§8.1 ANSWERED and SHIPPED 2026-08-12: documented exclusion.** Migration 026 adds
   `break_glass_only` to both roster tables — a column rather than a fifth `standby_state`, because
   a new state would join the machine driving quorum, lights, resolution and
   `PERMITTED_STANDBY_EDGES`, and §4.2 fixes that progression at four values with a single writer.
   The person really *is* `invited`; this records that staying there is deliberate.

   All three constraints from the briefing are met and live-proven:
   - **It re-runs the quorum check and says the result.** Walked live: marking the second of two
     verifiers stopped the "has not accepted yet" nag *and* immediately reported
     *"only 1 of your trusted contacts is verified — one is covered by an emergency code only and
     will never count."* The `href` points at `/triggers`, not `/circle`, because chasing somebody
     who is never coming is not a fix.
   - **Recipients too**, meaning something different: a verifier does not count toward N, a
     recipient does not satisfy [A3]'s "somebody able to receive".
   - **The marker clears on redemption**, in the SAME UPDATE that binds the identity rather than by
     a follow-up call that a future binding path could forget. Proven end to end: marked → issued a
     code → redeemed → `claimed`, marker `false`.

   Refused for anybody who has already claimed (it would record a falsehood and exclude somebody
   able to act); undo is never blocked, because the guard exists to stop a false record, not to trap
   somebody inside one.

5. ✅ **Option 2 (adaptive minting) SHIPPED 2026-08-12, with the J7-R1 amendment Steve ratified
   alongside it.** B — a second look at what the sign-in-capable branch should say — stays deferred
   until after Phase 0, as ruled.

   **What ships.** `notifyVerifiersForTrigger` now classifies each verifier
   (`lib/notify/verifier-notice-class.ts`) and only one of four cases carries a credential:

   | Verifier | Gets | Why |
   |---|---|---|
   | Confirmed, no passkey and no authenticator | **A single-use code** | Their answer counts and they have no other way in |
   | Confirmed, holds a passkey or an authenticator | A notice, no credential | Principle 1 finally holds on the verifier side — nothing in the message to intercept |
   | Named but not confirmed | A notice saying plainly that their answer would not count | Post-tightening it would not; a code buys a vote with no effect at full risk |
   | Revoked | **Nothing** | Until today they received the emergency *and* a working code |

   ⚠️ **The condition is `confirmed`, not `claimed`** — the obvious mirror of the recipient branch,
   and wrong in both directions: claiming gets you an account, being confirmed is what makes your
   answer count. ⚠️ **An unredeemed break-glass code does not suppress the mail**, though `[A3]`
   readiness counts one as a way back in — readiness asks whether the owner left a fallback, this
   asks whether the person can act in the next hour, and a lost code looks identical in the database
   to one in a wallet. ⚠️ **Classification failure mints for everyone**: a stalled release is worse
   than one unnecessary code, and the runtime quorum gate still refuses to count an unconfirmed
   answer.

   **The `sign_in` branch also widened during the build.** The brief said *"no passkey"*; a verifier
   who is also an owner of their own vault signs in with email + TOTP and has never needed a
   passkey (§3.7 rule 2 links a second relationship rather than minting an account). Keying on
   passkeys alone would have mailed a live code to the one class of person most obviously already
   holding a way in. The condition implemented is *no passkey **and** no authenticator*.

   **J7-R1 amended a second time, same day.** It had guaranteed that an unenrolled verifier can
   always decide by code. Post-tightening that decision counts towards nothing, so the guarantee
   protected a right to cast a vote with no effect — and it was the only remaining reason to put a
   live credential into the channel measured broken on 2026-08-11. The surviving guarantee is the
   one that was always the point: **no enrolment at decision time**, which now holds absolutely for
   every class of verifier. The informational value the old sentence carried is served by `[A3]`
   readiness, to the owner, in calm, where it is actionable.

   **J7-R2 was already describing this.** Its parenthetical had said a claimed verifier receives no
   code since the hybrid+6 ratification, while the code minted one for everybody — the spec was
   right and the implementation three sprints behind it.

6. ✅ **Onboarding copy fixed 2026-08-12.** The `/circle` header now states that naming is the
   first half of two, each light says what is MISSING rather than naming a state
   (*"Accepted — not yet verified, so their answer would not count"*), and the completeness banner
   counts the unverified instead of declaring success.

   **It closed a false green.** *"Every critical item has someone who can reach it"* was a statement
   about coverage — items joined to recipients — and stayed green while nobody named could act.
   That is the screen where an owner decides they are finished, which makes it the worst place to
   say "done" when the truth is "named, not yet checked".

   Walked live on an owner mid-setup: everyone named and nobody verified → the banner names the
   shortfall and the reason → verified both through the real control → green, executable, earned.

### Deferred, and genuinely optional
§3.8 event transparency · `email_secondary` (rung 2) · [A2] guided-setup-call UI, which is packaging
around an assurance flow that already works.

---

## 13. Security review — 2026-08-12

Systematic rather than sampled: every API route checked for an auth guard, every owner-scoped
`[id]` route checked for ownership enforcement, plus the crypto boundary, credential storage, audit
contents, XSS surface, bundle exposure, token verification, revocation, rate limiting and
cross-owner isolation.

### 🔴 One finding, fixed

**Cross-owner delegation consent.** `recordConsent` took no owner argument at all and activated
`WHERE id = $1 AND status = 'pending'`, while `/api/delegations/[id]/consent` authenticated a user
and passed the path id straight through with no `assertOwns`. **Any signed-in user could activate
any pending delegation** — granting a stranger setup rights over somebody else's vault, and
defeating the consent step that is the entire control making delegation legitimate (J3).

Unguessable UUIDs made it hard to exploit rather than safe. It was the one owner-scoped route in the
codebase that neither called `assertOwns` nor scoped its own SQL — in a data layer with no foreign
keys, where a cross-owner reference is refused in the application or not at all. Fixed with the
owner in the `WHERE` clause, plus a regression test for the stranger case.

### Verified sound

| Area | Finding |
|---|---|
| Auth coverage | Every route guarded. The eleven unauthenticated ones are legitimately public — auth, code redemption (rate-limited), the marketing form (rate-limited), WebAuthn options, and a health probe returning only a timestamp. `cron/heartbeat` validates `CRON_SECRET` |
| Ownership | Every other `[id]` route either calls `assertOwns` or scopes its own SQL by `owner_id` |
| Crypto boundary | No server path touches item plaintext; no API route imports the crypto service; the AI accessor excludes `ciphertext` / `wrapped_data_key` / `kms_key_id` by construction |
| Credentials | Invitations, emergency codes, recipient/verifier codes and recovery codes are all stored as hashes; passkeys store only the public half |
| Audit | No secret material in any `detail` payload |
| XSS | One `dangerouslySetInnerHTML`, safe by construction — a QR SVG built from integer coordinates, with no user input reaching the markup |
| Bundle | Only `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_PRICE_YEARLY_USD` reach the browser |
| Tokens | Signature-verified via `jose`; version/epoch checked server-side per request |
| Revocation | Session epoch enforced in the shared guard, so it applies to every owner route at once |
| Abuse limits | Attempt budgets on every redeemable credential; rate limits on all three public endpoints |
| Estate gate | Refused at four trust boundaries, not merely hidden in a dropdown |

---

## 12. Full beta preparedness — audited 2026-08-12 (UI + functionality + use cases)

Derived live, not quoted: `master` @ `995f797`, **1376 passed / 1 skipped across 139 files**, build
and typecheck clean, every public surface 200, estate at five demo rows plus one real account with
zero orphans, demo circle green and executable.

### UI review — measured, not eyeballed

Screenshots would not reach the filesystem, so the review was done by measuring the DOM, which is
better evidence for the risks that actually mattered after five controls were added to each person
row today.

| Check | Result |
|---|---|
| Horizontal overflow, owner mode @1280 | None |
| Person row height | 109–160px — dense but coherent |
| Reading order on the densest row | who → status → what is missing → what to do. Sound |
| Access mode @390 (phone) overflow | None on any of /standby, /access, /claim, /verify, /break-glass |
| Access mode tap targets | 26–52px |
| **Owner-mode tap targets** | 🔴 **19px on three text-styled controls — below WCAG 2.5.8's 24×24. FIXED (`995f797`).** |

The densest row (a claimed-but-unverified recipient) carries: name and role, the light with its
consequence, email, the fallback warning naming the action, and three controls. It reads in the
right order and the guidance sits immediately above the control that resolves it.

### Functionality — every surface answers

`/api/readiness`, `/api/circle`, `/api/standby`, `/api/audit`, `/api/triggers` all 200 with coherent
state. A five-person fixture spanning every person state rendered correctly: confirmed+passkey reads
settled, confirmed-without-fallback warns, claimed-unverified says its answer would not count,
paper-only reads as a choice, invited-with-code shows its fallback.

### 🔴 Findings this audit produced

1. ✅ **Sub-minimum tap targets** — fixed in `995f797`.
2. ✅ **[A3] fragility — RULED AND SHIPPED.** The audit fixture read green and executable while its
   only counting verifier had neither passkey nor emergency code: the plan worked for exactly as
   long as he kept that phone.

   **Green was NOT made stricter, deliberately.** Gating it on everyone holding a fallback gates it
   on passkey adoption, which will never be 100%, and §4.5 rejects that move by name — *"perpetual
   amber readiness that owners learn to ignore"* is the objection [A3] exists to answer. Green keeps
   meaning *configured and verified*; the fragility is a new **non-fatal** `fragile_quorum` line,
   raised only when the quorum has **no slack** (with slack, losing one device is survivable and
   warning would be the nagging this avoids) and never alongside a fatal blocker. It is excluded
   from `ready`, because every other blocker names something still to set up while this one names a
   plan that is set up and works.

   Live: *"Your plan works, but it rests entirely on one person — and they have no way back in if
   they lose the device they signed in on."*

3. ✅ **§8.2 — CLOSED.** `/audit` now leads with **what happened**, in sentences: when it started,
   who confirmed it was real, what was opened and when, and that it is closed again. Proven live on
   a full episode: *"On 8/12/2026 an emergency was raised, Dr. Alex Chen confirmed it was real, and
   2 things you had set aside were opened. It is closed again now."* — with the items listed and
   repeat opens counted once.

   Derived from the append-only log on every read, so it cannot drift from the record it summarises,
   and placed **above** the hash table rather than instead of it: the chain is the proof and stays
   exactly as it was. Openings attribute positionally, because `vault_item_decrypted` records the
   item and not the release — the only honest link is that the opening happened while that episode
   was open, which is also precisely what the sentence claims.

   The quiet state is the design centre: most owners open this having had no emergency at all, and
   *"Nothing has ever been opened"* beats an empty table.

### Noted, not changed
The demo account now raises `fragile_quorum` — its estate trigger needs both verifiers and neither
holds a passkey or code. That is truthful, and consistent with the seed already leaving one contact
amber so the demo shows its controls rather than only its happy path.

---

## 11. hybrid+6 conformance — audited 2026-08-12

Against the plan **as amended and ratified today** (J7-R1 restated temporally, principle 1 made
conditional, §3.1's verifier row corrected to content-not-shape, §3.2/§5/§6 given the verifier swap).

### The seven invariants (§2)

| # | Invariant | State |
|---|---|---|
| 1 | No secret transmitted at release to a **claimed** contact | ✅ Holds for claimed recipients, and for verifiers who can sign in. 🔴 **This row was WRONG when first written this morning** — it claimed the property for claimed verifiers on the strength of the session path shipping, while `notifyVerifiersForTrigger` went on minting a code for every verifier regardless. Building the door does not stop the credential going out; adaptive minting is what actually closed it, later the same day. Conditional by amendment — a confirmed verifier with no passkey and no authenticator still gets a code, and claim-plus-enrolment is what buys the property per person |
| 2 | No standing credential printed | ✅ Invitations, break-glass and recovery codes are all single-use. §8.1's residual risk is accepted and bounded |
| 3 | Relay never sends a link that signs you in | ✅ Bare `/claim` URL plus a typed code; stated in Terms |
| 4 | Release machine gains zero states | ✅ Still seven edges; `not_counted` is an outcome, not a state |
| 5 | Pull before push — every participant can do their job by visiting the site | ✅ Was **false for claimed verifiers** until today |
| 6 | Derive on read, no second scheduler | ✅ Escalation, `unreachable`, quorum satisfiability and readiness are all read-time |
| 7 | Plaintext never leaves the browser; contacts never see contents; everything audited | ✅ Session decrypt returns a wrapped key for the browser to open, exactly as the token path did |

### The sixteen new flows (§3 of this plan)

**Built and live-proven:** N1 two-stage claim · N3 rung 0 · N4 standby→owner in place (rule 2 holds
by construction: `/start` is inside the authenticated owner group, so a conversion writes under the
existing user id and cannot mint a second account) · N5 break-glass issue **and** redeem · N6
multi-hat switching · N7 verifier acts on a lapsed window · N9 circle degrades on deletion ·
N10 reissue · N11 deferred passkey · N12 device change via break-glass · N13 claim while signed in ·
N14 fingerprint mismatch · N15 resign · N16 reject.

**Not built:** N2 (the [A2] guided setup call is a *packaging* of two acts that both work — issue a
code, confirm a phrase) and N8 (§3.8 event transparency).

### Amendments honoured, not just recorded
J7-R1 is load-bearing in code, not only in prose — though what it now guarantees is narrower than
it was this morning. Its second amendment withdrew *"an unenrolled verifier can always decide by
code"*, because §4.3 had made that decision count towards nothing; what survives is **no enrolment
at decision time**, which holds for every class of verifier because none of them is ever asked to
enrol in order to answer. Principle 1's conditionality is why Phase 0's number is a **security**
measurement rather than only a retention one. §3.1's correction is reflected in the verifier
decision surface and in both legal pages.

---

## 14. User-manual audit — 2026-08-12

Writing `docs/user-manual.html` as a **family-facing** guide, from the production screenshots
already captured, turned out to be a better defect-finder than either the UI review or the security
review. Both of those asked *is this screen correct*. Explaining a journey end to end to somebody
who did not build it asks a different question — *can a person actually complete this* — and three
journeys turned out to have no way in at all.

Method: describe every screen's purpose and steps in plain language, then trace each described path
in the code. A sentence that could not be written truthfully is a defect.

### 🔴 A1 — The verifier decision page never says whose vault it is

`src/app/(verify)/verify/VerifyClient.tsx:182` reads *"Someone has asked for {trigger} access to a
vault you agreed to help protect."* — and `VerifierContext` (`lib/release/verifier-context.ts:19`)
carries no owner name or address at all. It loads `owner_id` and never resolves it.

**J7-R3 requires the decision page to state WHO IS ASKING**, first in its list, before what and why
now. It does not. This is the single highest-stakes screen in the product: a doctor is being asked
to attest that a named human's emergency is genuine, and the screen will not name the human. The
answer is also unanswerable in the multi-hat case §3.7 explicitly designs for — somebody standing by
for two people cannot tell which one this is about.

`getOwnerLabel()` already exists and is already used in the message that brought them here, so the
email names the owner and the decision page does not.

### 🔴 A2 — A verifier who never got their code, or whose code expired, has no path

`/access` has *"My code has expired"* and `POST /api/access/resend`, added because — in the words of
the comment above it — *"the owner being, by the nature of this product, the person in hospital"*.
`/verify` has **neither**, and a verifier code lasts 72 hours.

The reasoning that justified the recipient path applies at least as strongly here: a stalled
verifier does not merely inconvenience themselves, they block the release for everyone. Combined
with the deliverability finding of 2026-08-11 (Outlook files us at SCL 5) this is not a rare branch.
Post-adaptive-minting it is also narrower and easier: the only people who receive a verifier code
are confirmed verifiers with no other way in, which is exactly the population that cannot self-serve.

### 🔴 A3 — The access-request journey (J6) has no entry point in the product

`POST /api/access-requests` authenticates with a **recipient token**. Recipient tokens are only
issued by `/api/access/code`, redeeming a recipient code, and recipient codes are only minted by
`notifyRecipientsOfRelease` — i.e. **after a release is already open**. So the only person who can
ask for access is a person who already has it.

Everything downstream is built and unreachable: the owner's `/challenge` screen, the
challenge-window escalation in `lib/release/escalation.ts`, `notifyOwnerOfAccessRequest`,
`notifyCircleOfRequest`, and J6-R9's covert-access deterrent (*every* contact is told a request was
made). Eleven requirements, an owner-facing page, and a notification set, behind a door with no
handle. No `.tsx` in the product POSTs to it.

The claimed standby dashboard is the obvious home for it — the person is authenticated as
themselves, `resolveStandbyFor` already knows every owner they stand by for, and "ask them to open
it" is the natural sentence next to "nothing is open".

### 🟠 A4 — Everyone who accepted sees an email address where a name should be

`lib/access/standby-resolve.ts:156` sets `ownerLabel: row.owner_email`; the query never selects
`display_name`. So the standby dashboard — the one screen a contact returns to for years — always
shows `someone@gmail.com`, even when the owner has set a name.

The Account screen's own copy states the cost precisely: *"This is how you appear to the people you
trust… the worst possible moment for it to say an email address they do not recognise."*
`formatOwnerLabel()` exists, is tested, and is used by every email. One field in one SELECT.

### 🟠 A5 — The standing sentence can read sage while the box beneath says the vault would not open

`preparednessSentence` renders sage when `assessPreparedness().ready` is true, and `ready` requires
`verifierCount >= 1` where `verifierCount` is `SELECT count(*) FROM verifiers` — **roster rows, any
state**. An owner with full coverage and one named-but-unverified verifier therefore gets a sage
"could reach all N of the things that matter" stacked directly above a clay "This vault would not
open in an emergency."

Not a silent false green — the fatal blocker does render, which is why this is amber and not red.
But the sage box is the standing statement at the top of *every* owner screen and reads as the
verdict. The fix is either to count `ableVerifiers` in `ready`, or to refuse sage whenever a fatal
blocker exists. (Also: *"all 2 of the things"* should be *"both"*.)

### 🟡 A6 — Smaller things the manual could not describe cleanly

- **The Triggers screen speaks engineering**, alone among owner surfaces: *"Release state, check-in
  cadence, and (for demo accounts) the simulate control"*, `RELEASE STATES`, *"Required
  confirmations (N)"*, and the most consequential control in the product labelled **Initiate**.
  Demo vocabulary is on a real owner's screen.
- **The claim screen assumes email** — *"Type the code from the email they sent you"* — while §3.3
  makes delivery owner-brokered on purpose (read aloud, texted, handed over), and Phase 0 is
  measuring exactly that split. The copy contradicts both the design and the instrument.
- **Break-glass dead-ends on the owner**: *"No code? Ask the person who named you"*, who may be the
  reason for the emergency. The truthful alternative — another verifier can still answer — is not
  offered.
- **The audit table names nobody.** The summary above it says "Dr. Alex Chen confirmed it was real";
  the table says `recipient:fc3ee2d3-eb86-40d1-b099-37fde0270656`. The proof is unreadable in
  exactly the way the summary was written to fix.
- **Delegation (J3) has no create UI either** — `/approvals` reads `/api/delegations` and nothing
  writes one. Lower weight than A3 because nothing else in the product references it, but the
  caregiver wedge is the buyer persona.

### Use-case coverage — what the manual added

The 2026-08-12 use-case document had 14. Writing the manual as journeys rather than screens found
that the *reversal* half of several was undocumented, and the manual now covers them: standing down
a false alarm vs cancelling a trigger permanently, marking somebody emergency-code-only, stepping
down from a place, exporting before closing, and cancelling a subscription without losing the vault.
All were built; none were written down.

**Materially missing and NOT merely undocumented: A2 and A3.** Everything else in this section is a
defect in something that exists.

---

## 15. Gap-closure plan — ratified by Steve 2026-08-12

Closes §14. Four waves. **Every fix is one of three shapes this architecture has already
ratified** — nothing new is invented, no state machine, crypto boundary, quorum predicate or module
contract changes.

| Shape | Precedent | Applied to |
|---|---|---|
| Add a field to an existing context | — | A1, A4, A5 |
| A second door onto one authorization core | recipient decrypt; the verifier decision path (§12 item 2) | A3 |
| Reuse the one per-person notify decision | `verifier-notice-class.ts` (§12 item 5) | A2 |

### Steve's rulings

1. **A3 requester bar: `claimed`, not revoked** — NOT `confirmed`. Break-glass redemption sets
   `claimed`, so requiring `confirmed` would exclude the exact person break-glass exists for. The
   request grants nothing by itself: `assertRequestAllowed` caps 3 per 24h, the owner is challenged
   first, and N-of-M **confirmed** verifiers still gate the outcome. The petition is bounded
   downstream, so the bar to make it belongs at the bottom.
2. **No verifier "raise the alarm" control.** Out of scope, and a person who can start a release
   should not also be able to confirm it without a new separation-of-duties rule. Revisit only with
   that rule written first.
3. **Build the J3 delegation create UI now** (wave 4). ⚠️ It grants a second person setup rights
   over a vault, and the consent artifact is the only thing making that legitimate — the same path
   that carried a cross-owner hole until §13. Consent must be presented as **evidence**, and
   J3-R3's in-person and paper routes must be first-class, because the parent being delegated for is
   the person least likely to own a smartphone.
4. **All waves in one pass.**

### Facts verified before planning, not assumed

- **`estate` is NOT user-selectable** (`USER_SELECTABLE_TRIGGER_TYPES`, gated on
  `g2-counsel-opinion`). So `Initiate`'s missing confirmation step is a usability wart today, not a
  safety hole — every selectable trigger is reversible and Stand down exists. ⏸️ **It becomes a
  safety hole the day that gate opens: a confirmation step on Initiate is a PRECONDITION on
  `g2-counsel-opinion`, not work for now.**
- **`assertRequestAllowed` already caps 3 requests / 24h** — A3's abuse bound exists.
- **`/api/access/resend` is a complete template for A2** — rate limit, audit write, owner label,
  constant response, sends to the address on file.
- **Nothing consumes `preparedness.ready`** but the banner colour, so changing what it counts is
  contained.
- **`initiated_by` is structured** (`owner:<id>` · `cron` · `challenge_lapsed:<id>` ·
  `owner_consent:<id>`), so J7-R3's *why now* needs no new data.
- 🔴 **Correction to §14/A1: the verifier EMAILS do not name the owner either** — only the
  `not_counted` branch written today does, while the recipient email always has. A1 is an omission
  across the whole verifier channel, not one page.

### Wave 1 — say who, and stop contradicting ourselves

- **A1** `VerifierContext` gains `ownerLabel` (via the existing `getOwnerLabel`, not a new SQL join —
  one authoritative definition of how an owner is named) and `whyNow` derived from `initiated_by`.
  Rendered on the decision page and added to the verifier emails.
  *Not a leak:* anyone reaching that page already holds the power to confirm the release, which is
  strictly greater than knowing whose it is — and a request that cannot name its subject is
  indistinguishable from phishing, which is the risk J7-R3 exists to remove.
- **A4** `standby-resolve` selects `display_name` and routes through `formatOwnerLabel`. Sweep every
  contact-facing surface for the same defect.
- **A5** pass `ableVerifiers` to `assessPreparedness` **and** refuse sage whenever a fatal blocker
  exists — the second is structural, so no future computation can put a green statement above a red
  one. Plus *"all 2 of"* → *"both"*.
- Demo vocabulary off real owners' screens; claim copy stops assuming email; break-glass copy names
  the true alternative (others can still answer); audit actors resolved **at render time only —
  never rewrite the hash chain**, fall back to the raw id for deleted people.

### Wave 2 — A2, the verifier's way back

Extract `notifyOneVerifier` from `notifyVerifiersForTrigger` so both paths share ONE definition of
what a verifier receives, then `POST /api/verify/resend` cloned from `/api/access/resend`:
classify one person, dispatch, audit, constant response in all four classes. Serves *"I never got
it"* as well as *"it expired"* — the deliverability case is the commoner one.
⚠️ **Known limitation, stated not solved:** a resend to a Resend-suppressed address silently
succeeds and delivers nothing.

### Wave 3 — A3, the door J6 never had

Session path beside the existing recipient-token path on `POST /api/access-requests`; roster row
resolved from the DATABASE (§3.7 rule 1). Control on the standby dashboard under *"Nothing open."*
🚫 **An unauthenticated request form is rejected**: it would let a stranger challenge any owner by
guessing addresses and, per J6-R9, broadcast that to their whole circle — a harassment vector and an
enumeration oracle. The dashboard already has two ways in (claim, break-glass), so the covered
population lands exactly on §8.1's existing boundary, neither widened nor narrowed.

### Wave 4 — J3 delegation, made reachable

Owner-side invite → consent → active, with in-person and paper consent as peers of the link, and the
owner-scoped `recordConsent` from §13 underneath.

### Waves 1-4 — SHIPPED and live-proven 2026-08-12

All four ratified waves are in production. Every claim below was walked against the live site or
asserted against production Aurora DSQL, not inferred from the diff.

| Gap | Shipped | Live proof |
|---|---|---|
| **A1** verifier never told whose vault | `ownerLabel` + `whyNow` on `VerifierContext`, and the owner named in every verifier **email** branch | Context returned "Margaret Chen" and *"They started this themselves"* against production; both mails named her |
| **A2** verifier had no way back | `POST /api/verify/resend` + the affordance on `/verify`, dispatching through the SAME classifier as the release path | Affordance rendered and opened on relaystandby.com |
| **A3** J6 unreachable | Session door on `POST /api/access-requests` + *"Ask … to open it"* on the standby dashboard | Full loop: asked → row `awaiting_owner` with case id → **the owner's `/challenge` screen showed "Jordan Rivera is asking for access"** with the reason and a countdown. That screen had never had anything to show |
| **A4** email where a name belongs | `standby-resolve` routed through `formatOwnerLabel` | Standby card read "Margaret Chen" |
| **A5** sage above clay | `ableVerifiers` into `assessPreparedness`, **plus** a structural guard refusing sage whenever a fatal blocker exists | Banner rendered OCHRE above the clay box, and *"the one thing that matters"* rather than "all 1 of" |
| **A6** copy, demo leak, audit names | Triggers page stops speaking schema; claim stops assuming email; break-glass names the real alternative; audit actors resolved at read time | Audit table showed "You (Margaret Chen)" and "Jordan Rivera" with **Server: intact** — the chain still verifies, because names are display-only |
| **J3** delegation unreachable | Candidate list + create + consent + revoke on `/approvals` | Walked end to end: ask → *not active yet* → consent form with all three methods → *helping you now* → stop |

**Two defects found in this work, by looking rather than by testing.** The resend endpoint hardcoded
`triggerType: 'emergency'`, which would have told a verifier the wrong thing about a caregiver
release — and the trigger type is precisely what tells them how much is at stake. And the delegation
row rendered *"Your helper · not active yet"* because the name lookup was built from `candidates`,
which excludes anybody who has already become one; the name now travels on the delegation.

**One non-finding, recorded so it is not re-investigated.** A fixture signed in and got an empty
vault: `upsertUser` keys on `auth_sub` while `resolveTotpSecret` keys on `email`, so a row whose
`auth_sub` does not match `authSubFor(email)` authenticates and then mints a second user. Not
reachable in production — `signup.ts` already carries a comment demanding they match, and nothing
grants a standby row a `totp_secret`, so email+TOTP is refused for them. The fixture was wrong.

⏸️ **Still open, and deliberately:** a confirmation step on **Initiate** before `g2-counsel-opinion`
opens (harmless today because `estate` is not user-selectable and every other trigger is
reversible); ESP suppression silently swallowing a resend; and §3.8 event transparency.

---

## 16. Beta readiness — reassessed 2026-08-12 (evening)

Derived from a walk, not from the diff. One circle on production was taken end to end in sequence:
appointed a helper → recorded consent → the contact asked for access → the owner was challenged →
the owner started a release → a verifier signed in and confirmed → the recipient opened their plan
with no token in the URL → the owner checked in and it all closed → the record described it. Every
screenshot in `docs/Relay-Use-Cases.pdf` is the state the previous action produced, which is why
they agree with each other.

### Nine defects found, all fixed

Seven were found by **looking at or walking** the product, not by testing it. That ratio is the
finding underneath the findings.

| # | Defect | How it surfaced |
|---|---|---|
| 1 | Access-request `reason` stored and mailed **verbatim** — attacker-controlled text sent from Relay's own domain to the owner's inbox, newlines able to forge the quoted block | Security review of what giving J6 a door had activated |
| 2 | `createDelegation` accepted **any** user id, letting an owner record a consent artifact about somebody never named | Same review |
| 3 | `owner_id` unvalidated → a Postgres cast error surfaced as a 500 | Same review |
| 4 | The demo was **not clean**: `coinbase` is critical and had no rule, so its standing statement sat amber at "3 of the 4 things that matter" while the seed's own comment claimed the critical items were covered — and the demo owner had **no display name**, so every contact saw `demo@relay.test` | Reading the demo's own readiness output |
| 5 | `/circle` **argued with itself**: "nothing would open" beneath a sage banner saying the plan works, and it counted an emergency-code-only contact as somebody to chase — the exact thing §8.1 forbids | Looking at a circle that contained one |
| 6 | The fallback nudge painted in **clay**, the colour reserved for what cannot be undone, at 12px | Measuring computed styles |
| 7 | "**A** emergency release" on the decision page — the defect the notification templates carry an `article()` helper for | Walking to the decision page |
| 8 | The decision page's timeline said "No response, so we started asking" directly under "They started this themselves" | Same walk |
| 9 | **J7-R6 violated**: "Yes" was a filled button and "No" an outline — equal effort, unequal prominence, on the screen whose stated failure mode is rubber-stamping | Looking at the rendered page; every measurable property was already equal, which is why measurement never caught it |

### Two claims corrected, because the product could not keep them

- **The grace window does not exist.** The owner's confirmation email promised "release will complete
  when the grace window elapses… check in now to cancel", while `GRACE_WINDOW_MS` is **0**,
  deliberately and invariant-tested. That invited the owner into a race they lose. What is true is
  stronger and is now what it says: they are protected by *reversibility*, not by a delay.
  ⏸️ Whether the window should be non-zero stays the product decision the constant's comment defers.
- **"Nothing was opened" was said when somebody had looked.** `recipient_dashboard_viewed` was in the
  log; the summary ignored it. §8.2's failure shape one level in — the record holds the fact, the
  experience omits it. ⚠️ `incident-record.ts` had **no test file at all** until this pass.

### 🔴 The one gap that is not a defect: J3 is half a journey

Wave 4 made **appointing** a helper reachable. The helper still has nowhere to act:
`proposeApproval` is called by **nothing**, and no screen passes `?ownerId=`, so a delegate cannot
work on somebody else's vault and the owner's approvals queue can never fill.

**So appointing a helper currently achieves nothing.** That is a decision, not a bug fix: either
build the delegate's acting surface, or stop offering the appointment until it exists. Recorded in
the use-case PDF under stated coverage limits rather than left to be discovered.

### Verdict

**Beta-ready for the owner and contact journeys; not for the caregiver wedge.** Everything a person
does for themselves or for somebody who named them was walked end to end on production and works,
including every reversal. The wedge that the commercial argument rests on — an adult child setting
up a parent's vault — is half-built and now honestly labelled.

⏸️ Also open, deliberately: a confirmation step on **Initiate** before `g2-counsel-opinion` opens;
ESP suppression silently swallowing a resend; `/import` and `/start` reachable but not re-evidenced
this pass; §3.8 event transparency.

---

## 17. J3 closed, and the plan for what is left — 2026-08-12

### The delegate surface: shipped and walked

The delegate half of J3 was a security layer with nothing above it. `enqueueApproval` was called by
nothing, `GET /api/vault/items` took no `?ownerId=`, and nothing told a person they had been made a
helper — so appointing one achieved nothing. All four gaps are closed and the loop was walked on
production, end to end:

owner appoints → records consent → **helper is told on their standby dashboard** → opens the
workspace → **adds an encrypted item to somebody else's vault** → **suggests a person** → the
suggestion lands in **the owner's queue, which had rendered an empty state since it shipped** →
owner approves → the recipient is created through the same validated path an owner would use.

Verified in the database afterwards: delegate provenance on the item, `delegate:<id>` on both the
item and the proposal in the audit log, `owner:<id>` on the consent and the approval — which is
J3-R8's "what was done on your behalf", derived from the chain rather than a second log.

**The boundary was probed from inside the helper's own authenticated session**, not asserted:

| Probe | Result |
|---|---|
| Helper's own vault | 0 items — untouched |
| Helped vault via `?ownerId=` | **only their own entry**; the owner's private item absent |
| Ciphertext / wrapped key in the response | none |
| A vault with no delegation | **403** |
| `/api/circle?ownerId=` | param not honoured — no leak |
| `/api/triggers?ownerId=` | no delegate path exists at all, by design |

⚠️ **The workspace lives in the `(access)` route group, not `(owner)`.** The owner group carries
vault, circle, triggers and account in its chrome; a helper's workspace there would mean every one
of those pages remembering it might be rendering somebody else's data — one forgotten check from a
privilege leak. Here a helper cannot reach a trigger screen because it is not in the tree.

### Remaining items, in the order they should be taken

**1. Send the first real invitations.** ⏱️ hours · owner: Steve · **the only one that is not code.**
Phase 0 is still N=0, and the security argument now rests on that number: principle 1 is conditional
on claim conversion, and adaptive minting's premise is that verifiers actually reach `confirmed`. No
amount of further building substitutes for one real circle. Everything below is cheaper to decide
once a real number exists.

**2. Rule the grace window.** ⏱️ one decision · owner: Steve. `GRACE_WINDOW_MS` is 0 and the copy
now tells the truth about it. The question the constant's own comment defers is still open — *how
long should an owner get to stop a false alarm?* Nothing is broken either way; it is a product call,
and the honest wording buys time to make it rather than forcing it.

**3. A confirmation step on `Initiate`.** ⏱️ ~1h · **precondition on `g2-counsel-opinion`, not
optional.** Harmless today because `estate` is not user-selectable and every other trigger is
reversible. The day that gate opens, one click becomes irreversible with no confirm step. Wire it
before, not after.

**4. Deliverability, which no product change can fix.** ⏱️ ~half a day. Outlook files us at SCL 5,
and a resend to a suppressed address succeeds and delivers nothing. The verifier resend narrowed the
blast radius; it did not fix the channel. Needs DMARC/alignment work and a suppression check
surfaced to the owner, and it gates the honesty of every "we told them" claim in the product.

**5. `/import` and `/start` evidence.** ⏱️ ~1h. Both reachable, neither re-photographed this pass.
CSV import is a real owner journey and should carry evidence before beta.

**6. Policy proposals, or removing the scope.** ⏱️ ~2h. A helper holds `policies:propose`, no
surface offers it, and `decideApproval` claims a `policy` approval without applying one. Either
build it or drop the scope — a granted capability that silently does nothing is the shape of thing
this audit keeps finding.

**Deliberately not doing:** §3.8 event transparency, `email_secondary`, [A2]'s guided-call UI, and
helper import. All additive, none blocking, and each one is cheaper to decide after item 1.

### Items 3, 5 and 6 — done 2026-08-12

**3. `Initiate` is guarded.** The most consequential control in the product was one unguarded click
on a button labelled with a word that does not say what it does. The confirmation states the
CONSEQUENCE rather than asking "are you sure" — a question nobody reads — and reversible and
irreversible triggers get different sentences and different weights, because they are different acts
that happen to share a button. The irreversible branch asks the trigger type to be **typed**,
matching what closing an account already demands: one click after a warning is not a decision;
finding the keyboard is. Walked on production, including backing out, which left the trigger ARMED.
⏸️ Still a precondition on `g2-counsel-opinion`, not an improvement.

**5. `/import` and `/start` evidenced** — UC-28 and UC-29. Import was *exercised*, not photographed:
a three-row LastPass export previewed and imported on production, all three items in the vault
afterwards. Worth recording: the preview shows service, URL and username and **no passwords**, which
is right — it is the one screen where a shoulder-surfer would see the whole file at once.

**6. `policies:propose` removed rather than built.** It was granted to every helper, offered by
nothing, and could not be applied — `decideApproval` claimed the row, marked it approved, wrote an
audit entry saying so, and left `applied` false. An owner could answer a question about who reaches
their vault, be told it was granted, and have nothing change.

Dropped because it does not fit the read boundary it would live inside: a policy joins an item to a
recipient and a helper can see neither, so building it honestly meant showing them the owner's
circle — widening the boundary in the place the product is most careful, to serve a feature nobody
asked for. An unappliable approval can now no longer be approved at all, only rejected, and the
guard runs BEFORE the claiming UPDATE. `createDelegation` also writes the scopes instead of
inheriting migration 009's default, which still lists five.

### 🔴 The same defect, three times, in five days

Found by looking at the confirmation written an hour earlier: *"Everyone you named to confirm **a**
emergency will be asked whether this is real."*

| When | Where | Fix applied |
|---|---|---|
| 08-08 | Email subject line, during a real emergency | private helper in `notifications.ts` |
| 08-12 | Verifier decision page | **second** private helper, four lines from a comment noting the first |
| 08-12 | Release confirmation, hours later, same hand | — |

Copying the fix is what made the next occurrence certain. Two of the five trigger types begin with a
vowel, so every template interpolating one is a site this recurs at. Both copies are gone,
`lib/text/article.ts` is the only answer, and **a test walks `lib/` and `src/` and fails if anyone
declares another one** — so the fourth occurrence is a failing suite rather than a phishing-shaped
sentence in somebody's inbox.

**Remaining from §17: items 1, 2 and 4** — send the first real invitations, rule the grace window,
and deliverability. None is blocked by anything above.

### Item 2 ruled, and item 1's blocker removed — 2026-08-12

**Item 2: the grace window is per-trigger.** One constant was the mistake — picking a value always
felt arbitrary because it was being asked two questions with opposite answers. Reversible triggers
get **0** (the owner is already protected: `processCheckin` reverses PENDING, GRACE and RELEASED, and
every path here has already given them a chance to say no). Estate gets **72h**, because
`processCheckin` blocks estate — permanent once released — so the window is not a delay, it is the
entire protection. Matches `CHALLENGE_WINDOW_SECONDS.estate`, since both answer the same question.

⚠️ Only safe because `resolveElapsedGrace` shipped on 08-08. The invariant test was still asserting
`=== 0` on the strength of a limitation removed four days earlier.

Two pieces of copy followed, one of them written the same morning: the confirmed-release email said
"check in and it closes again", **false twice over for estate** — it does not open at once and
checking in will never close it. That is the same false promise that message was rewritten to
remove, arriving from the other direction.

### 🔴 Item 1 was blocked by a missing half of the assurance model

Writing the invitation text meant writing the call script, and the script could not be written
truthfully. The owner's confirm control says, verbatim, *"They see the same four words on their own
screen."* `fingerprintFor` was imported by `/api/circle` and **nothing else**.

So the owner was instructed to make a **comparison the other side could not take part in**. A contact
asked "do these match?" while holding nothing says yes — the rubber stamp the control exists to
prevent, on the one step the whole quorum model rests on, since `confirmed` is what makes an answer
count. Half the assurance model shipped and the other half was a sentence about it.

Now derived on the contact side through the same pure function from the same three values, shown only
while they are `claimed`. **Do not send invitations from a deploy older than this.**

### Item 1 is now unblocked

`docs/first-invitations.md` has the recipient text, the verifier text, the call script, the failure
branches, and what to read afterwards. It is Steve's to send — the only remaining item that is not
code, and the one the security argument is waiting on.

### Step 1 — a customer failure now produces a signal (2026-08-12)

The scheduler had a dead-man's switch (J5-R7); the **customer path had nothing**. 27 `console.error`
calls writing to logs nobody watches, no error boundary anywhere, and a mistyped URL returning
Next's bare default. A real person hitting a real failure produced silence, and the only way to
learn of it was to go looking.

| Piece | What it does |
|---|---|
| `src/app/error.tsx` | Written for the CONTACT, not the owner — one of the two readers is in a hospital corridor. Leads with the fear: nothing lost, nothing opened. Reports itself. |
| `src/app/global-error.tsx` | When the root layout itself fails. Every value inline, because a fallback that depends on the broken thing is not a fallback. |
| `src/app/not-found.tsx` | Does not assume an owner. Names the three places somebody who mistyped an address was probably trying to reach. |
| `lib/ops/incident.ts` + `POST /api/incident` | Records, then alerts — deduped 15 min, capped at 5 per window. |

**⚠️ The digest travels; the message never does.** React produces a production digest for exactly
this, and an exception thrown near the crypto path could carry anything. The endpoint strips query
strings (`/claim?token=…` would otherwise copy a live ticket into an email), refuses an over-long
digest, and ignores every field it does not know.

**Live-proven on production**, not asserted:

```
[incident] mode=access path=/claim   digest=live-probe-2   ← ?token=SHOULD-NOT-APPEAR stripped
[incident] mode=public path=unknown  digest=none           ← junk defaulted safely
[incident] mode=access path=/standby digest=live-probe-1
```

A probe carrying a password in three plausible field names (`message`, `stack`, `error`) arrived with
none of them. All three requests returned an identical 204.

✅ **`OPS_ALERT_EMAIL` set to `sgharlow@gmail.com` in production, 2026-08-12.** Incidents are now
recorded *and* pushed.

⚠️ **Setting it was not enough on its own.** Vercel injects environment variables at build time, so
the deployment already serving had been built without it and would have gone on silently taking the
no-address branch. The variable only took effect on the next build — which is the ordinary shape of
"configured but not live", and worth remembering the next time a variable is added to fix something
urgent.

⚠️ **Honest limit of this proof.** The endpoint is live-proven and the boundary is unit-tested; that
the boundary *calls* the endpoint on a real crash is verified by reading, not by crashing production
on purpose. The first genuine error will confirm it — which is the point of shipping it before the
invitations rather than after.

---

## 18. Beta reassessment — 2026-08-12, third sweep

The first two sweeps audited surfaces that had been stable for days. This one targets what the last
few hours produced, on the principle that **the newest code is the least-walked** — several pieces
were live-proven individually and had never been exercised together.

### Verified working, by walking it

| Check | Result |
|---|---|
| **The assurance model, both sides** | Contact's screen and owner's screen both read `granite forest mitten granite`. Owner pressed "The words matched" → person flipped to verified → readiness flipped from "plan cannot run" to executable. **This is the first time the verification call has been possible at all.** |
| `Initiate` confirmation | States the consequence, backing out leaves ARMED, confirming advances |
| **Grace ruling did not break the core loop** | Reversible emergency reached GRACE 0/1 exactly as before the per-trigger change |
| [A3] next action | Correctly named "Confirm a recipient who has already claimed" |
| Layout, 1280 and 390 | No horizontal overflow on `/helping`, `/standby`, the 404 |
| Colour semantics | No clay on any non-permanent thing on the new surfaces |
| Console | Clean on `/helping` |

### 🔴 A finding about my own method, not the product

**The QA walks have been generating hard bounces on a SHARED Resend account.** Fixture addresses use
`@relay.invalid` — a reserved TLD that cannot receive mail — and firing a trigger emails every
verifier. Resend *accepted* those sends (no `[notify] failed` lines), so the bounce happens
downstream, invisibly to the app.

Roughly 5–10 bounces across today's walks. Each individually trivial; the concern is sender
reputation on an account **shared with report-bridge**, where the cost lands on a different project.

**Fix for future walks:** fixture addresses become `sgharlow+relayqa1@gmail.com` and similar —
deliverable, no bounce, and the mail is inspectable. Script-based proofs already stub the mail
boundary; it is only UI walks that cannot. ⏸️ Worth a glance at Resend's bounce rate before the real
invitations go out.

### Built, still not reachable

| Thing | Consequence |
|---|---|
| `delegateActivityDigest` | **J3-R8 has no surface.** An owner cannot see what their helper did — and `resolveActorNames` names owners, recipients and verifiers but **not delegates**, so a helper's actions show in the audit table as a raw `delegate:<uuid>`. Both halves were built today and left unconnected. |
| `remainingRecoveryCodes` | An owner cannot see how many recovery codes are left. They are the only way back if the authenticator is lost, so "down to your last one" is currently a silent cliff. |

### Not a hole, stated precisely

`bumpSessionEpoch` has no caller, so there is **no "sign out everywhere"**. The epoch machinery it
belongs to *is* wired — `readSessionEpoch` on sign-in, `isSessionCurrent` on every authenticated
request — and it closes the defect it was built for: a session for a deleted user is denied. Every
revocation that matters is enforced at the DATA layer instead (a revoked contact resolves to nothing
regardless of their token), which is §3.7 rule 1 working as designed. A missing convenience, not a
gap.

### Cosmetic, recorded not fixed

Fingerprint phrases draw with replacement, so ~9% repeat a word — the fixture drew `granite forest
mitten granite`. Entropy is unaffected and both sides still match, but a repeat works against the
word list's stated purpose (*"chosen to survive a bad phone line"*). Changing a security-control
derivation mid-reassessment is the wrong moment; it is a ten-line change whenever it is wanted.

Fixed during the sweep: the "This is me" checkbox rendered 13×20, squashed by its flex row, on the
most consequential control a helper has. ⚠️ **Not an accessibility failure** — the input sits inside
its label, so the real target was already 294×122 and clicking the text toggles it. The affordance
looked broken; reaching it never was.

### Verdict, unchanged in shape

**Beta-ready.** Every journey — owner, contact, verifier, recipient, helper — is walked end to end on
production including reversals, the assurance step now genuinely works on both sides, failures are
visible, and backups are confirmed running. What is left is not engineering: **nobody outside this
room has used it**, and that is the number the whole security argument rests on.

### The two unreachable capabilities, surfaced and tested — 2026-08-12

Both were found by the third sweep as functions written, tested, and called by nothing.

**J3-R8 — "what was done on your behalf."** `delegateActivityDigest` existed only as a function, so
the single thing that makes handing somebody setup rights *reviewable* rather than a leap of faith
was invisible. Now attached per delegation and rendered on `/approvals`, **beside "Stop them
helping"** — the evidence belongs next to the decision it informs. Derived from the audit chain
rather than a second log, as the function's own header requires: a separate table could drift, and
then two sources would disagree about what a helper did.

And the half that was mine: `resolveActorNames` named owners, recipients and verifiers but **not
delegates**. The helper workspace and the actor resolver were built the same day and left
unconnected, so the one actor an owner is most likely to be curious about — somebody else working
inside their vault — rendered as a raw `delegate:<uuid>` while everybody else had a name.

**`remainingRecoveryCodes` — a silent cliff.** Codes are consumed one per use and are the only way
back when the authenticator is gone, and the product said nothing as the sheet ran down. Somebody
could be on their last one and learn it at the moment it stops mattering. Now on the account page,
coloured by how much room is left, because "1 left" in the same grey as everything else is a fact
nobody acts on. A count, never a code.

**Walked on production**, with a helper who had actually done things:

| Check | Result |
|---|---|
| Helper adds an item, suggests a person | Both landed |
| Owner sees "What they have done" | "Added something to your vault" · "Suggested somebody who would step in" — plain language, no raw action names |
| Audit actor | **"Jordan Rivera (helping you)"**, raw id beneath as the verifiable record, chain intact |
| Recovery count | 4 issued, 1 spent → **"You have 3 left."** |
| The squashed checkbox | now 20×20 |

Incidentally confirmed: readiness noticed the helper's item and reported it uncovered — *"Missing:
Water rates"* — so a helper-added item enters the owner's coverage arithmetic like any other.

⚠️ **Fixture addresses are now `sgharlow+relayqa-*@gmail.com`**, not `@relay.invalid`, closing the
bounce problem the third sweep found. Deliverable, no bounce, and the mail is inspectable.

---

## 19. Demo, security and UI — fourth pass, 2026-08-12

### The demo: two of them, and only one is public

Checking "the demo" meant first establishing which one.

| | What it is | State |
|---|---|---|
| `/demo` | The **public** guided tour a prospect sees. Static fixtures, no auth, no DB, no writes. | ✅ Clean, with one fix below |
| `demo@relay.test` | A seeded 25-item account with `is_demo_account = true`, which gates `/api/demo/simulate`. | ✅ Data clean — **and nobody can sign into it** |

**The seeded account has no TOTP secret, no passkey, no credential of any kind.** `resolveTotpSecret`
returns null for it, so email+TOTP refuses. That is almost certainly deliberate and correct: **the
repo is public**, so a seeded secret would publish a working credential to a production account.
Recorded so nobody "fixes" it by committing one.

⚠️ A consequence worth knowing: with no way in, `/api/demo/simulate` is unreachable in production
too, and the readiness/coverage tidying done to that account earlier today improves data that only a
local developer will ever see through the UI.

### 🔴 The public demo was selling what the Terms disclaim

Four of the eight sample items in the tour route to an **`estate`** trigger. `estate` is excluded
from `USER_SELECTABLE_TRIGGER_TYPES` pending `g2-counsel-opinion`, and `/terms` says in as many
words: *"Estate and inheritance functionality is not offered."*

**This is the same contradiction already closed once in `/rules`**, which used to render its dropdown
from the unfiltered list and so offered a permanent capability the product disclaimed. The dropdown
was fixed; the tour was not, so the funnel page kept selling it.

Fixed by saying so rather than by deleting the estate items: the sequence is real and is what the
product does once counsel clears it, and a prospect is better served by an honest "not yet" than by a
demo quietly edited to match a temporary limit. ⏸️ Retargeting those items instead is a commercial
call, not a technical one.

### Security review — the surfaces added since §13

| Route | Guard | Note |
|---|---|---|
| `POST /api/incident` | rate limit only | Unauthenticated **by necessity** — the caller is a page that just failed. Constant 204, bounded fields, strips query strings, ignores unknown fields |
| `GET /api/helping` | session | Returns only vaults this user helps with; the owner ids it then reads with come from that scoped query, never from user input |
| `POST /api/approvals` | session + `resolveActor` + `requireScope` | Refuses an owner queuing to themselves, and a delegate without `people:propose` |
| `GET /api/account/recovery-codes` | session | A **count**, never a code |

**Every route in the app carries a guard.** Four have none by design and each is right: NextAuth's own
handler, a health probe returning only a timestamp, the token-authenticated invitation paths (where
the token *is* the credential, with `failed_attempts` enforcing an attempt budget — verified), and
pre-auth WebAuthn options.

Also re-checked: the contact-side fingerprint derives from the session user against a query scoped to
`claimed_user_id`, so nobody can obtain a phrase for a binding that is not theirs; the delegate
activity digest and the delegate name lookup are both owner-scoped.

### UI review — the surfaces added since §16

Measured at 1280 and 390, using the **effective label hit area** rather than the input box, since
several controls sit inside their labels.

- **No horizontal overflow** anywhere.
- **No undersized targets.**
- **Clay only on the account-closure box** — the one genuinely irreversible thing on those screens.
- The singular case renders properly: *"You have one left — the next lost phone would lock you out
  for good."*

### Use-case coverage

34 documented in `docs/Relay-Use-Cases.pdf`, all walked on production. The two capabilities the third
sweep found built-but-unreachable are now surfaced and tested (UC-32, UC-33). The one remaining
uncalled function, `bumpSessionEpoch`, is a missing convenience rather than a gap — every revocation
that matters is enforced at the data layer.

**Nothing is now built and unreachable.**

### The demo shows only what is buyable — 2026-08-12

Retargeted rather than annotated, on Steve's call. `estate` is excluded from
`USER_SELECTABLE_TRIGGER_TYPES` pending `g2-counsel-opinion` and `/terms` says it is not offered, so
a tour advertising it was selling a capability the product disclaims.

Now a **caregiver arc**: `Alex (executor)` → `Alex (daughter)`, the letter of instruction is care
wishes rather than instructions to an executor, and the photo archive moves to her. That is the wedge
the product is actually sold on, and a trigger a visitor can choose today. The table still shows
**two recipients under two triggers**, which was the real point of the estate arc — scoped access
differs by person *and* by condition.

| Item | Goes to | Trigger |
|---|---|---|
| Primary email · Password manager · Checking account · Utilities | Sam (spouse) | `emergency` |
| Health & home insurance · Letter of instruction (care wishes) · Mortgage & deed · Photo archive | Alex (daughter) | `caregiver` |

**The same false offer appeared twice on `/caregivers`** and is fixed there too. `/how-it-works`
already excluded estate deliberately and says Relay is not a will — which is what made the other two
stand out.

⚠️ **The first retarget missed one.** Probing the live page afterwards found *"Estate releases, by
contrast, are permanent by design"* still in the release-timeline **prose** — same offer, different
shape, surviving because grepping the items did not reach the copy.

**Three guards, because this contradiction has now shipped twice.** `/rules` used to render its
dropdown from the unfiltered list and offered the same thing; that was fixed and nothing connected
the fix to the tour. Now: every demo item must use a selectable trigger, the prose must mention no
unbuyable trigger, and the tour must keep more than one recipient and more than one trigger so a
future fix cannot quietly flatten what the table exists to demonstrate.

Verified live: no `estate` and no `executor` anywhere on `/demo` or `/caregivers`.

---

## 20. Release audit — 2026-08-13, fifth pass

Scope set by Steve: completeness, correctness, security, the documented journeys,
the user's guide, the wiring, the UI, and the spec. Method deliberately **not** a
re-read of §§13–19 — those passes were thorough and their findings are closed.
This one went at the places a self-audit structurally cannot reach: the repo's
**public git history**, the **production database**, the **served artifacts** as a
browser actually loads them, and the code written in the last few hours, on §18's
own principle that the newest code is the least-walked.

Baseline before touching anything: build, `tsc --noEmit`, lint and the full suite
all green. Five findings, all evidenced against production rather than inferred.

### 🔴 F1 — Relay was an open mail relay for anyone who signed up

The single worst finding, and it was assembled entirely from parts that were each
individually fine.

- `POST /api/verifiers` had **no entitlement cap**. `TIER_LIMITS` had no
  `verifiers` key at all — not a decision, an omission — while its sibling
  `/api/recipients` had been capped since the tier was written.
- `POST /api/invitations` had **no rate limit and no daily ceiling**, and sends a
  real message per call.
- `BETA_INVITE_CHANNEL='owner'` does **not** cover it. That flag governs
  create-time; the invitations route takes its own `deliveryChannel` and defaults
  it to `email`.
- A contact's `name` was validated by `isNonEmptyString` alone — no length, no
  newline handling — and lands in the message body. The owner's `display_name`
  was length-capped but only `.trim()`-ed, and lands in the **subject line**.

Signup is self-serve and free, so the whole sequence was available to anybody:
register → name N people → invite each → repeat. The product would emit mail with
valid SPF and DKIM, to addresses of the sender's choosing, with the sender's text
in the subject and the opening line. On the Resend account **shared with
report-bridge**, where the reputation cost lands on a different project.

The same class was closed once already, on the access-request `reason` (§16
finding 1). It was closed for the field somebody thought of as attacker-controlled
and left open on the two fields nobody did, because a *name* does not read like
hostile input.

**Fixed:** `verifiers: 4` on the free tier (Steve's call — same number as
recipients, and a real N-of-M quorum runs at one or two); `lib/notify/invite-budget.ts`,
a 20-per-owner-per-24h ceiling counted from `audit_log` in the same shape as the
AI meter, reserved inside `inviteAndNotify` because **three** callers reach the
send and a guard in the route would have bounded one; a per-owner burst limit on
the route; and `cleanPersonName` as the one definition of what a name may be,
applied to both people modules and to both doors onto `display_name`.

### 🔴 F2 — One environment variable was a master key over every contact account

`resolveTotpSecret` fell back to `process.env.TOTP_SECRET` for **any** row with a
NULL secret. Its header said the fallback existed "ONLY for accounts that predate
self-serve signup". Nothing in the product writes a `totp_secret` except
`signup.ts` — every contact account is created by `upsertUser` (claim,
break-glass, the seed) and stays NULL **forever**. So the covered population was
not one frozen legacy account; it was every person who has ever claimed a standby
role, growing with the beta. Sign-in is email + TOTP with no password, so that
variable plus an address was a complete credential.

Measured on production: **five of six accounts** resolved through the fallback,
including `demo@relay.test` — 25 items, two people, and the `is_demo_account` flag
that gates `/api/demo/simulate`. Zero passkeys are registered.

**Three written claims depended on the opposite being true**, and all three were
false: this file's own header; §14's recorded non-finding (*"nothing grants a
standby row a totp_secret, so email+TOTP is refused for them"* — the reverse:
because nothing grants them one, it was **accepted**); and §19's *"nobody can sign
into"* the demo account, which was the entire argument for why seeding no
credential was safe in a public repo.

**Fixed by removing the fallback**, not by correcting the prose — the claims are
now true rather than softened. `generateTotpCode`/`validateTotpCode`, the two
exports that read the shared secret, had **no production caller** and are gone
too; their RFC 6238 known-answer vectors moved onto the per-user functions
sign-in actually calls, which is where that coverage belonged. `TOTP_SECRET` is
named in `.env.example` as retired rather than deleted, so anyone who finds it
still set knows it is inert.

### 🟠 F3 — The demo account was scheduled to perform a real release

`demo@relay.test` is live, `status='active'`, holds **two ARMED release_states**,
runs a 30-day check-in interval and was last active 2026-08-13. So around
**2026-09-12** the hourly sweep would have found it overdue and driven both
triggers ARMED → PENDING → GRACE, unattended. That mails the owner alert to
`demo@relay.test` and the verifier notices to `achen@example.com` and
`sam@example.com` — reserved domains that cannot receive mail, so hard bounces on
the shared sender. Nobody could have stopped it: a demo account has no credential,
so no owner exists to check in.

§18 found this exact harm in the QA walks and fixed it for the **fixtures**. The
**seed** was never changed, and the seed is the copy that ships.

**Fixed in both layers, per Steve:** `runHeartbeatSweep` excludes
`is_demo_account` in the WHERE clause, so no fixture can ever drive the release
path on a schedule; and seeded contacts move to deliverable sub-addressed inboxes
(`demoAddress()`), with a test that fails on any seeded address in a reserved
domain. The owner's own address stays `demo@relay.test` deliberately — it is the
identity `auth_sub` derives from, not a channel.

### 🟠 F4 — Every screenshot in the shipped user's guide was broken

24 × 404 on `/guide`, found by opening it and reading the console. The rewrite
that makes the short URL work (`/guide` → `/guide/index.html`) does not change
the browser's address, so the document's base stays `/guide` and a relative
`src="screens/x.png"` resolves to `/screens/x.png`. The files were at
`/guide/screens/x.png` returning 200 the entire time.

Nothing failed loudly. Build green, page renders, text intact, suite green —
because every check on the guide reads its **words** (`beta-flag.test.ts` reads
§2.7) and none asked whether it could **draw**. This is the one document written
for the non-technical half of the audience, and `/guide` is the URL that goes in
an invitation.

**Fixed:** all 24 references made absolute, plus `lib/ops/guide-assets.test.ts`,
which asserts both halves — every reference resolves from the site root, and every
referenced file exists on disk. Proven by planting a relative reference and
watching it fail.

### 🟡 F5 — Report-only was costing protection that was free

CSP shipped entirely report-only, and the reasoning for that is correct — an
enforcing `script-src` needs nonces, which needs Node-runtime middleware on every
request. But that is an argument about `script-src`, and it had been applied to
four directives it does not describe. `base-uri`, `object-src`, `frame-ancestors`
and `form-action` have nothing to do with Next's inline bootstrap and cannot blank
a page; `frame-ancestors` was already being enforced in its older spelling by
`X-Frame-Options: DENY`, which has been live and breaking nothing.

**Fixed as a split, per Steve:** an enforcing header carrying exactly those four
(every form in the app verified as an `onSubmit` handler with no `action`
attribute first), and the full policy still report-only for the script directives.
The guard that matters is the second one: a test fails if the enforcing header
ever grows a directive that could white-screen the product, because that is a
one-word change somebody could make while tidying two headers into one.

### Recorded, not fixed

- **`/api/csp-report` writes to stderr and nothing else.** The "observe real
  traffic, then enforce" plan therefore has no observer, which is the
  log-nobody-watches pattern this codebase has fixed everywhere else. Steve chose
  not to route it through the incident alerter for now; the enforcement decision
  needs somebody to read Vercel logs deliberately.
- **Four TOTP secrets sit in the public git history** (`scripts/scratch-*-secret.txt`,
  `_code.ts`) from the walks of 08-07 and 08-12. **Not a live exposure** — checked
  against production, none of those secrets belongs to any existing row, and the
  accounts were cleaned up. The `.gitignore` entries that now block `_*.ts` and
  `scripts/scratch-*.ts` were added after each incident. Worth knowing that the
  history is not clean; not worth a rewrite for spent credentials.
- **PROJECT.yaml carries 2026-08-14 dates written on 2026-08-13** — UTC where the
  rest of the repo uses local. Cosmetic, but it is the file the claim-discipline
  rule names as the source of truth, so dates there should agree with git.
- `/favicon.ico` 404s. `/icon.svg` exists and is what the HTML links, so browsers
  get an icon; only the default fallback probe misses.

### What was checked and found sound

Route-by-route auth matrix across all 70 handlers — every route carries a guard,
and the six with none are correct (NextAuth's own handler, a timestamp-only health
probe, the token-authenticated invitation paths, pre-auth WebAuthn options, and
the two unauthenticated-by-necessity reporters, both rate-limited and both
constant-response). `npm audit` clean on production dependencies. `.gitignore`
correctly excludes `.env*.local`. Every public surface returns 200 on production
and the scheduler ledger was 29 minutes fresh. The AI seam is metered. The
estate-withdrawal commits from earlier today are consistent across enums, routes,
demo fixtures, Terms, Privacy and the guide.

### Verification

`npm run build`, `npx tsc --noEmit`, `npm run lint` and the full suite all green
after the changes — derive the count with `PROJECT.yaml derived.test_count`
rather than trusting a number quoted here, which is the rule this section was
nearly the next violation of.

Tests were added for every finding, and none removed except the three that pinned
the retired shared-secret delegation — which had become tautologies once the path
was gone, each comparing an expression with itself.

⏸️ **Not yet on production.** Every fix above is in the repository; F4 in
particular only stops being a defect for readers once it deploys.

---

## 21. The production-bar pass — 2026-08-14, ten iterations

Scope set by Steve: take the product from pre-beta to a production bar across
functionality, security, UX polish, documentation, journeys, and spec
conformance, in at most ten iterations, committing each, breaking nothing the
architecture ratifies. Method: a six-lens multi-agent audit (UI consistency,
journey gaps, security residuals, documentation truth, spec conformance,
release engineering) with adversarial verification of the high findings, plus a
live walk of the signed-in owner screens the agents could not drive. 39
findings; 7 highs confirmed by verifiers, 2 more highs adjudicated by hand, and
the mediums triaged into the iterations below or the reopened debt register.

### What the ten iterations shipped, in one line each

1. **Sign-out exists** (neither mode had one — a grep for signOut returned
   nothing), six owner tabs get titles, a 401 stops impersonating an outage on
   /standby and /helping.
2. **A claimed recipient no longer receives a sign-in token at release** — the
   skip-sentinel threw into the same catch as real failures and the fallback
   mailed a live JWT to exactly the person hybrid+6 promises gets nothing
   secret. And the absolute "never sends a link that signs you in" promise,
   falsified by the product's own recorded last resort, becomes the rule that
   is true in every branch: *a real Relay message never asks you to click and
   then enter anything*.
3. **The KMS unwrap oracle is closed** — both paths decrypted whatever blob the
   body carried under the shared CMK; the server now loads the blob from the
   authorized row, and the token gate gains the trigger_type scope the session
   gate always had.
4. **The two stress screens fail out loud** — challenge and approvals swallowed
   failures, wedged their buttons, and a failed load impersonated the
   all-clear; and the challenge screen's filled "Yes" contradicted its own
   J6-R3 header, the same defect J7-R6 fixed on the verifier screen.
5. **The documents stop describing a product that no longer exists** — README
   sold estate on the public repo face, the FAQ promised a legal opinion that
   will never be sought, e2e-verification.md instructed a sign-in that cannot
   succeed, CLAUDE.md described the retired lint setup.
6. **The dead-man's switch rings its bell** — the sweep armed releases in total
   silence (the Req 4.4 notifier had zero callers; a comment claimed
   otherwise), the deny-halt threshold was arithmetically unreachable for
   ordinary rosters (M counted the roster, answers only come from the
   eligible), and resolveElapsedGrace guessed the version its tokens carry.
7. **The operational surface** — the guide gets a viewport (it rendered
   desktop-width on the phones of the audience it exists for) and lazy images;
   robots.txt catches the 13 routes it had drifted behind; the sitemap lists
   /demo, /help, /guide; assets get honest caching (a day, not immutable — the
   files are edited in place); the a11y sweep widens to the auth pages and
   finds real violations (hover-only underlines, an unfocusable table); **0
   serious/critical across 26 pages**.
8. **Recovery is treated as the takeover it is** — completing one now revokes
   every session (bumpSessionEpoch finally has its caller), writes the chain
   before issuing codes, and tells the owner; and a requester's unanswered ask
   survives a reload instead of inviting them to triple the family's email.
9. **Family words everywhere** — the green success colour the palette forbids,
   "demo/seed data" shown to a recipient mid-crisis, "provision" on an owner
   screen, and an outage message for a signed-in visitor with nothing wrong;
   plus the debt register reopens with four deliberate deferrals, each with the
   trigger that ends its acceptance.
10. **Shipped and proven live** — 17/17 pages 200, every iteration's change
    probed on production, the one failing probe re-checked in a real DOM and
    found to be the probe.

### The through-line

Five prior audit passes were thorough about what they could see. This pass
found its worst defects in the places a self-audit structurally cannot look:
the scheduler path (walking it takes thirty days of not checking in), the
failure branches of stress screens (walking them requires the network to fail
on cue), the gap between a comment and its callers, and the difference between
a promise as written and a promise as kept by the worst branch. The recurring
shape, again: **a green signal was wrong** — a header note claiming a caller
exists, a calming empty state drawn over a 500, an absolute promise the
genuine emergency email breaks.

### Verification

Every iteration ended green (build, tsc, lint, full suite) before its commit.
Suite grew from 1,780 to 1,842 passing along the way — derive the current
count with `PROJECT.yaml derived.test_count`. Deployed in two batches
(iterations 1–3, then 4–9), each verified against production afterwards; the
final sweep checked twelve properties live, including headers, robots/sitemap,
the unwrap contract, and the scheduler's freshness.

### Still open, and where it is written

The four deliberate deferrals live in PROJECT.yaml `deferred:` (step-up
re-auth, WebAuthn nonce store, the multi-owner LIMIT 1, the type-scale
ratchet). The demand-side facts are unchanged by any of this: wtp_evidence
none, invitations sent zero. The engineering bar this pass raised was never
the thing between the product and its first user.

---

## 22. Beta blockers closed — 2026-08-14

The go-live assessment named three engineering blockers before a first family.
All three are shipped, and one of them is now proven end to end against
production rather than asserted.

### The delivery blind spot, and the constraint that shaped the fix

Resend accepts a send to a SUPPRESSED address and answers 200 with a message
id, so `sendEmailBestEffort` returns true and every caller reports success. A
previously-bounced address is muted permanently, silently. For this product that
is the catastrophic shape: a release fires, verifier notices go nowhere, quorum
is never met, and access never opens on the one day it exists for.

**The obvious fix was closed.** Probing the live API showed the production key
is `restricted_api_key` — send-only. That is correct least privilege on a key
SHARED with report-bridge, so the app cannot ask what happened and widening the
credential to find out was the wrong trade. Resend pushes instead:
`/api/resend/webhook`, Svix-signed, implemented with `node:crypto` rather than
adding a dependency days before a beta, answering a constant 204 so it cannot be
probed for whether a secret is configured.

The rule the surfacing obeys: **absent means unheard, never fine.** Until the
webhook is configured the line renders nothing rather than "reachable" — a
screen claiming delivery on no evidence is the false green this repo keeps
finding.

Migration 027 applied and verified in BOTH regions. Configured in production the
same day; **proven end to end**, with a real `email.delivered` event recorded
1.5 seconds after a live send, and the resulting line seen rendered on `/circle`
against real provider data.

### 🔴 The verifier that could never report success

Worth recording because it cost the most time and taught the most.

The webhook worked on the first attempt. The verification tool said it had
failed. It compared a JS ISO string (`2026-08-14T16:01:29.000Z`) against
`occurred_at::text` from Postgres (`2026-08-14 16:01:31.077+00`) — formats that
differ at character eleven, a space against a `T`. A space sorts before `T`, so
the database value was always "less than" the stamp whatever the real times
were. **The success condition could not be true.**

That is the worst failure available to a verification tool: it does not merely
fail to confirm, it sends you hunting a defect that is not there. Diagnosis took
an unsigned probe against production (to prove the secret was live, by observing
that the signature check *rejected* it and logged), a runtime-log query (to
prove Resend was calling us), and finally a direct read of the table — which had
the row all along. The comparison now happens in the database against a real
timestamp.

Third instance in this session of a self-written check measuring something
adjacent to what it claimed. The pattern is consistent enough to state as a
rule: **when a check disagrees with the thing it checks, suspect the check.**

### The promise with no mechanism

Both entitlement ceilings tell owners "email us if you need more — we are
onboarding founding families by hand." There was no by-hand path: the only route
to `paid` was the Stripe webhook, so the honest answers were "pay $119" or "no",
and the free vault is ten items against a real one of twenty-five.

`scripts/grant-founding-tier.ts` closes it, and the constraint that shaped it was
not the grant but the ACCOUNTING. A hand-granted row is structurally identical to
a customer's, so counting it once corrupts `wtp_evidence` — the single number G1
rests on — silently, months later. Comps are marked twice, the marker is spelled
once, and three refusals were exercised against live data without mutating
anything: a Stripe subscriber, a demo account, an unknown address.

### A clean baseline

Production held six accounts, five of them fixtures — so every "how many signed
up" was six times wrong, and the first metric anyone reaches for in a beta is
exactly that. Removed through the product's own `deleteAccount`, audit chains
retained as the privacy page promises. Checked before deleting that the canary
probes only public routes and `/demo` renders from static fixtures.

Production is now **one real account, zero fixtures, zero undeliverable
contacts**, and two genuine delivery-telemetry rows kept as the evidence they are.

### What remains, and it is not code

The dogfood walk. Nobody outside this room has completed a journey, the real
account holds no items, and **zero passkeys exist** — so "they can get back in
without you" is the least-proven claim in the product. A complete release walk
needs three people: the eligibility rule refuses a verifier who is also a
recipient on that trigger, and refuses the owner as their own verifier.
`docs/first-invitations.md` now carries the three operator tools for running it.
