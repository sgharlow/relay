> **SUPERSEDED BY `docs/standby-architecture.md` (2026-08-11).**
>
> Its architecture is adopted essentially whole and its §5 repo change list remains valid and is
> referenced directly by the successor. Four things changed: the invitation is also removed from
> the email path, a single-use break-glass covers contacts who never claim, the Resend delivery
> webhook is **kept** rather than cut, and the challenge-window escalation is built. Phase 0 is
> retained but de-confounded and run in parallel with G1 rather than instead of it.
>
> Read this file for the reasoning behind the standby account; read the successor for what to build.

# Relay: converging on the standby account

Proposed architecture change and repo change list.
Status: proposal. Supersedes the handoff-ledger and printed-credential design explored 2026-08-11.

---

## 1. Recommendation in one paragraph

Stop trying to make credential delivery reliable and remove the credential from the
delivery path instead. Every named person claims a **standby account** in calm, binding
their identity to their own authenticator. At release time nothing secret is transmitted:
the person signs into an account they already have and the dashboard unlocks. Delivery
becomes a notification, which is allowed to fail. Assurance that a real human is on the
other end comes from a **fingerprint phrase the owner and the contact confirm out of
band**, not from an acknowledgment ledger. The printed or digital card carries identity
and instructions only, never a key. The release state machine gains **zero new states**.

---

## 2. Why this beats the alternatives considered

| Option                                                | Verdict                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handoff ledger with sent/received state doubling      | Rejected. Instruments a problem the identity model creates. Doubles the transition table, doubles the chance of a mis-tagged `reversibleOnly` edge, and produces perpetual amber readiness that owners learn to ignore. |
| Printed credential card                               | Rejected as primary. A durable card and a short-lived credential are contradictory requirements. Retained as a no-credential, no-smartphone fallback artifact.                                                          |
| Wait-time plus owner veto as the default release path | Rejected as default, retained as an opt-in trigger. It relocates the delivery dependency onto the owner and makes silence resolve toward open, contradicting the ARMED-is-safe invariant the whole system is built on.  |
| Fingerprint handshake                                 | Adopted, but as a component. It measures reachability honestly; it does not change any dependency. It also needs the standby account to have a screen to display on.                                                    |
| **Standby account**                                   | **Adopted.** Only option that creates a durable surface, converts silent failures into visible ones, makes revocability technically true, and carries a distribution mechanic.                                          |

The deciding argument is outside the security/capability/usability score: every owner names
three to five people, each becomes a free account, and those people are the caregiver
beachhead with their own continuity problem. With `wtp_evidence: none`, a structural
acquisition channel is worth more than an architectural improvement.

---

## 3. End-state architecture

### 3.1 Identity model

Three principal types, all real users:

| Principal           | Auth                       | Pays | Sees                                               |
| ------------------- | -------------------------- | ---- | -------------------------------------------------- |
| Owner               | passkey or password + TOTP | yes  | own vault                                          |
| Recipient (standby) | passkey, own device        | no   | standby summary; vault contents only when released |
| Verifier (standby)  | passkey, own device        | no   | pending decisions only, never vault shape          |

`recipients` and `verifiers` stay as the owner's roster rows. Each gains a nullable
`claimed_user_id` pointing at `users.id`. The roster row is the relationship; the user row
is the identity. Binding to a user id rather than an email means a contact who changes
address stays connected with no reconfiguration.

### 3.2 Release path

Unchanged: `ARMED → PENDING → GRACE → RELEASED`, CAS-guarded, OCC-retried, safe-reset to
ARMED. What changes is what `RELEASED` causes:

- **Today:** mint an 8-character recipient code, email it, recipient redeems it for a
  JWT scoped to `(release_state.id, version)`, dashboard opens at `/access?token=...`.
- **Standby:** flip the row. The recipient's already-authenticated session now resolves
  a release for that owner and the dashboard opens. No code is minted, nothing secret is
  emailed, and the token leaves the URL bar entirely.

The version check survives. It moves from a JWT claim to a server-side comparison on each
request: a re-arm bumps the version and every open dashboard closes on its next call. That
is the same guarantee, enforced in a better place.

### 3.3 Assurance

One boolean per person, set by the owner after comparing a short fingerprint phrase with
the contact in person or by phone. That is the entire acknowledgment model. No webhook, no
scheduled sweep, no ack state machine.

### 3.4 Channels

| Rung | Mechanism                    | When                                                          |
| ---- | ---------------------------- | ------------------------------------------------------------- |
| 0    | The standby dashboard itself | Always available. The contact can look without being told.    |
| 1    | Email to primary address     | Notification only, allowed to fail                            |
| 2    | Email to secondary address   | One nullable column, roughly doubles delivery odds, no vendor |
| 3    | Other circle members         | Circle visibility lets humans chase each other                |
| 4    | Wallet pass push             | Post-G1                                                       |
| 5    | SMS                          | Post-G1, gated on 10DLC registration                          |

