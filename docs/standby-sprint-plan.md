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

## 2a. ⏸️ Phase 0 — instrumented, PARKED by Steve 2026-08-12

The funnel is built and live (migration 024, `scripts/phase0-invite.ts`,
`scripts/phase0-report.ts`). What remains is not engineering: it needs ~20 real
invitations, split across the two delivery arms, and only Steve can spend that
social capital.

**Steve's call: build first, measure later.**

**The risk that decision accepts, stated plainly so it is not rediscovered later:**
every sprint from here compounds on an unvalidated bet. `risk 1` of the
architecture is "claim conversion is the whole bet", and Phase 0 exists precisely
to find out before more is built on it. Parking it does not make the bet smaller;
it makes it later and more expensive to lose.

**Re-raise at every `/daily-priority`.** A parked item that is not re-raised is a
dropped one, and this is the measurement the architecture rests on.

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
