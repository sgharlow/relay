# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Relay is a "living-continuity" platform (H0 hackathon MVP). Owners build an encrypted vault of
accounts/credentials/documents/instructions, assign scoped access to recipients, and configure
verified trigger conditions. When a trigger fires, the system advances a release state machine
(`ARMED → PENDING → GRACE → RELEASED`) guarded by optimistic concurrency control. Emergencies are
reversible; estate handoffs are permanent. The default-safe state is always `ARMED`.

**Stack (locked):** Next.js 14 App Router (TypeScript) on Vercel · Aurora DSQL across two regions
(us-east-1 / us-west-2) · AWS KMS client-side envelope encryption · Vercel Cron · OpenAI · Resend.

The full source-of-truth specs live in `.kiro/specs/relay-h0-mvp/` (`requirements.md`, `design.md`,
`tasks.md`) and `specs/Relay_H0_Build_Spec_v2.md`. Read `design.md` before changing any
release/crypto/OCC logic — it defines the schema, state-transition table, and the demo spine.

## Build state (Kiro build stopped partway — read before continuing)

`npm run build`, `npx tsc --noEmit`, and `npx vitest --run` (**396 tests, 57 files**) are all green
through the full backend + all UI + recipient-release notifications.
**The entire backend is complete at the API layer** (28 routes) — owner CRUD, crypto/KMS, triggers,
heartbeat, confirm, simulate, recipient access + decrypt, all three AI agents, the audit log reader,
and the CSV batch import — backed by demo seed data + release_state provisioning. **Owner UI started: layout
+ vault dashboard + sign-in/error pages.** The sign-in flow is **visually verified** (Playwright:
`/auth/signin` and `/auth/error` render correctly; unauthenticated `/vault` redirects to
`/auth/signin` — the owner area is reachable end-to-end). The authenticated vault page itself is NOT
yet visually verified (needs a real demo session + live DB).

To visually verify UI: `npm run dev` then drive with Playwright. Stop the dev server afterward via
`Get-NetTCPConnection -LocalPort 3000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`
(PowerShell) — a detached `npm run dev &` survives `pkill`.

UI testing approach (no jsdom/RTL needed): keep the testable view logic as pure DB-free functions in
`lib/` (node-tested) and keep components thin. See `lib/vault/dashboard-view.ts` (tested) vs the thin
`src/app/(owner)/vault/page.tsx`. Components themselves are build-verified (tsc + next build), not
unit-tested — matching the repo convention (`src/app/**` excluded from coverage). Seed the demo DB with `npx tsx db/seeds/demo-seed.ts` (needs DSQL env
vars). The Intake Agent needs `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4o-mini`);
Prioritization + Triage are deterministic.

Next.js note: authenticated/DB-backed GET route handlers may be statically prerendered at build (which
hits the DB and fails) — add `export const dynamic = 'force-dynamic'` (see `src/app/api/audit/route.ts`).

**Implemented + tested:**
- DB foundation `lib/db/` (connection/pools, OCC retry, integrity) + migration `db/migrations/001_initial.sql`
- Auth `lib/auth/` (NextAuth options, owner session, recipient JWT, TOTP)
- **Crypto/KMS (Milestone 3):** `lib/crypto/crypto-service.ts` (AES-GCM-256 envelope, Property 5;
  IV is prepended into the single `ciphertext` blob via `packIvCiphertext`/`unpackIvCiphertext` —
  there is no `iv` column or field), `lib/kms/kms-client.ts` (KMS GenerateDataKey/Decrypt seam),
  `lib/kms/unwrap-gate.ts` (recipient gate, Property 6), `lib/audit/audit-service.ts` (hash-chained
  log, Property 16), `src/app/api/kms/wrap` + `src/app/api/kms/unwrap`.
