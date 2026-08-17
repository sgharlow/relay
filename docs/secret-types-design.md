# Secrets beyond username-and-password — design, implementation plan, QA pass

**Status:** design, not built. **Date:** 2026-08-17. **Author:** Claude, for Steve's decision.
**Origin:** the sprint-10 investigation (`docs/sprint-reports/2026-08-17-sprint-6-vault-wiring.md` §3)
found that Relay has no model for passkeys or TOTP as stored credentials.

> **Claim level: idea.** Nothing here is built. Two of the defects it describes, however, are **live
> in production today** — see §1.2 and §1.3. Those are bugs, not proposals, and Phase 0 fixes them.

---

## 1. The problem, with evidence

A vault item holds **one opaque encrypted blob**, labelled *"Password, note, or instructions"*.
There is no username field, no TOTP seed, no recovery codes, and nothing recording that an account
demands a second factor. `VALID_TYPES` is `login · account · document · note · instruction`.

### 1.1 The product tells owners something untrue

`assessPreparedness` defines *reachable* as **"an access rule exists"** — nothing more. So an owner
who stores a password for a 2FA-protected account is told *"Sarah could reach all 3 of the things
that matter."* Sarah receives a password and a locked door.

For a **passkey** it is worse: the credential is device-bound and non-exportable, so there is
nothing to put in the vault at all, and no way to say so.

### 1.2 🔴 LIVE DEFECT — recipients already see raw JSON

`ImportPageClient` encrypts `JSON.stringify({ username, password })` as the plaintext. The manual add
form encrypts a raw string. **Two incompatible plaintext formats are already in production.**

`AccessClient` renders the decrypted value as `<pre>{value}</pre>`. So a recipient of any imported
item — at the worst moment of their life — is shown:

```
{"username":"steve@example.com","password":"hunter2"}
```

This is not a hypothetical. It ships today.

### 1.3 🔴 LIVE DEFECT — imported TOTP seeds are detected, then discarded

`lib/import/csv-parser.ts` identifies a LastPass export **by the presence of its `totp` column**
(`if (h.has('grouping') || h.has('totp')) return 'lastpass'`). `ParsedRow` then carries only
`service_name · url · username · password`.

Every owner who has imported from LastPass, Bitwarden or 1Password has **silently lost every second
factor they had**, and the vault reports itself complete.

---

## 2. What the architecture permits

The design is constrained by these, and none of them is negotiable:

| Constraint | Consequence for this design |
|---|---|
| Plaintext never leaves the browser; no server path handles plaintext secrets | Structure must live **inside** the ciphertext, never in columns |
| AI agents see metadata only (`getVaultMetadata` excludes ciphertext/keys) | New metadata must be non-secret and must not reach the LLM |
| **The server cannot read plaintext** | **There is no backfill. Ever.** Existing rows can only be upgraded by the owner's own browser |
| DSQL: no FKs, no sequences, OCC via `withOccRetry`, snapshot isolation | Plain `ADD COLUMN`; no index; both regions; `verify:schema` |
| Migrations are a sysadmin act (D1) | Anything needing schema is **Steve's to run**, and is therefore Phase 1+ |
| Audit log is append-only and hash-chained | Never write a secret, or anything unretractable, into it |
| Owner unwrap exists and is proven (`AccountClient` export) | Decrypt-and-merge on edit is **not a new capability** |
| `VAULT_MAX_JSON_BYTES = 1 MB` | Structured payloads are nowhere near it — not a risk |

---

## 3. The classification this design rests on

Not every secret is the same *kind* of thing, and the difference decides what the product can
honestly promise. Three classes:

| Class | Examples | Can it be handed to another person? | How Relay should model it |
|---|---|---|---|
| **A — Transferable** | password, TOTP seed, recovery codes, API key, PIN, security answers, seed phrase | **Yes** — copy and use | Store in the encrypted payload |
| **B — Non-transferable** | passkey, hardware key, biometric | **No** — bound to a device or a body | Cannot be stored. Record the **recovery route** instead |
| **C — Channel-bound** | SMS OTP, email OTP, magic link | **Only if** the recipient can reach that channel | A **dependency** — already modelled by `depends_on_item_id` |

