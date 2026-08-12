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
2. **Option 2 — stop minting codes for claimed verifiers.** Unblocked (break-glass works end to
   end). Wants the §8.1 ruling first, plus a way for an owner to see who actually holds an
   unredeemed code — a fallback nobody was handed is not cover.
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
1. **The demo account's two triggers are unsatisfiable** (both verifiers `invited`). Fine as a
   demonstration of the banner; wrong if that account is shown to anyone as a working example.
2. **§8.1 unanswered** — covered-or-excluded for a break-glass-only contact. Now the last thing
   gating Option 2.
3. **Option 2** — stop minting codes for claimed verifiers. Needs (2), plus a way for an owner to
   see who holds an unredeemed code.
4. **Phase 0 measurement is still parked**, so claim conversion — the number the whole architecture
   is bet on — remains unmeasured. The instrument exists (`scripts/phase0-report.ts`).

### Deferred, and genuinely optional
§3.8 event transparency · `email_secondary` (rung 2) · [A2] guided-setup-call UI, which is packaging
around an assurance flow that already works.