- **Vault items API (task 7):** `lib/vault/vault-items.ts` (validation + persistence; Property 2 +
  Property 3) and routes `src/app/api/vault/items` (GET list metadata-only / POST create) +
  `src/app/api/vault/items/[id]` (GET full incl. ciphertext / PUT re-encrypt / DELETE cascade).
  Not-found and cross-owner both return 403 (existence not revealed, Req 1.8).
- **Recipients / verifiers / rules API (task 11):** `lib/people/recipients.ts`,
  `lib/people/verifiers.ts`, `lib/rules/access-rules.ts` (Property 7 estate-irreversible, Property 8
  N-of-M) + routes under `src/app/api/{recipients,verifiers,rules}` (+ `[id]`). Shared owner-route
  boilerplate in `lib/http/owner-route.ts` (`requireOwner`/`readJson`/`mapError`); shared
  `ValidationError` in `lib/validation.ts`. Recipient delete cascades access_rules; verifier delete
  cascades verifier_confirmations; rule create asserts both refs are owner-owned (cross-owner → 403).
  N-of-M (`required_confirmations`) lives on `release_state`; `validateNofM` is the tested primitive
  the release_state provisioning will call.
- **Release state machine (task 15):** `lib/release/state-machine.ts` — `ReleaseStateMachine` with
  CAS UPDATE guarded on (state, version), OCC 40001 retry → backoff → re-read → `safeResetToArmed`
  (ARMED is the safe default), the permitted-transition table (Property 11), and the GRACE→RELEASED
  `canRelease` guard (Property 12). Pure helpers `isPermittedTransition` / `isReversibleTrigger`
  (estate = non-reversible, Req 5.10) / `canRelease` are exported for callers. No route yet — it is
  the engine the next tasks wire up. Errors: `IllegalTransitionError` / `CasMismatchError` /
  `OccExhaustedError` / `GraceConditionError`.
- **Heartbeat + cron (task 16):** `lib/release/heartbeat.ts` — `isOverdue` (Property 9),
  `processCheckin` (owner heartbeat → reset reversible PENDING/GRACE→ARMED; estate mid-release is
  `blocked`, Property 10), `runHeartbeatSweep` (cron: overdue active owners → arm ARMED→PENDING, per-
  owner retry base 5s/max 3 then log+continue). Routes: `src/app/api/checkin` (PUT, 409 on blocked
  estate) + `src/app/api/cron/heartbeat` (POST, `CRON_SECRET` Bearer-gated). The PENDING-transition
  owner-alert email (Req 4.4) is now available via `notifyOwnerTriggerPending` (notification layer).
- **Verifier confirmation + triggers (task 17):** `lib/release/triggers.ts` —
  `submitConfirmation` (idempotent intent-read + CAS-increment + bounded OCC retry; drives
  GRACE→RELEASED when quorum met AND grace elapsed, else `pending_grace`; **Property 14**),
  `initiateTrigger` (ARMED→PENDING), `cancelTrigger` (GRACE→CANCELLED, reversible only). Auth:
  `lib/auth/verifier-token.ts` (HS256, `VERIFIER_JWT_SECRET` — added to `.env.example`). Notifications:
  `lib/notify/email.ts` (Resend wrapper, `sendEmailBestEffort` never throws) + `lib/notify/
  notifications.ts`. Routes under `src/app/api/triggers/[id]/{confirm,initiate,cancel}` — NOTE all
  three share the `[id]` slug (Next.js forbids differing slug names at one path position); for
  `initiate`, `[id]` carries the TRIGGER TYPE, for confirm/cancel it is the release_state id.
- **Simulate demo driver (task 18):** `lib/release/simulate.ts` `runSimulation` — demo fast-forward
  ARMED→PENDING→GRACE→RELEASED in ~10s (sleeps 3+3+4, injectable) using the SAME CAS transitions
  (Req 9.3), auto-satisfying the quorum at GRACE (Req 9.6), tagging every transition audit
  `simulated: true` and writing `suppressed: true` notification audit events. Route
  `src/app/api/demo/simulate` (POST) checks auth + `isDemo` BEFORE touching state (Req 9.1/9.7).
  The state machine's `TransitionOptions` gained an optional `auditDetail` (backward-compatible) to
  carry the `simulated` flag into transition audit entries.