Rung 0 is the point of the whole design. Every other rung is convenience.

### 3.5 Artifacts

- **Standby Card**, issued after claim, no credential on it. Contains: contact name, owner
  name and relationship, role, the domain to type, the `RLY-XXXX-XXXX` case ID format they
  should expect a caller to quote, the fingerprint phrase, and what to do if contacted.
- **Delivery order:** wallet pass first (revocable, updatable, survives phone upgrades),
  PDF as the explicit degraded path, print as the degraded path from that.
- **Positioning:** tell owners to put a copy with their estate planning documents. The
  fire safe already exists.
- **Never printed:** any credential, ever. Not the claim code, not a release code.

---

## 4. State model, final

### Release state: no new states

The original brief proposed doubling every stage into sent and received. Converging on the
standby account dissolves the need. The two splits that looked strongest both collapse:

| Proposed split                                      | Outcome                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pending_notified` / `pending_acknowledged`         | Cut. Nothing behaves differently. Two timestamps.                                                                        |
| `grace_owner_notified` / `grace_owner_acknowledged` | Cut. An owner who acknowledges during grace is checking in, which stands the release down. The ack state is unreachable. |
| `release_offered` / `release_claimed`               | Cut. With no code to redeem, "claimed" is `first_access_at`, a timestamp.                                                |

Two nullable timestamp columns on `release_state`: `notified_at`, `first_access_at`.
`PERMITTED_TRANSITIONS` stays at seven edges. The `reversibleOnly` estate rule keeps its
current surface area, which was finding S6.

### Person state: the states that were always missing

Replaces the dead `verification_status` column, which defaults to `pending`, has no CHECK
constraint, is written by nothing, and renders as a permanent chip in `PeopleSections.tsx`.

```
invited → claimed → confirmed
             ↓          ↓
          revoked ← ────┘
```

| State       | Meaning                                    | Set by                   |
| ----------- | ------------------------------------------ | ------------------------ |
| `invited`   | roster row exists, invite issued           | owner adds person        |
| `claimed`   | standby account bound to `claimed_user_id` | contact completes claim  |
| `confirmed` | fingerprint phrase verified out of band    | owner presses one button |
| `revoked`   | access withdrawn                           | owner                    |

`unreachable` is **derived on read** from `invited` plus an elapsed invite TTL. Not a
stored state, not a scheduled sweep. You already carry one scheduler ledger; do not add a
second thing that can silently stop.

Single writer, no concurrency. Do **not** wrap this in `ReleaseStateMachine` or extract a
generic `CasStateMachine<S>`. The release machine exists because three writers race
(owner, verifiers, scheduler). Person state has one. A plain guarded update with a CHECK
constraint is correct and honest.

### Owner-facing rendering

Three positions, not four states and not six:

| Light | Condition              |
| ----- | ---------------------- |
| Red   | not claimed            |
| Amber | claimed, not confirmed |
| Green | confirmed              |

---

## 5. Repo change list

Next migration number is **020** (005 is absent from the sequence).

### 5.1 Migrations

**`020_standby_accounts.sql`**

```
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS claimed_user_id UUID;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS email_secondary TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS standby_state TEXT;   -- nullable; NULL = 'invited'
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS fingerprint_confirmed_at TIMESTAMPTZ;
-- same four on verifiers
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS first_access_at TIMESTAMPTZ;
CREATE INDEX ASYNC idx_recipients_claimed_user ON recipients (claimed_user_id);
CREATE INDEX ASYNC idx_verifiers_claimed_user  ON verifiers  (claimed_user_id);
```

All adds nullable. DSQL cannot add NOT NULL to an existing table, which migration 008
already documents. `standby_state` reads through a helper that maps NULL to `invited` so
existing rows need no backfill, mirroring how `case_id` was handled.

**`021_invitation_hardening.sql`**

```
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS failed_attempts INT;
```

`recipient_codes` got a DB-backed `MAX_FAILED_ATTEMPTS = 10` in migration 017. Invitations
never did, so redemption is guarded only by `lib/http/rate-limit.ts`, which the module's
own header correctly calls per-instance memory and not a security boundary. Fix before the
invitation code becomes the front door.

**`022_webauthn_credentials.sql`** (passkeys)

```
CREATE TABLE webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_webauthn_credential_id ON webauthn_credentials (credential_id);
CREATE INDEX ASYNC idx_webauthn_user ON webauthn_credentials (user_id);
```

### 5.2 New modules

| Path                            | Purpose                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `lib/people/standby-state.ts`   | state constants, permitted edges, NULL-to-`invited` read helper, derived `unreachable`     |
| `lib/people/fingerprint.ts`     | deterministic phrase from `(owner_id, person_id, claimed_user_id)`, plus confirm/unconfirm |
| `lib/auth/webauthn.ts`          | registration and assertion via `@simplewebauthn/server`                                    |
| `lib/access/standby-resolve.ts` | given a session user, resolve which owners they stand by for and which releases are open   |

### 5.3 Modified modules

| Path                                        | Change                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/auth/auth-options.ts`                  | add a passkey path alongside `CredentialsProvider`; keep JWT session strategy; carry `standbyFor` in the token |
| `lib/people/invitations.ts`                 | redemption creates or links a `users` row and sets `claimed_user_id`; add attempt counting                     |
| `lib/people/invite.ts`                      | invitation body points at claim, unchanged in spirit; `emailDelivered` becomes advisory only                   |
| `lib/release/provisioning.ts`               | stop minting recipient codes for **claimed** recipients; stamp `notified_at`                                   |
| `lib/auth/recipient-token.ts`               | retained for the unclaimed fallback only; the version staleness check moves server-side for claimed sessions   |
| `lib/vault/readiness.ts`                    | new blockers `unclaimed_recipient`, `unclaimed_verifier`, `unconfirmed_person`, `single_contact_address`       |
| `lib/vault/preparedness.ts`                 | score on confirmed-reachable people, not raw counts                                                            |
| `lib/billing/entitlements.ts`               | standby accounts must not count against the owner's recipient cap and must never be billed                     |
| `src/app/(owner)/circle/PeopleSections.tsx` | replace the dead `verification_status` chip with the three-position light and a Confirm button                 |
| `src/app/(access)/access/AccessClient.tsx`  | read the release from the session, not `?token=`                                                               |
| `src/app/(access)/claim/ClaimClient.tsx`    | claim flow ends in passkey registration, not a dead end                                                        |