**This maps onto machinery the product already has**, which is why the design is small:

- Class C *is* the risk graph. `depends_on_item_id` and `computeReveal` already model "this account
  recovers through that one" — the op-ed's whole argument, already in the schema.
- Class B is served by `backup_note` (now writable and now reaching recipients, sprint 10) plus a
  dependency edge to whatever recovers it.
- Class A is the only genuinely new storage, and it needs **no new columns**.

---

## 4. Design

### 4.1 Storage — structured plaintext, unchanged ciphertext

Keep exactly one ciphertext blob per item. Give the **plaintext** a versioned envelope:

```jsonc
{
  "relay": 1,
  "fields": [
    { "kind": "username",       "value": "steve@example.com" },
    { "kind": "password",       "value": "…" },
    { "kind": "totp",           "value": "otpauth://totp/Google:steve?secret=JBSW…&issuer=Google" },
    { "kind": "recovery_codes", "value": ["8f2k-91mz", "…"] },
    { "kind": "note",           "value": "Use the work profile, not the personal one." }
  ]
}
```

**Why inside the blob rather than in columns.** The server must never see the structure. This design
changes **nothing** in `/api/kms/wrap`, `/api/kms/unwrap`, `decryptAccessItem`, `access_rules`, the
release state machine, or the OCC path. The blob stays a blob; only the two ends that already hold
plaintext learn to read it.

**Backwards compatibility, and the constraint most designs would miss.** The server cannot re-encrypt
anything, so **there is no migration for existing items — not now, not ever.** The decoder must
therefore accept three shapes permanently:

1. `{"relay":1,…}` → structured
2. `{"username":…,"password":…}` → the legacy **import** format (§1.2), decoded into labelled fields
3. anything else → a legacy single secret → one `password` field holding the raw string

Upgrade is **opportunistic**: an item is written in the new format the next time its owner edits it.
Never forced, never bulk.

**One authoritative definition.** `lib/crypto/secret-payload.ts` owns encode + decode, and is
imported by the owner form, the CSV import, and the recipient reveal. This is a cross-boundary
contract; it gets one definition and a golden-file test, per the portfolio rule.

### 4.2 Metadata — two non-secret columns (Phase 1, needs a migration)

The server has to know *what kinds* exist without seeing values, or preparedness cannot stop lying.

```sql
ALTER TABLE vault_items
  ADD COLUMN secret_kinds     TEXT,   -- what the BLOB holds        (client-declared)
  ADD COLUMN factors_required TEXT;   -- what the ACCOUNT demands   (owner-declared / AI-inferred)
```

`TEXT` holding a sorted comma-joined list, not `TEXT[]` — no array column exists anywhere in this
schema, and one helper parses it.

**The computation this exists for**, and the fix for §1.1:

```
usable(item)  =  factors_required ⊆ ( secret_kinds ∪ factors_reachable_through_dependencies )
```

`assessPreparedness` moves from *"an access rule exists"* to *"an access rule exists **and** the item
is usable."* A passkey-only account is never usable by a recipient — which is the correct, honest
answer to the passkey question, not a workaround for it.

**Is `secret_kinds` a zero-knowledge leak?** It tells the server *"this item has a TOTP"*. That is
metadata of exactly the grade already exposed — `type`, `category`, `is_root_credential`,
`service_name`, `url`. It reveals no value, and it is **necessary** in order to tell an owner their
plan does not work. A deliberate, bounded trade-off, stated rather than smuggled. Neither column
goes to the LLM (§6, Q12).

### 4.3 Entry — how the owner gets these in