- **Provisioning + seed (task 33):** `lib/release/provisioning.ts` — `ensureReleaseState`
  (idempotent one-row-per-(owner,trigger_type), Req 5.1) + `setRequiredConfirmations` (wires
  `validateNofM`/Property 8 into a real caller). Creating an access rule now provisions its trigger's
  release_state (wired in the rules POST route), so the 404 gap is closed. Seed: pure dataset in
  `lib/seed/demo-data.ts` (25 items, Gmail+1Password root, bank→Gmail risk-graph edges, 2 recipients/
  verifiers, emergency+estate rules), inserter `lib/seed/seed-runner.ts` (both unit-tested), CLI
  `db/seeds/demo-seed.ts`, and `scripts/demo-run.ts` (four-demo-moments runner). Seed ciphertext is a
  non-decryptable placeholder — seeded items exercise metadata views + the release flow, not
  decryption (importance scores set directly, not via the not-yet-built Intake Agent).
- **Recipient access dashboard API (task 21):** `lib/access/dashboard.ts` — `rankAccessItems`
  (root-first, importance desc, title-asc ties — Property 15), `getAccessDashboard` (recipient-JWT +
  strongly-consistent release_state read + version check → ranked full items when RELEASED, else
  limited pending fields per Req 7.3; audits `recipient_dashboard_viewed`), `decryptAccessItem`
  (RELEASED + version + access_rule gate BEFORE any KMS call; audits EVERY request authorized/denied
  per Req 7.8; returns `{plaintext_data_key, ciphertext, kms_key_id}`). Routes `src/app/api/access`
  (GET) + `src/app/api/access/[itemId]/decrypt` (POST). `AccessError` carries the HTTP status.
- **ZK metadata layer + Intake Agent (task 25):** `lib/ai/metadata-query.ts` `getVaultMetadata` —
  the ONLY data accessor for AI routes; SELECTs non-secret columns only (never ciphertext/wrapped/
  kms). `lib/ai/openai-client.ts` — OpenAI boundary (`classifyVaultItems`, lazy client,
  `_setOpenAIClientForTesting` seam, model via `OPENAI_MODEL`). `lib/ai/intake-agent.ts` `runIntake`
  — classifies → `clampScore` into [0,1] (Property 18) → resolves `depends_on_title`→id within the
  batch → persists via withOccRetry; on LLM failure/timeout defaults score 0.5 / not-root, lists
  `warnings`, never blocks (Req 11.9); batch cap 300. Route `src/app/api/ai/intake` (POST, owner).
  `runIntake` takes injectable `{classify, timeoutMs, batchLimit}` for testing.
- **Prioritization + Triage agents (tasks 26–27):** `lib/ai/prioritize-agent.ts` `runPrioritize` —
  derives ranked gaps (`detectGaps`: CUSTODY_RISK for irreplaceable-without-recipient/note,
  MISSING_NOTE; ranked root-first then importance, Req 12.2–12.4; recomputed each call, no persisted
  flag). `lib/ai/triage-agent.ts` `runTriage` — `bucketFor` (Property 20) + `buildTriagePlan`
  (Kahn topological sort, roots/dependency-free first, deps treated resolved if out-of-scope —
  Property 19) + estate provider guidance (Apple/Google/Meta) + flat fallback (Req 13.8). **Both are
  DETERMINISTIC** (rule-based; the importance scores they consume come from the LLM-based Intake
  Agent) — required because Properties 19/20 are exact invariants an LLM can't guarantee. Routes
  `src/app/api/ai/prioritize` (POST) + `src/app/api/ai/triage` (POST, body `{recipient_id,
  trigger_type}`).