### 5.4 New routes

```
POST   /api/webauthn/register/options
POST   /api/webauthn/register/verify
POST   /api/webauthn/authenticate/options
POST   /api/webauthn/authenticate/verify
GET    /api/standby                       # what am I on standby for
POST   /api/people/[id]/confirm           # fingerprint confirmed
GET    /api/people/[id]/card              # Standby Card, no credential on it
```

### 5.5 Deletions and demotions

- Recipient code minting on the release path for claimed recipients. Module and table stay
  for the unclaimed fallback.
- `?token=` in the access URL for claimed recipients.
- The proposed `handoffs` table, Resend delivery webhook, two ack tiers, doubled release
  states, and generic state machine extraction. All cut.

### 5.6 Known implementation friction

`next-auth` v4 with `strategy: 'jwt'` and no DB adapter has no first-class passkey
provider. Two options, both real work: implement WebAuthn directly with
`@simplewebauthn/server` behind a custom provider, or move to Auth.js v5. The former keeps
the JWT session model you already reason about and is the recommended path. Budget for it
honestly; this is the largest single item in the plan.

---

## 6. Sequencing

**Phase 0, this month, no code: claim conversion test.** Invite twenty real people with the
existing flow and count how many complete claim. The entire architecture rests on this
number. Below roughly 50 percent, the fallback path carries more traffic than the primary
one, the surface and distribution arguments collapse, and the ranking swings back toward
durable artifacts. This is a better first G1 instrument than the queued price test: it
decides an architecture rather than confirming a number, and it needs no ad spend to reach N.

**Phase 1: passkey claim.** The direct mitigation for R2's only serious weakness. One tap,
no password, no authenticator app, phishing-resistant by construction. Shipping the standby
account without it means shipping it into the known failure mode of the category.

**Phase 2: standby resolution and the release path swap.** Claimed recipients stop
receiving codes. Person state replaces the dead column. Three-position light.

**Phase 3: fingerprint confirm, secondary address, readiness blockers.** Cheap, enabled by
the account, and they turn readiness into an honest signal.

**Phase 4, post-G1: Standby Card, wallet pass, circle visibility, SMS.**

---

## 7. Risks and open questions

1. **Claim conversion is the whole bet.** Phase 0 exists to find out before Phase 1 is built.
2. **Differentiation cost.** Standby accounts move Relay structurally closer to Bitwarden
   and Proton emergency access. Remaining differentiators are reversibility, the importance
   engine and risk graph, and scope beyond passwords into documents and instructions.
   Decide this deliberately.
3. **Coercion.** A visible circle roster is reconnaissance for a controlling household
   member. Circle visibility ships behind an owner toggle, default off. This belongs in the
   G2 counsel brief next to the RUFADAA question, not only in the code.
4. **Free-account population.** Standby accounts bring auth surface, reset flows, deletion
   requests, and support load from people who are not customers. Cap and monitor.
5. **Fingerprint decay.** A phrase confirmed in 2026 says nothing in 2030. Needs a
   re-confirm cadence, and the cadence must not become the nagging problem it replaced.
   Annual at most, satisfiable in one click.
6. **Gate discipline.** PROJECT.yaml says no further building until G1 produces evidence,
   and `caregiver_leads` held zero rows as of 2026-08-09. Phase 0 is evidence work and is
   in bounds. Phases 1 through 4 are building, and the sequencing rule applies to them.