| Path | Design |
|---|---|
| **QR code** | The normal way people enrol TOTP. **Decoded on a `<canvas>` in the browser, never uploaded** — the QR *contains the seed*. Decoder dynamically imported so it stays out of the main bundle. Needs a structural guard asserting the handler performs no upload. |
| **`otpauth://` paste** | The "can't scan it?" fallback, and the universal path. Parsed for `secret`, `issuer`, `digits`, `period`, `algorithm`. |
| **Recovery codes** | A textarea split on whitespace/newlines. |
| **CSV import** | **The highest-leverage fix.** `ParsedRow` gains `totp`; `FORMAT_COLUMNS` gains a `totp` entry per format. This is bulk, and it is where the seeds already are. |
| **Passkey** | **Refuse honestly.** There is no field, because there can be no field. The UI says a passkey cannot be handed over and offers the only thing that helps: name the account that recovers it, and write the note. This sets `factors_required = passkey` with no matching `secret_kinds`, so the item correctly reads as *not usable*. |

### 4.4 Use — what the recipient can actually do

**TOTP: generate the live code in the browser.** RFC 6238, HMAC-SHA1, via WebCrypto
`SubtleCrypto.sign('HMAC', …)` — **no new dependency**, because the platform already provides it and
the seed is already decrypted in the browser. A six-digit code, a countdown ring, a copy button.

This is the most valuable single element of the design. Handing a grieving person a base32 string is
useless; handing them a live six-digit code is the difference between getting in and not.

**Recovery codes:** shown as a list, with *"each of these works once"*. **Deliberately not tracked as
used** — see Q9.

**Structured reveal replaces `<pre>{value}</pre>`:** labelled rows, per-field copy, password masked
with a show toggle. And it parses the legacy import JSON, which **fixes §1.2 for every existing
item** without touching a single stored row.

---

## 5. Implementation plan

Ordered so that all the user value that carries no infrastructure risk ships first.

### Phase 0 — no migration, no schema change, no infra risk

1. `lib/crypto/secret-payload.ts` — encode/decode + the three legacy shapes + golden-file test.
2. **Structured reveal** in `AccessClient`. *Fixes the live raw-JSON defect (§1.2).*
3. **CSV import stops discarding TOTP** (§1.3).
4. Owner add/edit form gains username · TOTP · recovery-code fields.
5. TOTP generator, tested against the **RFC 6238 published test vectors**.
6. Update `lib/seed/seed-runner.ts` to the new format (Q10).

Phase 0 alone converts an unusable handover into a usable one for every account protected by TOTP.

### Phase 1 — needs the migration (Steve runs it)

7. `secret_kinds`, `factors_required`; both regions; `verify:schema` before and after.
8. `assessPreparedness` / `readiness.ts` compute `usable`, with the **three-state** rollout of Q1.
9. Guard extending V5's allow-list test to name both new columns.

### Phase 2

10. QR scanning (dynamic import, camera permission, upload guard).
11. AI inference of `factors_required`, advisory only, with the `owner_set_*` override precedent —
    and subject to Q7.

---

## 6. QA pass — architectural and operational issues in this design

Ranked. The first three must be resolved **before** building; they are design decisions, not bugs.

### 🔴 Q1 — BLOCKING. The rollout of `factors_required` is the biggest risk in the design

At rollout the column is `NULL` for every item in every vault. If `usable` is computed naively:

- treat NULL as *"needs nothing"* → the product **keeps lying**, and now with machinery behind it;
- treat NULL as *"needs something"* → **every owner is alarmed about every item**, including the many
  logins that genuinely have no second factor. A false alarm at that scale destroys trust in the
  signal permanently.

**Neither is acceptable, so preparedness needs a third state.** `unknown` must be distinct from
`none`. The sentence becomes something like *"Sarah could reach 3 of the 5 things that matter — we
have not checked whether 2 of them need a code as well,"* with a one-tap *"does this need a code?"*
per item. Honest, and it converts a silent falsehood into a question. **This is the part of the
design most likely to be got wrong by implementing the happy path first.**