- **Audit reader (task 28):** `lib/audit/chain.ts` — extracted pg-free hash-chain primitives
  (`canonicalJson`/`sha256`/`computeEntryHash`/`GENESIS_PREV_HASH`) + `verifyAuditChain(entries)`
  (re-derives the chain, returns `{valid, brokenSeq, reason}` — `entry_hash_mismatch` /
  `prev_hash_mismatch`). `audit-service.ts` now imports these (re-exports `canonicalJson`/`sha256`
  for back-compat). Route `src/app/api/audit` (GET, owner) returns `{entries, verification}` —
  owner-scoped, ascending seq, server-side tamper-check. `force-dynamic` (see note above).
- **CSV import (task 13.2/13.3):** `lib/import/csv-parser.ts` — `parseCSV(file, format)` (client-side,
  no upload of raw CSV); RFC-4180 tokenizer, per-format column mapping (1Password/Bitwarden/LastPass/
  Chrome/Firefox; Firefox derives service_name from url host), `detectFormat` auto-detect, missing-
  field + case-insensitive (service_name,url) dedup skips with reasons, >10MB / wrong-format → CsvError.
  Batch route `src/app/api/import` (POST) — validates the WHOLE batch upfront (any invalid → 400, no
  inserts, Req 10.4), then createItem per item (withOccRetry); never decrypts; returns `{imported}`.
