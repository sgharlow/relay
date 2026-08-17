# Sprint 10 — the fields the vault read but could never write

**Branch:** `sprint/2026-08-17-4` · **Iterations:** 5 of 5 (cap reached) · **Date:** 2026-08-17 (UTC)
**Scope:** next most important improvements to get fully in production, opening with a named
investigation — how does Relay model passkeys and TOTP as vault items rather than username/password
pairs?

That investigation did not find what it was looking for. It found something else, and the something
else turned out to be a family of five defects sharing one shape.

## 1. Backlog source

**Inferred**, from the repo survey, and stated as such. `.claude/sprint-state.json` carried three
deferred items scored 2 or lower plus one needing Steve. The named investigation supplied the
starting thread and the survey followed it.

## 2. Baseline

| | Start | End |
|---|---|---|
| `npm run gate` (types + lint + test + build) | **exit 0** | **exit 0** |
| `npm test` | 2513 passed, 1 skipped | **2545 passed, 1 skipped** |
| `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities |

**No newly skipped tests.** The single skip is the pre-existing beta-paywall case, owned and dated.
The two counts above are a measurement taken at the time, not a live figure — they will drift the
moment anything lands. For the current count run the command in `PROJECT.yaml` → `derived.test_count`.

## 3. The answer to the question that started it

**Relay has no model for passkeys or TOTP as stored credentials. None at all.**

- `VALID_TYPES` is `login · account · document · note · instruction`. There is no passkey type, no
  authenticator type, no recovery-code type.
- A vault item holds **one opaque encrypted blob**, labelled *"Password, note, or instructions"*.
  There is no separate username field, no TOTP seed field, no recovery-code field, and no flag
  anywhere recording that an account is protected by a second factor.
- The sophisticated WebAuthn and TOTP machinery in this repo — `webauthn_credentials`,
  `auth_challenges`, single-use nonces, step-up elevation as a withdrawable row — is about signing
  **into Relay**. It is genuinely good, and it is a different problem.

**What that costs, stated precisely.** An owner stores a password for an account with 2FA and marks
it critical. `assessPreparedness` counts the item as *reachable* because an access rule points at it
— reachability means "a rule exists", nothing more. The dashboard then says *"Sarah could reach all
3 of the things that matter."* Sarah receives a password and a locked door. For a passkey it is
worse: the credential is device-bound and non-exportable, so there is nothing to put in the vault at
all, and the only real route is account recovery.

**What the product can already express**, which is more than I expected:

- `depends_on_item_id` genuinely models *"this account recovers through that one"* — the op-ed's
  argument, already in the schema and driving the risk-graph reveal.
- `backup_note` is now writable and now reaches the recipient (V1, V2, V4), so *"2FA codes come from
  my authenticator app; the recovery codes are in the desk drawer"* finally has a home and an
  audience. That is not a structured model, but it is the difference between a recipient who can
  proceed and one who cannot.

**What is missing needs a decision, not a sprint.** A structured second-factor field changes the
schema, which means a migration — a sysadmin act, and Steve's alone under D1. Design proposal is in
§7; I have deliberately not half-built it.

## 4. Shipped

Every item shares one shape: **a field or capability the product reads but cannot reach.** Each was
found by pulling the previous one's thread.

### V1 · wiring · `eaddf41` — the vault asked for a note it had nowhere to put

`backup_note` has been in migration 001 since the beginning. `detectGaps` reads it to decide
`CUSTODY_RISK` and `MISSING_NOTE`. **No write path in the product ever set it** — not `createItem`,
not `updateItem`, no API, no form field.

So `hasNote()` was false for every item in every real vault, permanently, and the gap list on
`/vault` contained **100% of an owner's items**, each advising them to add a note the product gave
them no way to add. Hard-priority ladder item 4, pointed the other way: not a green that should be
red, but a red nobody can turn green.

**Why it survived:** `lib/seed/seed-runner.ts` *does* write `backup_note`, so the demo vault behaved
exactly as designed while every real one was wrong.

- **Acceptance:** create accepts and persists a note; whitespace-only is stored as absent; over-long
  is rejected; a production write path exists that is not the seed runner.
- **Proves it:** `lib/ops/advice-inputs-writable.test.ts` — **fails on the real defect** (verified),
  and excludes the seed runner *by name*, because counting it would have passed. Plus 7 behavioural
  tests in `vault-items.test.ts`.
- **The warning is load-bearing, not a disclaimer.** This field is metadata: stored in clear, read by
  the AI layer. It sits on a page headed *"the secret is encrypted in your browser"*. Without the
  "Not encrypted" line, a reasonable person types a password into it — a plaintext secret on a server
  path, the one thing the architecture exists to prevent. Guarded by
  `lib/ops/plaintext-field-warning.test.ts`, **proven to fail on a planted removal**.

### V2 · wiring · `1df3267` — the note now reaches the person it was written for

V1 made it writable. It still went nowhere: `getAccessItems` selected every column except that one,
so the note whose stated purpose is *"a recipient may not know where the original is kept"* was
invisible to recipients.

- **Acceptance:** a released recipient sees the note without clicking Reveal; a **pending** recipient
  does not.
- **The second half is a security line.** A note can legitimately read *"recovery codes are in the
  desk drawer"* — exactly the sentence that must not be readable before a release is verified.
  `toLimited` (Req 7.3) is an **allow-list**, so the note stays out *by construction*.
- **Proves it:** two new tests in `dashboard.test.ts`. **Planting the natural tidy-up** — spreading
  `...item` into `toLimited` — fails both the new test and the pre-existing Req 7.3 one. Verified.

### V3 · completeness · `8f0c021` — the importance engine was unreachable after onboarding

`runIntake` is the only thing that sets `is_root_credential`, `irreplaceable`, `recurring_billing`,
`importance_score` and `depends_on_item_id`. `/api/ai/intake` had **exactly one caller**:
`SeedWizard`, on `/start`.

A vault built the ordinary way — "Add item", one account at a time — was never classified. Nothing
said so. The consequences:

- `computeReveal`, the **J1 "aha"** naming the one account everything else depends on, returned its
  *"add a few more accounts"* fallback forever. That reveal renders **before any price is shown**.
- `detectGaps` never raised a `CUSTODY_RISK`, because nothing was ever marked irreplaceable — those
  are the items that cannot be regenerated from a login.
- `/vault` advertised *"most consequential first"* while sorting a column that was `0.5` on every row.

`api-reachability.ts` could not catch this: it asks whether a handler has *any* caller, and this one
did. *"Reachable once, during onboarding, never again"* is a different question.

- **Acceptance:** the vault offers a control that re-runs analysis; the 429 budget refusal reads as
  its own outcome, not a failure; the view re-ranks afterwards.
- **Safe by design:** `runIntake` re-reads the whole vault and an owner's explicit root override
  survives. The endpoint is metered twice (in-memory limiter + rolling 24h count in `audit_log`).
- **Proves it:** `lib/ops/importance-engine-reachable.test.ts`, **proven to fail** when the new caller
  is removed.

### V4 · completeness · `633c4ee` — the note reaches items that already exist

V1 put the note on the **create** form. That helped nobody who had already built a vault — which is
everybody. The only other write path is `PUT`, which demands a re-encrypted ciphertext because that
form *replaces* the secret rather than editing it. **Adding a note to an existing item meant retyping
its password**, so `detectGaps` went on flagging every pre-existing item with unactionable advice.

Extends the metadata-only `PATCH` that already existed for `owner_set_root`: same auth, same
scoping, no crypto. One field per call, because each writes a different audit action.

- **`setItemNote` assigns rather than COALESCEs** — the opposite of `updateItem`, on purpose. It
  closes the "cannot clear" debt V1 recorded: an owner who wrote down where something was kept and
  then moved it must be able to take that sentence back.
- **The audit records that the note changed and whether one exists — never its text.** The log is
  append-only and hash-chained, so a sentence written there could never be withdrawn, which would
  defeat clearing entirely.
- **Proves it:** 8 new tests on the PATCH handler, including that the previous `owner_set_root`
  contract is unchanged, that both fields at once is refused, and that the audit detail does not
  contain the note.

### V5 · security · `f9f1ccd` — pin what actually leaves for OpenAI

The zero-knowledge boundary has two halves and only one was pinned. `metadata-query.ts` decides which
**columns** leave the database and has a test. `classifyVaultItems` decides which of those leave the
**building** — an explicit six-field projection — and had no test at all.

**I went looking for a leak here and there wasn't one.** The projection is correct. What made it worth
a guard is V1: `backup_note` sits in `VaultMetadata`, so it is available at this seam, and until today
it was `null` for every real item — meaning widening the projection to `...i` would have leaked
nothing and looked harmless in review. Now owners can write it, and the placeholder the product
suggests is *"the codes are in the desk drawer"*.

- **Proves it:** planting the spread fails **four of five** tests, including the one asserting the
  note never appears in the request body. Verified.
- Also pins that the classification fields are not sent back to the model, which would let it anchor
  on the previous run instead of re-deciding.

## 5. Corrections I made to my own work during this sprint

Recorded because each was a wrong claim I acted on before checking.

| Claim | Reality |
|---|---|
| "Five more metadata columns have no write path" | **Wrong.** My sweep only scanned `vault-items.ts`. The intake agent writes all five. `backup_note` was the only orphan. |
| "The Edit tool wrote CRLF into the commit" | **Wrong.** My check counted lines containing the letter *r*. The committed blob has zero CR bytes. |
| "`backup_note` may be leaking to OpenAI" | **Wrong.** The projection is a correct allow-list. It became V5 as a guard, not a fix. |

One tooling incident: a Python script opened a test file for writing and then threw on an encoding
error, **truncating it**. Restored from git, 9 tests confirmed green, and I switched to the Edit tool
for the rest of the sprint.

## 6. Blocked

None. Every item completed inside its iteration.

## 7. Deferred, with scores

| Item | Score | Note |
|---|---|---|
| **Structured second-factor model** | — | The real answer to the opening question. **Needs a migration = sysadmin act = Steve.** Design below. |
| `irreplaceable` / `recurring_billing` not settable by hand | 4×2/1 = 8 | Mitigated by V3 (the analyse button sets them). Only bites an owner who never runs the analysis. |
| `email_send_attempts` retention | 2 | Carried from sprint 9. Years from mattering at current volume. |
| `scrollable-regions` raw-CSS coverage | 2 | Carried. Guard coverage, not a live defect. |
| `verify:iam` not in CI | — | Carried. Closing it means a credential in CI — infra change, Steve. |

**Design proposal for the second factor, for Steve to accept or reject — not started:**

Add `second_factor TEXT NULL` to `vault_items` with a CHECK of
`none · totp · passkey · sms · hardware_key · unknown`, defaulting to `unknown`. Then:

1. `assessPreparedness` stops counting an item as reachable when `second_factor` is `passkey` — a
   passkey genuinely cannot be handed over, so calling it reachable is false.
2. `detectGaps` raises a gap for `totp`/`sms` items with no `backup_note`, because the note is where
   the recovery instructions live.
3. The intake agent can infer it from the service name, and the owner can override it — the same
   `owner_set_*` pattern already proven for root credentials.

The migration is the blocking step and it is not mine to run.

## 8. Debt created

| Debt | Follow-up |
|---|---|
| `updateItem` still COALESCEs `backup_note`, so the secret-bearing PUT cannot clear a note | **Closed by V4** — clearing lives on the metadata PATCH, which is the right place for it. No action. |
| The note is shown to recipients but there is no owner preview of the recipient's view | Small. Worth doing before a real handover, not before beta. |

## 9. Recommended top 3

1. **Merge and deploy.** All five defects are on paths a real owner walks, and three of them made the
   product tell owners things that were not true. The claim-path fixes from sprint 9 are already live;
   these are the vault-side equivalent.
2. **Decide the second-factor model** (§7). It is the honest answer to the question that opened this
   sprint, it is the largest remaining hole between here and "fully in production", and it is blocked
   on one decision plus one migration.
3. **Then the beta cohort.** Unchanged from the last four sprints, and the reason is unchanged: the
   product is now measurably better than it was this morning and still has N=0 people in it.