### 🔴 Q2 — BLOCKING. Edit-time decrypt changes a user-facing promise

The edit form says: *"New value for X. Relay cannot show you the old one — it cannot read it."*

Under structured payloads, adding a TOTP to an existing item means the owner's browser must **decrypt
the current payload, merge, and re-encrypt** — otherwise saving one field destroys the password.
**That is a data-loss path if implemented carelessly.**

> **RESOLVED IN PHASE 0 BY NOT DOING IT — and building found the reason.** Decrypt-and-merge needs
> the item's ciphertext, and there is **no single-item endpoint to fetch it from**: the `GET` on
> `/api/vault/items/[id]` was retired on 2026-08-13, and `/api/account/export` returns the whole
> vault behind a step-up. Adding one is a new server surface over ciphertext — a decision that does
> not belong in a phase whose promise is "no infrastructure risk".
>
> So the edit form keeps its existing **replace** semantics, which the product already chose
> deliberately, and simply replaces *more*: username, password, TOTP and recovery codes are all on
> screen. Nothing can be silently dropped, because nothing is off-screen. The copy now says
> *"everything you enter here replaces what is stored, including any fields you leave blank."*
>
> **True field-level editing remains open**, and it needs that endpoint first.

### 🔴 Q3 — BLOCKING. `NULL` secret_kinds must mean "unknown", not "empty"

Same trap as Q1, one layer down. Every pre-existing item has `secret_kinds = NULL` because no client
has ever written it. If NULL is read as "holds nothing", every item in every vault instantly reads as
unusable. Absent and empty are different facts and must stay different in the code.

### 🟠 Q4 — HIGH. §1.2 is live, and should not wait for this design

Raw JSON is being shown to recipients today. Ship the structured reveal as a **bug fix**, on its own,
regardless of whether the rest of this design is accepted.

### 🔴 Q5 — RAISED TO BLOCKING BY BUILDING IT. There is no easy remediation path

Owners who already imported from LastPass/Bitwarden/1Password lost their TOTP seeds silently, and
**they do not know anything is missing.** A parser fix helps future imports only.

**I originally wrote "those owners must re-import or re-enter." The re-import half is wrong.**
`/api/import` deduplicates against *existing vault items* on a normalised `title + service_name`
(`lib/vault/dedupe.ts`), so re-running the same export skips **every row** as a duplicate. Nothing
is recovered and the report says `imported: 0`, which reads like success.

That leaves two routes, and neither is good:

| Route | Problem |
|---|---|
| Delete the items, then re-import | `cascadeDelete` removes the item's `access_rules` too. The owner silently loses every recipient assignment they had made. **Do not recommend this.** |
| Edit each item by hand | Works today — but the edit form *replaces*, so they must retype the password as well as adding the seed. Laborious, and error-prone on exactly the accounts that matter most. |

**This makes the single-item ciphertext endpoint more than a nicety.** True field-level editing is
the remediation path for a data-loss bug that has already happened to real vaults. It should be
weighed as remediation, not as convenience.

### 🟠 Q6 — HIGH. A TOTP seed meets the step-up guard's own test, and unwrap is outside its scope

`step-up-guard.ts` states its criterion plainly:

> *"would finding this machine unlocked hand somebody something that **OUTLIVES the session**, or
> something irreversible?"*

and gates `/api/account/export` because *"the browser unwraps them and writes plaintext to disk. One
click from a complete unprotected copy."*

`/api/kms/unwrap` is **not exempt — it is out of scope**: the guard only walks `/api/account`. Its
owner branch requires session ownership (`assertOwns`) and nothing else. Today that is defensible,
because one item at a time is not a bulk export and a password can be changed afterwards.

**This design breaks that reasoning.** A TOTP seed is not a password: it is a permanent second factor
that cannot be rotated by changing a password, and it **outlives the session** by the guard's own
definition. Storing them means a single unwrap now hands over exactly what the guard exists to
protect — and this design makes that path routine, since every edit of a structured item exercises it.