- **Owner layout + vault dashboard (tasks 12.1/12.2):** `src/app/(owner)/layout.tsx` (OwnerLayout —
  server component, `getOwnerSession` gate → redirect `/auth/signin`; blue/neutral dense shell;
  `_components/SidebarNav.tsx` client nav with active highlight) + `src/app/(owner)/vault/page.tsx`
  (client; fetches `/api/vault/items`, groups/sorts via `lib/vault/dashboard-view.ts`, ROOT + "gates
  N" badges, Import/Add CTAs). Root metadata set to "Relay".
- **Sign-in flow:** `src/app/auth/signin/` (server page + Suspense + `SignInForm.tsx` client — email +
  6-digit TOTP via the `email-totp` credentials provider; `signIn(..., {redirect:false})` then
  router-push to an open-redirect-safe callback) and `src/app/auth/error/` (NextAuth `pages.error`).
  `lib/auth/safe-redirect.ts` `safeInternalPath` (tested) guards the callback. TOTP codes validate
  against `TOTP_SECRET` (base32) via `lib/auth/totp.ts`.
- **Recipients/rules screens (task 12.3):** `src/app/(owner)/recipients/page.tsx` (recipient +
  verifier list/create/delete) and `src/app/(owner)/rules/page.tsx` (rule list + builder — vault item
  & recipient selectors, trigger/scope, reversible checkbox forced-off+disabled for estate per
  Property 7). Shared client fetch helper `src/app/(owner)/_lib/api.ts` (surfaces server `{message}`).
  Domain enums moved to pg-free `lib/domain/enums.ts` (VALID_ROLES/TRIGGER_TYPES/SCOPES) so client
  forms import them without pulling `pg`; `recipients.ts`/`access-rules.ts` re-export for back-compat.
  N-of-M is NOT in the rule builder (it lives on release_state; configured on the Triggers screen).
  Compiles + inherits the owner auth gate; authenticated forms not yet visually verified (need a session).
- **Triggers/simulate screen (task 19.1):** `src/app/(owner)/triggers/page.tsx` (client) — per-trigger
  state badges, check-in cadence form, N-of-M config per trigger, Initiate (ARMED), Cancel (GRACE +
  reversible), and a demo-only Simulate panel with a 10s countdown bar. New backend:
  `lib/release/release-list.ts` (`listReleaseStates` / `getCheckinInterval` / `updateCheckinInterval`
  [1–365, Req 4.1] / `getVerifierCount`) + routes `GET /api/triggers` (releaseStates + cadence +
  isDemo; force-dynamic), `PUT /api/settings` (cadence), `PUT /api/triggers/[id]/config` (N-of-M —
  `[id]`=trigger type, validates N≤M via `setRequiredConfirmations`/Property 8). All lib + routes
  tested; the page compiles + is gated, authenticated render not visually verified (needs session).
- **Access dashboard UI (task 22):** `src/app/(access)/layout.tsx` (AccessLayout — warm amber on
  white, bold 19px, minimal chrome; distinct "Access mode") + `src/app/(access)/access/page.tsx`
  (server shell + Suspense) + `AccessClient.tsx` (client). Reads `?token=`, loads `GET /api/access`;
  invalid → friendly error, pending → limited-field view, RELEASED → numbered step plan grouped by
  time-horizon bucket (`bucketFor`). Click "Reveal" → `POST /api/access/[id]/decrypt` →
  `CryptoService.decryptItem` (unpack IV) in-browser; value lives only in component state. `bucketFor`
  extracted to pg-free `lib/ai/buckets.ts` (re-exported from triage-agent) for client use.
  **VISUALLY VERIFIED** (Playwright): Access-mode frame renders + invalid-token → "invalid or expired"
  message. The RELEASED/triage view + decrypt need a valid recipient token + released state + live DB
  (and real-encrypted items — seed ciphertext is a placeholder, won't decrypt).
- **Add-item form (task 12.2 CTA):** `src/app/(owner)/vault/new/page.tsx` (client) — metadata fields
  (type/category/criticality dropdowns from `lib/domain/enums`) + secret textarea → `new
  CryptoService().saveItem(secret, metadata)` runs the FULL client envelope flow (POST /api/kms/wrap →
  AES-GCM encrypt in-browser → POST /api/vault/items) → returns to /vault. This produces REAL
  decryptable items (unlike the seed). vault-item enums (`VALID_TYPES`/`CATEGORIES`/`CRITICALITY`)
  moved to `lib/domain/enums.ts`; `vault-items.ts` re-exports. Compiles + gated; authenticated
  encrypt-and-save not visually verified (needs session + KMS + DSQL).
- **CSV import page (task 13.1):** `src/app/(owner)/import/page.tsx` (client) — file picker →
  auto-detect format (`detectFormat`) + manual override → `parseCSV` preview table (mapped columns +
  skip report) → encrypt EVERY row in-browser via `CryptoService.encryptForUpload` (new method that
  wraps+encrypts WITHOUT uploading) → batch `POST /api/import`; progress bar; aborts the whole batch
  if any row fails to encrypt (Req 10.4). Parsing is client-side (Req 10.2) but on the MAIN THREAD —
  a Web Worker (Req 10.1 perf) is a noted deferral. `saveItem` refactored to use `encryptForUpload`
  (DRY; all crypto tests green). Parser logic + `encryptForUpload` are unit-tested; the authenticated
  page flow not visually verified (needs session + KMS + DSQL).
- **Audit viewer (task 29.1):** `src/app/(owner)/audit/page.tsx` (client) — paginated table (seq, ts,
  actor, action, entity, collapsed detail JSON, truncated entry_hash + copy), server verification
  badge from `GET /api/audit`, and a **"Verify chain" button that recomputes hashes CLIENT-SIDE**
  (Web Crypto SHA-256 over `lib/audit/canonical.ts` `canonicalJson`) and highlights the first broken
  link. Canonical logic extracted to pg-free/crypto-free `lib/audit/canonical.ts` (chain.ts +
  audit-service re-export). `lib/audit/web-crypto-parity.test.ts` proves Web Crypto hex === node
  `createHash` hex, so the client recompute agrees with the server.

**ALL spec'd screens now exist.** Remaining work is polish/ops only (despite `tasks.md` checkboxes —
unreliable; trust the filesystem + passing tests): design polish (32), single-vault guard (31, small
server tweak + migration 002), demo/submission assets (34–35), a real Web Worker for CSV parse (perf,
Req 10.1), and the `/auth/signin` page already exists. **Backend: 27 routes, all tested. UI complete**
— Owner: layout, vault, add-item, recipients, rules, triggers, import, audit; Access: dashboard;
Auth: sign-in/error. The big remaining gap is END-TO-END VISUAL VERIFICATION of authenticated flows
(needs TOTP_SECRET + KMS_KEY_ID + live DSQL — only the sign-in + access-error paths verified so far).
**Run `docs/e2e-verification.md` against live infra** to close this — it's the full dogfood checklist
(prereqs, migrate, seed, sign-in, crypto round-trip, release spine, recipient decrypt, AI, audit, the
4 demo moments) + the known integration RISKS most likely to break on real infra:
- **Risk A:** `auth-options.ts` upsert uses `ON CONFLICT (auth_sub)` but migration 001 indexes
  `auth_sub` NON-uniquely → sign-in upsert may error on real PG/DSQL. **Drafted fix:
  `db/migrations/002_unique_auth_sub.sql`** (apply via `npx tsx db/migrations/migrate.ts
  002_unique_auth_sub.sql` — `migrate.ts` now takes an optional filename arg, default 001). NOT
  applied — infra/schema change needing snapshot + sign-off; header documents the DSQL caveats +
  a no-schema-change alternative (app-level intent-read upsert) if DSQL can't enforce UNIQUE.
- **Risk B:** RESOLVED — `notifyRecipientsOfRelease` (lib/notify/notifications.ts) emails each scoped
  recipient an `/access?token=…` link, auto-wired into `submitConfirmation`'s released path (real
  releases only; simulate suppresses per Req 9.5). Manual re-send: `POST /api/triggers/[id]/notify`
  (id=release_state id, owner-authed) → `resendReleaseNotifications`. Verify live email delivery.
- **Risk C:** seed items use placeholder ciphertext → NOT decryptable; only `/vault/new` + `/import`
  items decrypt.
- Fixed while writing the checklist: seed `auth_sub` now `credentials:<email>` (was `demo|<email>`)
  so sign-in lands on the seeded demo row (keeps `is_demo` + the 25 items).
`tasks.md` remains the correct ordering plan.

**Resume notes:**
- The `src/src/app/` duplicate-scaffold cruft has been removed; git is initialized (no remote).
- `tsconfig.json` now sets `target: ES2020` — required for the `bigint` OCC version type to compile
  (this was a Kiro build blocker). If `tsc` reports stale errors after a config change, delete
  `tsconfig.tsbuildinfo` (incremental cache).
- `.eslintrc.json` ignores `^_`-prefixed unused vars so intentionally-unused args don't fail the build.

## Commands

```bash
npm run dev            # next dev (http://localhost:3000)
npm run build          # next build — production build
npm run lint           # next lint (eslint-config-next)
npm test               # vitest --run (one-shot, the default)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest --coverage (v8; thresholds 80/80/70/80 lines/fn/branches/stmts)

npx vitest --run lib/db/occ.test.ts          # run a single test file
npx vitest --run -t "OCC retry"              # run tests matching a name
npx tsx db/migrations/migrate.ts             # apply SQL migrations (needs DSQL env vars)
```

Test layout: vitest collects `src/**/*.test.ts(x)` and `lib/**/*.test.ts`. Tests live **next to the
code** (e.g. `lib/db/occ.ts` + `lib/db/occ.test.ts`). `environment: 'node'`, `globals: true`.
Property-based tests use `fast-check` (100 runs min; 500 for state-machine/OCC properties) and are
tagged `// Feature: relay-h0-mvp, Property N`. `src/app/**` (Next pages/layouts) is excluded from
coverage and tested separately.

Path alias `@/*` → `./src/*` (set in both `tsconfig.json` and `vitest.config.ts`). Note `lib/` is at
the repo root, **outside** `src/`, so it is imported by relative path, not via `@/`.

## Environment

No `.env.local` is committed. Copy `.env.example` → `.env.local`. Pools and KMS init lazily, so DB
env vars are only required when DB/KMS code actually runs (tests that don't touch the DB pass
without them). AWS provisioning lives in `docs/aws-setup.md` + `scripts/provision-dsql.sh`;
`infra/iam-policy.json` holds the `dsql:DbConnect` role.