Recommendation: extend the guard's scope to the owner branch of `/api/kms/unwrap`, or record an
explicit decision not to with a reason that survives review. Either is defensible; increasing the use
of that path while leaving it unexamined is not.

### 🟠 Q7 — HIGH. AI inference of `factors_required` repeats a trap this repo has already hit

`intake-agent.ts` carries a scar: its `allFailed` path once reset `is_root_credential` to false and
**one LLM timeout wiped it across an entire vault**. Inferring `factors_required` is the same shape.
It must never downgrade an owner's explicit answer, and its failure default must be `unknown`, never
`none`. The `owner_set_root` pattern is the precedent to copy exactly.

### 🟡 Q8 — MEDIUM. TOTP clock skew

RFC 6238 is a function of wall-clock time. A recipient with a wrong device clock gets codes that fail
and will blame the product at the worst possible moment. Show the countdown; state the cause in the
copy if a code is rejected.

### 🟡 Q9 — MEDIUM. Recovery codes cannot be marked as used

Marking one used would require the **recipient** to re-encrypt and write back — they hold no wrap
permission, and giving them one would create a new server-side write path over a secret. Accepted
limitation: two recipients can pick the same code and one will fail. The UI must say *"each works
once — agree between you who uses which."*

### ⚪ Q10 — WITHDRAWN. The demo has no plaintext format to diverge from

**I was wrong about this, and building it is what showed me.** I assumed `seed-runner.ts` wrote its
own payload shape, by analogy with the `backup_note` defect it *did* mask. It does not: seeded
ciphertext is a **placeholder, not a real envelope** (`lib/seed/demo-data.ts`), so a demo item can
never be decrypted and there is no plaintext convention there to keep in step. Nothing to do.

### 🟡 Q11 — MEDIUM. QR scanning brings a dependency, a permission, and an upload risk

Dynamic import only. Camera permission requested on a page that also displays secrets. The paste
fallback must be equally prominent, not a hidden "advanced" link. And the decoder must be structurally
guarded against ever uploading the image — the QR *is* the seed.

### 🟡 Q12 — MEDIUM. The new columns must not reach the LLM

V5's allow-list (`lib/ai/openai-client.test.ts`) excludes them by construction, since it asserts an
exact six-key set. Extend it to name `secret_kinds` and `factors_required` explicitly, so the reason
survives in the test rather than only in this document.

### ⚪ Q13–Q16 — checked and **not** problems, recorded so nobody re-checks them

| Question | Answer |
|---|---|
| Does a structured payload breach the request cap? | No. `VAULT_MAX_JSON_BYTES` is **1 MB**; a payload with recovery codes and an SSH key is orders of magnitude under. |
| Do we need new `VALID_TYPES` values? | **No.** `login` covers all of this — which avoids a second migration on a `CHECK` constraint. |
| DSQL specifics | Plain `ADD COLUMN`, no index, no default. **Both regions.** `migrate.ts` applies one named file and silently defaults to `001` when called bare — a known trap. |
| Crypto seed phrases | Technically Class A and trivially supported. But a seed phrase is arguably an estate asset, and the Terms disclaim estate functionality (`g2-counsel-opinion` was **declined**, not deferred). **Policy question for Steve, not a technical one.** |

---

## 7. What Steve has to decide

1. **Ship Phase 0 now?** It fixes two live defects, needs no migration, and carries no infra risk.
2. **Q1's three-state preparedness** — accept the "we haven't checked" state, or propose another.
3. **Q2's copy change** on the edit form.
4. **Q5** — tell existing importers their second factors were dropped, or not.
5. **Q6** — step-up on owner unwrap: classify it, or record a decision not to.
6. **Q16** — are seed phrases in scope, given the estate disclaimer?

Phase 1's migration is his to run regardless; nothing here changes that.