## Architecture — the non-obvious invariants

These cut across multiple files and are easy to break. Preserve them.

- **Aurora DSQL has no FK constraints and no sequences.** All PKs are UUIDs, referential integrity
  is enforced in the *application* layer (`lib/db/integrity.ts`: `assertOwns`, `cascadeDelete`,
  `assertNoCrossOwner`, throwing `IntegrityError`). Never assume the DB will cascade or reject a
  cross-owner reference — call these helpers.

- **DSQL uses snapshot isolation → concurrent write conflicts surface as SQLSTATE `40001`.** Any
  write that can race must go through `withOccRetry()` (`lib/db/occ.ts`): 3 attempts, exponential
  backoff `min(baseDelay·2^attempt + jitter, maxDelay)`. State transitions use a compare-and-swap
  `UPDATE ... WHERE id=$ AND state=$ AND version=$`. **On OCC exhaustion the row must end in
  `ARMED`** (`safeResetToArmed`) — this safe-default invariant is the core correctness story; never
  let an exhausted retry leave a row in a releasing state.

- **Multi-region failover is an env switch, not infra.** `lib/db/connection.ts` keeps `primaryPool`
  + `secondaryPool`. `DSQL_USE_SECONDARY=true` forces all traffic to us-west-2 (the live demo
  failover). It also auto-rotates to secondary on a primary connection error (60s unhealthy window).
  Do not add infra-level failover — the demo relies on this env toggle.

- **Plaintext never leaves the browser (client-side envelope encryption).** The browser generates a
  per-item AES-GCM-256 data key via SubtleCrypto, encrypts, then calls `/api/kms/wrap` to wrap the
  data key with the KMS CMK. The server stores only `ciphertext` + `wrapped_data_key` and **never**
  logs the plaintext data key. Recipient decrypt only unwraps when `release_state = 'released'` AND
  an `access_rules` row links recipient→item (Property 6). Never add a server path that handles
  plaintext secrets.

- **AI agents see metadata only (zero-knowledge boundary).** `lib/ai/metadata-query.ts`
  `getVaultMetadata(ownerId)` is the *only* permitted data accessor inside `/api/ai/*` handlers. It
  explicitly excludes `ciphertext`, `wrapped_data_key`, `kms_key_id`. Never pass secret columns to
  an LLM. `importance_score` must always be clamped to `[0.0, 1.0]`.

- **Two emotional UI modes, separate route groups.** `app/(owner)/*` = Owner mode (blue/neutral,
  dense, 14–16px). `app/(access)/*` = Access mode (warm amber, white, bold 18–20px, minimal chrome).
  They use different sessions: Owner via NextAuth (`getOwnerSession()`, MFA/TOTP enforced), recipient
  via scoped HS256 JWT (`lib/auth/recipient-token.ts`) carrying `release_state_id` + `version`; a
  JWT whose `version` ≠ the current `release_state.version` is rejected (re-arm invalidates tokens).

- **Audit log is append-only and hash-chained per owner.** Each entry:
  `entry_hash = SHA-256(prev_hash || canonicalJson(entry))`, first entry `prev_hash = '0'*64`.
  INSERT-only, never UPDATE/DELETE. Audit writes **block** the triggering operation if they fail —
  by design, do not make them best-effort.

## Conventions observed in the existing code

- Pools/clients initialize lazily so missing env vars don't crash at import time during tests.
- Pure logic is factored out of route handlers into `lib/` so it can be property-tested without a
  running server or DB (mock the `pg`/KMS/OpenAI boundary in tests).
- Source files carry a header comment citing the `Requirements: N.N` they satisfy — keep this
  traceability when adding files, referencing `.kiro/specs/relay-h0-mvp/requirements.md`.

## Notes

- No git repository is initialized here yet (`git init` if you need version control).
- `README.md` is still the default create-next-app boilerplate — not a source of project info.
