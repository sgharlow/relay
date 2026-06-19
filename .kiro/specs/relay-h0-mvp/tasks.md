# Implementation Plan: Relay H0 MVP

## Overview

Twelve-day hackathon build. Tasks are grouped by milestone day-range and ordered so each step
compiles and runs before the next begins. The demo spine — reversible emergency flow, live region
failover, OCC correctness, importance/risk-graph reveal — is de-risked first (Days 1–8).
Cuttable work (threshold crypto, Plaid, document OCR, hash-chained audit, third AI agent) is
sequenced last so slipping the schedule never endangers the four demo moments.

**Language / runtime:** TypeScript — Next.js 14 App Router on Vercel.
**Test framework:** Vitest + fast-check for property-based tests; Playwright for UI smoke.

---

## Tasks

### Milestone 1 — Days 1–2: Project Scaffold, Aurora DSQL, OCC Foundation

- [ ] 1. Scaffold Next.js 14 App Router project and configure Vercel deployment
  - [-] 1.1 Initialise Next.js 14 App Router project with TypeScript, Tailwind CSS, and ESLint; configure `vercel.json` with cron schedule `{"path":"/api/cron/heartbeat","schedule":"0/30 * * * *"}`; set up `src/` directory alias
    - Create the `app/(owner)/`, `app/(access)/`, and `app/api/` route-group directories
    - Add `.env.example` with all required environment-variable keys (no values)
    - _Requirements: 14.1 (two-region provisioning groundwork)_
  - [x] 1.2 Install and pin exact versions of runtime dependencies: `pg`, `@aws-sdk/client-kms`, `openai`, `resend`, `next-auth`, `fast-check`, `vitest`, `@vitest/coverage-v8`
    - Add `vitest.config.ts` with `globals: true`, `environment: 'node'`, coverage thresholds
    - _Requirements: 5.7 (OCC retry lib dependency), 17.3 (IAM auth for DSQL)_

- [ ] 2. Provision Aurora DSQL and apply full DDL migration
  - [-] 2.1 Provision Aurora DSQL cluster across `us-east-1` and `us-west-2`; record both regional endpoint URLs; create IAM role for backend service with `dsql:DbConnect` permission; output `DSQL_PRIMARY_ENDPOINT`, `DSQL_SECONDARY_ENDPOINT`, `DSQL_CLUSTER_ARN` env vars
    - _Requirements: 14.1, 17.3_
  - [x] 2.2 Write and apply the full DDL migration in `db/migrations/001_initial.sql`: all seven tables (`users`, `recipients`, `verifiers`, `vault_items`, `access_rules`, `release_state`, `verifier_confirmations`, `audit_log`) with exact column types, CHECK constraints, and covering indexes as specified in the design schema; no FK constraints (DSQL does not enforce them)
    - Include DSQL-specific notes: UUID PKs, no SEQUENCE, no FK, OCC via snapshot isolation
    - _Requirements: 1.2–1.4, 3.1–3.3, 5.1, 6.1, 8.1–8.4_

- [x] 3. Implement multi-region connection manager (`lib/db/connection.ts`)
  - [x] 3.1 Create `lib/db/connection.ts` with two `pg.Pool` instances (`primaryPool`, `secondaryPool`); implement `getPool()` that returns secondary when `DSQL_USE_SECONDARY=true` or primary pool `totalCount === 0`; include 5-second connection timeout and 60-second unhealthy window before re-checking primary
    - Export `query(sql, params)` wrapper that calls `getPool().query(...)` and catches connection errors to rotate to secondary
    - _Requirements: 14.2, 14.3_
  - [x] 3.2 Implement `lib/db/occ.ts`: export `OCC_RETRY` config object `{maxAttempts:3, baseDelayMs:100, jitterMs:50, maxDelayMs:1000}`; export `withOccRetry<T>(fn: () => Promise<T>): Promise<T>` that catches SQLSTATE `40001`, applies `min(baseDelay * 2^attempt + jitter, maxDelayMs)` backoff, and re-throws after exhaustion; export `isSqlState40001(err)` predicate
    - _Requirements: 5.7, 6.9, 16.3_
  - [x] 3.3 Write property test for OCC retry safety (Property 13)
    - **Property 13: OCC retry with safe default — any release state transition that exhausts 3 retries must result in ARMED state**
    - Mock DB driver to return SQLSTATE 40001 on every attempt; assert final state equals `'armed'`
    - Run 500 iterations; tag `// Feature: relay-h0-mvp, Property 13`
    - **Validates: Requirements 5.7, 5.9**

- [~] 4. Checkpoint — infrastructure baseline passes
  - Verify `vitest --run` passes (OCC property test green). Confirm both DSQL regional endpoints respond to a simple `SELECT 1`. Confirm Vercel preview deploy succeeds with env vars set. Ask the user if questions arise.

---

### Milestone 2 — Day 3: Authentication, Session Tokens, Owner CRUD

- [x] 5. Implement authentication and session management
  - [x] 5.1 Configure NextAuth.js v5 with an email/TOTP provider; implement `app/api/auth/[...nextauth]/route.ts`; enforce MFA — `signIn` callback must reject sessions without a valid TOTP factor; store `auth_sub` mapping to `users.id` on first sign-in (upsert pattern)
    - Expose `getOwnerSession()` helper that returns `{ownerId, isDemo}` or throws 401
    - _Requirements: 17.1_
  - [x] 5.2 Implement recipient scoped JWT issuance: `lib/auth/recipient-token.ts` — `issueRecipientToken(recipientId, releaseStateId, version)` → signs HS256 JWT with 24-hour expiry; `verifyRecipientToken(token)` → returns payload or throws; store `release_state_id` and `version` in token claims
    - _Requirements: 15.2, 17.2_

- [ ] 6. Implement referential integrity layer (`lib/db/integrity.ts`)
  - [x] 6.1 Create `lib/db/integrity.ts` with: `assertOwns(ownerId, table, id)` — verifies row exists and `owner_id` matches; `cascadeDelete(table, parentId, fkColumn)` — collects and deletes dependent rows; `assertNoCrossOwner(ownerId, ...refs)` — batch version of `assertOwns`; all functions use `withOccRetry` and throw typed `IntegrityError`
    - _Requirements: 16.1, 16.2, 16.3_
  - [ ] 6.2 Write property test for cross-owner authorization isolation (Property 4)
    - **Property 4: Cross-owner authorization isolation — for any two distinct owner IDs A and B, owner A reading/updating/deleting a vault item owned by B must receive an authorization error, never a data row**
    - Use `fc.tuple(fc.uuid(), fc.uuid()).filter(([a,b]) => a !== b)` for owner pairs
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 4`
    - **Validates: Requirements 1.5, 1.8, 15.6**

---

### Milestone 3 — Day 4: Vault CRUD, KMS Proxy, Crypto Boundary

- [ ] 7. Implement vault item CRUD API routes
  - [~] 7.1 Implement `app/api/vault/items/route.ts` (GET list, POST create): `GET` returns metadata-only projection (excludes `ciphertext`, `wrapped_data_key`); `POST` accepts `{ciphertext, wrapped_data_key, kms_key_id, title, service_name, url, category, criticality, type}`, calls `assertOwns` for vault, inserts row, returns `{id, ...metadata}`; enforce title 1–200 chars and url ≤ 2048 chars; reject invalid `type` or `category` values with 400
    - _Requirements: 1.1–1.4_
  - [~] 7.2 Implement `app/api/vault/items/[id]/route.ts` (GET, PUT, DELETE): all three handlers call `assertOwns(ownerId, 'vault_items', id)` first; `DELETE` calls `cascadeDelete('access_rules', id, 'vault_item_id')` before deleting the item; `PUT` updates `ciphertext`, `wrapped_data_key`, and `updated_at`
    - _Requirements: 1.6, 1.7, 1.8_
  - [~] 7.3 Write property test for vault item metadata round-trip (Property 3)
    - **Property 3: Vault item metadata round-trip — any valid (title 1–200 chars, url ≤ 2048 chars, valid category, criticality, type) must survive create → read unchanged**
    - Use `fc.record({title: fc.string({minLength:1, maxLength:200}), ...})` generators
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 3`
    - **Validates: Requirements 1.4**
  - [~] 7.4 Write property test for invalid vault item type rejection (Property 2)
    - **Property 2: Invalid vault item types are always rejected — any string not in {login,account,document,note,instruction} must be rejected with 400, no row persisted**
    - Filter with `.filter(s => !VALID_TYPES.includes(s))`
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 2`
    - **Validates: Requirements 1.3**

- [ ] 8. Implement KMS proxy routes
  - [~] 8.1 Implement `app/api/kms/wrap/route.ts`: authenticated Owner session required; calls `KMS.GenerateDataKey({KeyId: process.env.KMS_KEY_ID, KeySpec: 'AES_256'})`; returns `{wrapped_data_key: base64, kms_key_id}` and the `plaintext_data_key` (base64) to the browser for in-memory use only; never logs `plaintext_data_key`; writes audit entry `action:"kms_wrap_requested"`
    - _Requirements: 2.2, 17.4_
  - [~] 8.2 Implement `app/api/kms/unwrap/route.ts`: accepts `{wrapped_data_key, vault_item_id}`; verifies owner or recipient session; for recipient: checks `release_state = 'released'` AND `access_rules` row exists; calls `KMS.Decrypt`; returns `{plaintext_data_key}` to browser; writes audit entry; any gate failure → 403, no KMS call
    - _Requirements: 2.4, 7.5, 17.4_
  - [~] 8.3 Write property test for KMS unwrap scoped to access rules (Property 6)
    - **Property 6: KMS unwrap call is made if and only if an access_rule row exists linking recipient_id to vault_item_id AND release_state is RELEASED**
    - Generate random (recipient, item, rule-present, state) combinations; assert KMS mock is called exactly when both conditions hold
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 6`
    - **Validates: Requirements 2.4, 7.5**

- [ ] 9. Implement client-side crypto boundary (`CryptoService`)
  - [~] 9.1 Create `lib/crypto/crypto-service.ts` with `CryptoService` class: `encryptItem(plaintext: string): Promise<{ciphertext: Uint8Array, iv: Uint8Array}>` — calls `window.crypto.subtle.importKey` + `encrypt(AES-GCM-256)`; `decryptItem(ciphertext, iv, plainDataKey): Promise<string>`; full flow `saveItem(plaintext, metadata)` calls `/api/kms/wrap`, encrypts, discards plaintext key, POSTs to `/api/vault/items`; on any crypto failure: abort, surface error message via thrown `CryptoError`, transmit nothing
    - _Requirements: 2.1, 2.2, 2.7_
  - [~] 9.2 Write property test for zero plaintext at rest (Property 5)
    - **Property 5: Zero plaintext at rest — for any plaintext string, after encrypt-and-save the stored ciphertext must not equal the UTF-8 bytes of the original plaintext**
    - Mock KMS; mock DB INSERT capture; assert `stored.ciphertext !== Buffer.from(plaintext)`; also assert `wrapped_data_key` is non-null
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 5`
    - **Validates: Requirements 2.3**

- [~] 10. Checkpoint — vault + crypto demo path works
  - `vitest --run` green (Properties 2, 3, 4, 5, 6). Manually create one vault item end-to-end (browser → KMS → DSQL) in the Vercel preview. Confirm DB row contains no plaintext. Ask the user if questions arise.

---

### Milestone 4 — Days 5–6: Recipients, Rules, Dashboard UI Screens

- [ ] 11. Implement recipients, verifiers, and access rules API routes
  - [~] 11.1 Implement `app/api/recipients/route.ts` (GET, POST) and `app/api/recipients/[id]/route.ts` (PUT, DELETE): `POST` validates `role` in `{recipient,executor,caregiver,partner}` and all required fields; `DELETE` calls `cascadeDelete('access_rules', id, 'recipient_id')` before removing row; all handlers call `assertOwns`
    - _Requirements: 3.1, 3.6_
  - [~] 11.2 Implement `app/api/verifiers/route.ts` and `app/api/verifiers/[id]/route.ts`: `DELETE` calls app-level delete of all `verifier_confirmations` rows for that verifier before deleting the verifier row; validate required fields
    - _Requirements: 3.2, 3.7_
  - [~] 11.3 Implement `app/api/rules/route.ts` (GET, POST) and `app/api/rules/[id]/route.ts` (PUT, DELETE): `POST` validates all required fields (`vault_item_id`, `recipient_id`, `trigger_type`, `scope`, `reversible`); rejects `estate` rule with `reversible=true` with explicit error message; validates `required_confirmations` N ≥ 1, M ≥ N, M ≥ 1; calls `assertNoCrossOwner` for `vault_item_id` and `recipient_id`
    - _Requirements: 3.3–3.5, 3.8, 3.9_
  - [~] 11.4 Write property test for estate rules always irreversible (Property 7)
    - **Property 7: Estate rules are always irreversible — for all possible values of other fields, setting trigger_type='estate' and reversible=true must be rejected**
    - Use `fc.record({...allOtherFields})` with fixed `trigger_type:'estate'` and `reversible:true`
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 7`
    - **Validates: Requirements 3.5**
  - [~] 11.5 Write property test for N-of-M constraint enforcement (Property 8)
    - **Property 8: N-of-M constraint enforcement — any (N,M) where N > M, N < 1, or M < 1 must be rejected**
    - Generate `fc.tuple(fc.integer(-5,20), fc.integer(-5,20)).filter(([n,m]) => n>m || n<1 || m<1)`
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 8`
    - **Validates: Requirements 3.9**

- [ ] 12. Build Owner UI layout and core navigation
  - [~] 12.1 Implement `app/(owner)/layout.tsx` as `OwnerLayout`: blue/neutral palette, sidebar nav with links to `/vault`, `/import`, `/recipients`, `/rules`, `/triggers`, `/audit`; information-dense, 14–16 px body type, low saturation; uses `getOwnerSession()` — redirects to `/auth/signin` if unauthenticated
    - _Requirements: (Owner mode two-emotional-mode design)_
  - [~] 12.2 Implement vault dashboard screen `app/(owner)/vault/page.tsx`: fetches `GET /api/vault/items`; renders items grouped by category and sorted by criticality and `importance_score` descending; shows `is_root_credential` badge; renders `depends_on_item_id` edges as inline risk-graph reveal (tooltip showing "gates N resets"); import and add-item CTAs
    - _Requirements: 7.4, 11.1, 11.8_
  - [~] 12.3 Implement recipients, verifiers & rules screen `app/(owner)/recipients/page.tsx` and `app/(owner)/rules/page.tsx`: forms for creating/editing recipients and verifiers; rule builder with trigger-type selector, scope toggle, reversible checkbox (disabled + tooltip for estate); N-of-M configuration fields; inline validation error messages
    - _Requirements: 3.1–3.9_

- [ ] 13. Build add-items and CSV import screen
  - [~] 13.1 Implement `app/(owner)/import/page.tsx`: CSV file-picker with format detection (1Password, Bitwarden, LastPass, Chrome, Firefox); all parsing runs client-side in a Web Worker; preview table showing mapped columns before encrypt; progress bar during batch encrypt-and-upload; completion report (imported count, skipped count, skip reasons); abort entire import if any encryption fails
    - _Requirements: 10.1–10.9_
  - [~] 13.2 Implement client-side CSV parse utility `lib/import/csv-parser.ts`: `parseCSV(file: File, format: CsvFormat): ParseResult` — maps source-specific column names to `{service_name, url, username, password}`; skips rows with missing required fields (records row + reason); deduplicates on case-insensitive `(service_name, url)` — skip + record; validates file ≤ 10 MB and valid CSV structure; returns `{rows, skipped, errors}`
    - _Requirements: 10.2, 10.3, 10.6, 10.7, 10.9_
  - [~] 13.3 Implement batch upload API route `app/api/import/route.ts`: POST accepts `{items: [{ciphertext, wrapped_data_key, kms_key_id, ...metadata}]}`; validates each item's metadata; calls `withOccRetry` for each INSERT; does not decrypt anything; returns count of persisted items
    - _Requirements: 10.4, 10.8_

- [~] 14. Checkpoint — UI screens are navigable and wired to real data
  - Open each screen in the Vercel preview and verify no console errors. Add one recipient, one verifier, one rule. Import a 10-row CSV and confirm vault count increments. Ask the user if questions arise.

---

### Milestone 5 — Days 7–8: Release State Machine, Heartbeat, Verification (Demo Spine)

- [ ] 15. Implement release state machine (`lib/release/state-machine.ts`)
  - [~] 15.1 Create `lib/release/state-machine.ts` with `ReleaseStateMachine` class: implement `transition(id, expectedState, nextState, expectedVersion, updates)` using the CAS UPDATE pattern (`WHERE id=$2 AND state=$3 AND version=$4`); on `rowCount===0` re-read row and throw `CasMismatchError`; on SQLSTATE 40001 retry via `withOccRetry`; on exhaustion call `safeResetToArmed(id)` then throw `OccExhaustedError`; enforce permitted-transition table — reject any `(from,to)` not in the table at the application layer before any DB write; default ARMED state invariant
    - Permitted transitions: ARMED→PENDING, PENDING→GRACE, PENDING→ARMED (reversible only), GRACE→RELEASED, GRACE→ARMED (reversible only), GRACE→CANCELLED (reversible only), RELEASED→ARMED (reversible non-estate only)
    - _Requirements: 5.1–5.9_
  - [~] 15.2 Write property test for only permitted transitions succeed (Property 11)
    - **Property 11: Only permitted state transitions succeed — any (current_state, attempted_next_state) pair not in the permitted table must be rejected for all trigger types and all version values**
    - Generate `fc.tuple(fc.constantFrom(...ALL_STATES), fc.constantFrom(...ALL_STATES))` filtered to non-permitted pairs
    - Run 500 iterations; tag `// Feature: relay-h0-mvp, Property 11`
    - **Validates: Requirements 5.2**
  - [~] 15.3 Write property test for GRACE→RELEASED requires both conditions (Property 12)
    - **Property 12: GRACE→RELEASED requires both conditions — transition must not occur if received < required OR grace has not elapsed**
    - Use `fc.record({received: fc.nat(10), required: fc.integer(1,10), graceElapsed: fc.boolean()}).filter(r => r.received < r.required || !r.graceElapsed)`
    - Run 500 iterations; tag `// Feature: relay-h0-mvp, Property 12`
    - **Validates: Requirements 5.5**

- [ ] 16. Implement heartbeat check-in endpoint and Vercel Cron handler
  - [~] 16.1 Implement `app/api/checkin/route.ts` (PUT): call `getOwnerSession()`; UPDATE `users.last_active_at = now()`; for each reversible trigger type where current state is `PENDING` or `GRACE`: call `stateMachine.transition(id, current, 'armed', version)`; for `estate` triggers in PENDING/GRACE: return 409 with explicit error message; write audit entry `action:"owner_checkin"`
    - _Requirements: 4.2, 4.5_
  - [~] 16.2 Implement `app/api/cron/heartbeat/route.ts` (POST): validate `CRON_SECRET` header; SELECT all `users` where `now() - last_active_at > checkin_interval_days`; for each overdue owner with `release_state.state = 'armed'`: call `stateMachine.transition` to PENDING; on per-owner error: exponential backoff base 5 s, max 3 retries, then log + continue to next owner; write audit entry per transition
    - _Requirements: 4.3, 4.4, 4.6, 4.7_
  - [~] 16.3 Write property test for heartbeat overdue detection (Property 9)
    - **Property 9: Heartbeat overdue detection — any owner where (now - last_active_at) > checkin_interval_days and state = ARMED must produce a PENDING transition**
    - Generate `fc.record({lastActiveAt: fc.date(), intervalDays: fc.integer(1,365)})` filtered to overdue
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 9`
    - **Validates: Requirements 4.3**
  - [~] 16.4 Write property test for heartbeat recovery PENDING→ARMED (Property 10)
    - **Property 10: Heartbeat recovery — for any reversible trigger in PENDING, submitting a heartbeat must transition to ARMED; estate triggers in PENDING must be rejected**
    - Use `fc.constantFrom('emergency','travel','caregiver','business','estate')` for trigger type
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 10`
    - **Validates: Requirements 4.5**

- [ ] 17. Implement N-of-M verifier confirmation
  - [~] 17.1 Implement `app/api/triggers/[id]/confirm/route.ts` (POST): accepts scoped verifier JWT; validates `verifier_id` belongs to this trigger; OCC intent-read pattern: SELECT existing confirmation for `(release_state_id, verifier_id)`; if exists, return 200 silently; otherwise INSERT + CAS increment `received_confirmations`; on 40001 treat as duplicate (silently ignore); after increment: if `received_confirmations >= required_confirmations` AND `grace_ends_at <= now()`: invoke `stateMachine.transition` to RELEASED; if confirmations met but grace not elapsed: notify Owner
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.9_
  - [~] 17.2 Implement `app/api/triggers/[type]/initiate/route.ts` (POST): Owner auth; validate trigger type; assert `release_state.state = 'armed'`; transition to PENDING via CAS; send Resend emails to all Verifiers for this trigger type; write audit entry `action:"trigger_initiated"`
    - _Requirements: 4.3, 6.2_
  - [~] 17.3 Implement `app/api/triggers/[id]/cancel/route.ts` (POST): Owner auth; assert state is `GRACE` and trigger is reversible; transition to CANCELLED via CAS; write audit entry `action:"trigger_cancelled"`
    - _Requirements: 5.3_
  - [~] 17.4 Write property test for verifier confirmation idempotency (Property 14)
    - **Property 14: Verifier confirmation idempotency — N ≥ 2 submissions from the same verifier increment received_confirmations by exactly 1**
    - Use `fc.integer({min:2, max:20})` for submission count
    - Run 100 iterations; tag `// Feature: relay-h0-mvp, Property 14`
    - **Validates: Requirements 6.4**

- [ ] 18. Implement simulate trigger endpoint (demo spine)
  - [~] 18.1 Implement `app/api/demo/simulate/route.ts` (POST): check Owner auth FIRST; check `users.is_demo_account = true` FIRST — return 403 if not demo before reading any state; validate current state is `ARMED` — return 409 if not; advance ARMED→PENDING (sleep 3 s)→GRACE (auto-satisfy `received_confirmations = required_confirmations`, sleep 3 s)→RELEASED (sleep 4 s) — total ≤ 10 s; each transition uses `ReleaseStateMachine.transition` with real CAS; write audit entries for each transition with `detail.simulated = true` and notification events with `detail.suppressed = true`
    - _Requirements: 9.1–9.7_

- [ ] 19. Build triggers & simulate screen
  - [~] 19.1 Implement `app/(owner)/triggers/page.tsx`: shows current release state per trigger type (ARMED/PENDING/GRACE/RELEASED badge); cadence configuration form (check-in interval days); "Initiate Emergency" button; Simulate button (visible only for demo accounts, renders countdown progress bar during 10-second run); Cancel button (visible only in GRACE state for reversible triggers)
    - _Requirements: 9.1, 4.1_

- [~] 20. Checkpoint — full demo spine runs end-to-end
  - Manually run: (1) Simulate trigger → watch ARMED→PENDING→GRACE→RELEASED in ≤ 10 s; (2) Owner checks in from GRACE → returns to ARMED; (3) Confirm OCC: two concurrent simulate calls → only one advances. All property tests (Properties 9–14) green. Ask the user if questions arise.

---

### Milestone 6 — Day 9: Recipient Access Dashboard + Multi-Region Failover

- [ ] 21. Implement recipient access dashboard API and session version check
  - [~] 21.1 Implement `app/api/access/route.ts` (GET): verify recipient JWT; re-read `release_state` with strongly-consistent DSQL read; assert `state = 'released'`; verify JWT `version` matches `release_state.version` — if mismatch return 403; return scoped vault items metadata (title, service_name, url, category, scope) sorted: `is_root_credential = true` first, then `importance_score DESC`, ties broken alphabetically by `title`; write audit entry `action:"recipient_dashboard_viewed", entity:"release_state"`
    - _Requirements: 7.1, 7.2, 7.4, 7.6, 7.7, 15.1–15.3_
  - [~] 21.2 Implement `app/api/access/[itemId]/decrypt/route.ts` (POST): verify recipient JWT + version check; assert `release_state = 'released'`; assert `access_rules` row for `(recipient_id, vault_item_id)`; call `KMS.Decrypt`; return `{plaintext_data_key, ciphertext, kms_key_id}`; write audit entry `action:"vault_item_decrypted"` with `detail.outcome` set to `"authorized"` or `"denied"` (write even on auth failure before decryption); on any failure: 403, no partial plaintext
    - _Requirements: 7.5, 7.8, 2.5_
  - [~] 21.3 Write property test for access dashboard ranking invariant (Property 15)
    - **Property 15: Access dashboard ranking invariant — is_root_credential=true items appear before all others; within each group descending importance_score; ties broken alphabetically by title**
    - Generate `fc.array(fc.record({isRoot: fc.boolean(), score: fc.float(0,1), title: fc.string({minLength:1})}), {minLength:2})`
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 15`
    - **Validates: Requirements 7.4**

- [ ] 22. Build recipient access dashboard screen (Access mode)
  - [~] 22.1 Implement `app/(access)/layout.tsx` as `AccessLayout`: warm amber accent, white background, bold 18–20 px body type, generous leading, minimal chrome, full-width step layout; uses `verifyRecipientToken()` — redirects to error page if invalid or expired; if state is not RELEASED renders pending-status page showing only `title, service_name, url, category, type` with "Access not yet active" message
    - _Requirements: 7.3_
  - [~] 22.2 Implement `app/(access)/access/page.tsx`: renders triage plan grouped by time-horizon buckets (Do Today / This Week / Within 30 Days) with step numbers; each item shows `title`, `service_name`, `scope` badge; clicking an item POSTs to `/api/access/[id]/decrypt` then decrypts in browser using `CryptoService.decryptItem`; shows decrypted value in-DOM (cleared on navigate)
    - _Requirements: 7.1, 7.6, 13.3_

- [ ] 23. Implement multi-region failover demo wiring
  - [~] 23.1 Wire `DSQL_USE_SECONDARY` toggle into `lib/db/connection.ts`: when the env var is `'true'`, `getPool()` returns `secondaryPool` immediately without checking primary; add `/api/admin/failover` POST route (Vercel env var update trigger via Vercel API) for demo use; write unit test confirming `getPool()` returns secondary pool when env var is set and primary pool `totalCount === 0`
    - _Requirements: 14.2, 14.3, 14.5_
  - [~] 23.2 Write integration test for multi-region failover
    - Disable primary pool mock (simulate connection error); assert `getPool()` returns secondary; run a CAS UPDATE through the OCC pattern on secondary; assert result is identical to primary behavior
    - Tag `// Feature: relay-h0-mvp, failover integration test`
    - **Validates: Requirements 14.2, 14.3**

- [~] 24. Checkpoint — failover demo works live
  - Deploy to Vercel. Set `DSQL_USE_SECONDARY=true` via Vercel env var. Navigate the recipient access dashboard. Confirm data is served from `us-west-2` endpoint. Reset to primary. Ask the user if questions arise.

---

### Milestone 7 — Day 9 (continued): AI Agents — Intake and Prioritization

- [ ] 25. Implement ZK metadata query layer and Intake Agent
  - [~] 25.1 Create `lib/ai/metadata-query.ts`: export `getVaultMetadata(ownerId)` — SELECT `id, title, service_name, url, category, type, criticality, is_root_credential, recurring_billing, irreplaceable, importance_score, depends_on_item_id, backup_note` WHERE `owner_id = ownerId`; explicitly excludes `ciphertext`, `wrapped_data_key`, `kms_key_id`; this function is the only data accessor permitted in AI route handlers
    - _Requirements: 11.5, 12.5, 13.5_
  - [~] 25.2 Implement `app/api/ai/intake/route.ts`: accepts `{items: VaultMetadata[]}` (batch ≤ 300); calls `getVaultMetadata` (never raw vault_items with secrets); constructs OpenAI prompt to classify `is_root_credential`, `recurring_billing`, `irreplaceable`, `depends_on_item_id`, and `importance_score` per item; UPDATE each item's flags and score via `withOccRetry`; on LLM timeout or error: set `importance_score = 0.5`, `is_root_credential = false`, surface warning list; complete ≤ 30 s
    - _Requirements: 11.1–11.10_
  - [~] 25.3 Write property test for importance score range invariant (Property 18)
    - **Property 18: Importance score range invariant — for any vault item metadata input, Intake Agent must return importance_score in [0.0, 1.0]**
    - Generate random metadata combinations; mock OpenAI to return arbitrary floats (including out-of-range); assert returned score is clamped to [0.0, 1.0]
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 18`
    - **Validates: Requirements 11.7**

- [ ] 26. Implement Prioritization Agent
  - [~] 26.1 Implement `app/api/ai/prioritize/route.ts`: reads vault metadata via `getVaultMetadata`; detects gaps (missing recovery email annotation, 2FA notes, beneficiary designation, backup_note); ranks gaps: `is_root_credential = true` items first, then by `importance_score DESC`; flags `irreplaceable = true` items with no recipient or empty `backup_note` as `CUSTODY_RISK`; returns ordered gap list with plain-language consequence explanations; writes CUSTODY_RISK flags back to vault item `backup_note` metadata; debounce trigger on item update (500 ms)
    - _Requirements: 12.1–12.7_

---

### Milestone 8 — Day 10: Triage Agent, Audit Log, Hash Chain

- [ ] 27. Implement Triage Agent
  - [~] 27.1 Implement `app/api/ai/triage/route.ts`: reads vault metadata for recipient's scoped items via `getVaultMetadata`; constructs dependency-ordered handoff plan: Root_Credentials first, then items with no unresolved `depends_on_item_id`, then dependents; groups into time-horizon buckets (`do_today` ≥ 0.7 OR `is_root_credential`; `this_week` 0.4–0.699; `within_30_days` < 0.4); for `estate` trigger: append provider-specific guidance (Apple Legacy Contact, Google IAM, Meta memorialization) per relevant item; 15 s timeout — on timeout fallback to flat `importance_score DESC` sort with warning; returns `{steps: [{step, vault_item_id, bucket, provider_guidance?, owner_annotation?}]}`
    - _Requirements: 13.1–13.8_
  - [~] 27.2 Write property test for triage plan dependency ordering (Property 19)
    - **Property 19: Triage plan dependency order — every item must appear after all its transitive dependencies in the plan, for all valid DAGs**
    - Generate `fc.array` of items with random `depends_on_item_id` edges forming valid DAGs (no cycles); run triage; assert topological sort invariant
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 19`
    - **Validates: Requirements 13.2**
  - [~] 27.3 Write property test for triage time-horizon bucket assignment (Property 20)
    - **Property 20: Triage time-horizon bucket assignment — any item with importance_score ≥ 0.7 or is_root_credential=true → do_today; 0.4–0.699 → this_week; < 0.4 → within_30_days**
    - Use `fc.record({score: fc.float(0,1), isRoot: fc.boolean()})`; test all three bucket boundaries plus root credential override
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 20`
    - **Validates: Requirements 13.3**

- [ ] 28. Implement append-only hash-chained audit log
  - [~] 28.1 Create `lib/audit/audit-service.ts` with `writeAuditEntry(ownerId, entry)`: SELECT `MAX(seq)` and `entry_hash` of most recent row for `owner_id` within same OCC transaction; compute `seq = max + 1` (or 0 for first); set `prev_hash` to last `entry_hash` or `'0'.repeat(64)` for first entry; compute `entry_hash = SHA-256(prev_hash || canonicalJson(entry))` using `crypto.createHash('sha256')`; INSERT-only — never UPDATE or DELETE; on INSERT failure retry up to 3 times (base 500 ms); after 3 failures emit operator alert (stderr) and return HTTP 503; export `getAuditLog(ownerId)` returning entries ordered by `seq ASC`
    - _Requirements: 8.1–8.7_
  - [~] 28.2 Implement `app/api/audit/route.ts` (GET): Owner auth; return `getAuditLog(ownerId)` — owner-scoped only, ascending `seq`; no cross-owner data
    - _Requirements: 8.6_
  - [~] 28.3 Write property test for audit log hash chain integrity (Property 16)
    - **Property 16: Audit log hash chain integrity — for N entries: entry[0].prev_hash = '0'.repeat(64); entries[i].prev_hash = entries[i-1].entry_hash; entry_hash = SHA-256(prev_hash + canonical_json)**
    - Use `fc.array(fc.record({actor:fc.string(), action:fc.string(), entity:fc.string()}), {minLength:1, maxLength:50})`
    - Run 100 iterations; tag `// Feature: relay-h0-mvp, Property 16`
    - **Validates: Requirements 8.3, 8.4**

- [ ] 29. Build audit log viewer screen
  - [~] 29.1 Implement `app/(owner)/audit/page.tsx`: paginated table of audit entries in ascending `seq` order; columns: `seq`, `ts`, `actor`, `action`, `entity`, `entity_id`, `detail` (collapsed JSON); renders `entry_hash` truncated with copy button; "Verify chain" button — re-computes all hashes client-side and highlights any broken link
    - _Requirements: 8.6_

- [~] 30. Checkpoint — audit chain verified and AI agents return valid output
  - Run simulate trigger; open audit log; click "Verify chain" — assert all hashes match. Run intake agent on 10 test items; assert all scores in [0, 1]. Run triage agent; assert dependency order. `vitest --run` all 20 properties green. Ask the user if questions arise.

---

### Milestone 9 — Day 11: Design Polish, Seed Data, Demo Assets

- [ ] 31. Implement vault uniqueness property test and vault-creation guard
  - [~] 31.1 Enforce single-vault-per-owner in `app/api/vault/items/route.ts` POST handler: SELECT COUNT(*) WHERE `owner_id = :ownerId` on `users` table vault flag; if vault already initialized return 409 conflict; add `vault_initialized` boolean column to `users` table via migration `002_vault_flag.sql`
    - _Requirements: 1.1_
  - [~] 31.2 Write property test for vault uniqueness per owner (Property 1)
    - **Property 1: Vault uniqueness per owner — calling vault creation twice for the same owner ID must result in exactly one vault row; second call returns conflict error**
    - Use `fc.uuid()` for owner ID; run create twice; assert second returns 409; assert DB row count = 1
    - Run 200 iterations; tag `// Feature: relay-h0-mvp, Property 1`
    - **Validates: Requirements 1.1**

- [ ] 32. Build design polish — two-mode layout and completeness nudges
  - [~] 32.1 Finalize `OwnerLayout` (Owner mode): verify blue/neutral palette, sidebar nav, information-dense 14–16 px body, low saturation across all owner screens; add Completeness nudge banner to vault dashboard when `importance_score` average < 0.5 or any `is_root_credential` item has no Access_Rule
    - _Requirements: 11.8, 12.3_
  - [~] 32.2 Finalize `AccessLayout` (Access mode): verify warm amber accent, white background, bold 18–20 px body, minimal chrome; confirm full Next.js layout swap at `/access/*` routes; add risk-graph tooltip on vault dashboard items where `depends_on_item_id` is non-null showing "gates N items"
    - _Requirements: 7.4 (importance moment / risk-graph reveal)_

- [ ] 33. Create demo seed data and end-to-end demo run script
  - [~] 33.1 Create `db/seeds/demo-seed.ts`: insert one demo `users` row with `is_demo_account=true`; insert 25 vault items across categories (finance, communication, government, health) with realistic `service_name` and `url` values; set `is_root_credential=true` on Gmail and 1Password items; set `depends_on_item_id` edges from bank accounts → Gmail (for risk-graph reveal); insert 2 recipients, 2 verifiers, and emergency trigger access rules; set `release_state` to ARMED; run `IntakeAgent` against all seed items to populate `importance_score` flags
    - _Requirements: 11.1, 7.4 (demo moment 4)_
  - [~] 33.2 Write `scripts/demo-run.ts` that documents the four demo moments as executable steps: (1) call `/api/demo/simulate` and poll state every 1 s until RELEASED; (2) flip `DSQL_USE_SECONDARY=true` mid-simulate and confirm query succeeds; (3) attempt concurrent simulate — assert second call returns 409; (4) open recipient dashboard and verify Gmail appears first with risk-graph tooltip
    - _Requirements: demo spine validation_

- [ ] 34. Generate architecture diagram SVG
  - [~] 34.1 Convert the design Mermaid diagram to `relay_architecture.svg` using the existing `specs/relay_architecture.svg` as reference; update any component names or connections that changed during implementation; ensure SVG is self-contained (no external font or image URLs) for Devpost embedding
    - _Requirements: submission asset_

---

### Milestone 10 — Day 12: Submission Assets

- [ ] 35. Produce submission assets
  - [~] 35.1 Write demo video script (`specs/demo-script.md`): five-minute walkthrough covering the four demo moments in order — (1) owner onboards, adds Gmail + bank items, sets emergency trigger; (2) simulate trigger runs — ARMED→PENDING→GRACE→RELEASED countdown visible; (3) recipient logs in, sees amber Access mode, Gmail at top with risk graph; (4) `DSQL_USE_SECONDARY=true` set live — recipient refreshes, data still loads; (5) owner checks in → state returns to ARMED (reversible emergency story complete)
    - _Requirements: demo spine_
  - [~] 35.2 Produce `specs/aws-screenshot-guide.md`: instructions for capturing the Aurora DSQL console showing two active regional endpoints, the KMS key with Relay's key policy, and the IAM role permissions; these screenshots are taken manually during demo recording
    - _Requirements: submission asset_
  - [~] 35.3 Write Devpost submission text in `specs/Relay_Devpost_Submission.md` (updating the existing file): finalize "What it does", "How we built it", "Challenges", "Accomplishments", "What we learned", and "What's next" sections; reference Aurora DSQL active-active two-region architecture, OCC correctness, client-side envelope encryption; include link to GitHub repo, live Vercel URL, and demo video URL placeholders
    - _Requirements: submission asset_

- [~] 36. Final checkpoint — submission-ready
  - `vitest --run` all 20 property tests pass. All 4 demo moments reproducible from `scripts/demo-run.ts`. Vercel deployment green. AWS screenshots captured. Devpost draft complete. Ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Property tests validate universal correctness invariants; unit tests cover concrete edge cases. Both are strongly recommended for the OCC and state-machine subsystems given the demo's correctness story.
- **Cuttable scope** (in priority order if time slips): threshold/multi-sig crypto → Plaid-based financial account discovery → document OCR ingestion → hash-chained audit log (task 28) → third AI agent (Triage Agent, task 27).
- Each task references specific requirements for traceability. The design document is assumed available to the implementing agent throughout.
- All property tests use `fast-check` with a minimum of 100 runs (500 runs for state-machine properties).
- The `DSQL_USE_SECONDARY=true` env var is the primary failover demo mechanism — no AWS infrastructure needs to be disabled live.
- **ARMED is the safe default**: every OCC exhaustion, ambiguous transition, or system error must leave `release_state.state = 'armed'`. This invariant is enforced by `safeResetToArmed` in `lib/release/state-machine.ts`.
- Audit log writes block the triggering operation if they fail — intentional design choice for the release subsystem's integrity story.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "1.2"],
      "note": "Day 1–2: Project scaffold and dependency installation — fully independent"
    },
    {
      "id": 1,
      "tasks": ["2.1", "2.2"],
      "note": "Day 1–2: DSQL provisioning and DDL migration — require scaffold (wave 0)"
    },
    {
      "id": 2,
      "tasks": ["3.1", "3.2"],
      "note": "Day 1–2: Connection manager and OCC retry lib — require DSQL endpoints (wave 1)"
    },
    {
      "id": 3,
      "tasks": ["3.3"],
      "note": "Day 1–2: OCC property test — requires occ.ts (wave 2)"
    },
    {
      "id": 4,
      "tasks": ["5.1", "5.2", "6.1"],
      "note": "Day 3: Auth, recipient JWT, integrity layer — require connection manager (wave 2)"
    },
    {
      "id": 5,
      "tasks": ["6.2"],
      "note": "Day 3: Cross-owner property test — requires integrity layer (wave 4)"
    },
    {
      "id": 6,
      "tasks": ["7.1", "7.2", "8.1", "8.2"],
      "note": "Day 4: Vault CRUD API and KMS proxy routes — require auth + integrity (wave 4)"
    },
    {
      "id": 7,
      "tasks": ["9.1"],
      "note": "Day 4: CryptoService — requires KMS wrap route (wave 6)"
    },
    {
      "id": 8,
      "tasks": ["7.3", "7.4", "8.3", "9.2"],
      "note": "Day 4: Vault item property tests — require vault CRUD and crypto (waves 6–7)"
    },
    {
      "id": 9,
      "tasks": ["11.1", "11.2", "11.3"],
      "note": "Day 5: Recipients, verifiers, rules API — require auth + integrity (wave 4); can run parallel to vault CRUD"
    },
    {
      "id": 10,
      "tasks": ["11.4", "11.5"],
      "note": "Day 5: Estate + N-of-M property tests — require rules API (wave 9)"
    },
    {
      "id": 11,
      "tasks": ["12.1", "12.2", "12.3"],
      "note": "Day 5–6: Owner UI layout and screens — require vault + recipients APIs (waves 6, 9)"
    },
    {
      "id": 12,
      "tasks": ["13.1", "13.2", "13.3"],
      "note": "Day 5–6: CSV import screen and batch upload API — require vault CRUD + crypto (waves 6–7)"
    },
    {
      "id": 13,
      "tasks": ["15.1"],
      "note": "Day 7: Release state machine — requires OCC retry lib (wave 2) and audit service (built in wave later; wired after)"
    },
    {
      "id": 14,
      "tasks": ["15.2", "15.3"],
      "note": "Day 7: State machine property tests — require state machine (wave 13)"
    },
    {
      "id": 15,
      "tasks": ["16.1", "16.2"],
      "note": "Day 7: Heartbeat check-in + cron handler — require state machine (wave 13)"
    },
    {
      "id": 16,
      "tasks": ["16.3", "16.4"],
      "note": "Day 7: Heartbeat property tests — require heartbeat handlers (wave 15)"
    },
    {
      "id": 17,
      "tasks": ["17.1", "17.2", "17.3"],
      "note": "Day 8: N-of-M confirmation + initiate + cancel routes — require state machine (wave 13)"
    },
    {
      "id": 18,
      "tasks": ["17.4"],
      "note": "Day 8: Idempotency property test — requires confirmation route (wave 17)"
    },
    {
      "id": 19,
      "tasks": ["18.1", "19.1"],
      "note": "Day 8: Simulate trigger endpoint + triggers screen — require state machine + auth (waves 4, 13)"
    },
    {
      "id": 20,
      "tasks": ["21.1", "21.2"],
      "note": "Day 9: Access dashboard API — require state machine + rules + vault CRUD (waves 6, 9, 13)"
    },
    {
      "id": 21,
      "tasks": ["21.3", "22.1", "22.2"],
      "note": "Day 9: Access dashboard property test + UI screens — require access API (wave 20)"
    },
    {
      "id": 22,
      "tasks": ["23.1"],
      "note": "Day 9: Failover wiring — requires connection manager (wave 2)"
    },
    {
      "id": 23,
      "tasks": ["23.2"],
      "note": "Day 9: Failover integration test — requires failover wiring (wave 22)"
    },
    {
      "id": 24,
      "tasks": ["25.1"],
      "note": "Day 9: ZK metadata query layer — requires vault items table (wave 1)"
    },
    {
      "id": 25,
      "tasks": ["25.2", "26.1"],
      "note": "Day 9: Intake Agent + Prioritization Agent — require metadata query (wave 24)"
    },
    {
      "id": 26,
      "tasks": ["25.3"],
      "note": "Day 9: Importance score property test — requires Intake Agent (wave 25)"
    },
    {
      "id": 27,
      "tasks": ["27.1"],
      "note": "Day 10: Triage Agent — requires metadata query + state machine (waves 13, 24)"
    },
    {
      "id": 28,
      "tasks": ["27.2", "27.3"],
      "note": "Day 10: Triage property tests — require Triage Agent (wave 27)"
    },
    {
      "id": 29,
      "tasks": ["28.1", "28.2"],
      "note": "Day 10: Audit service + audit API route — require OCC retry + DSQL (waves 2–3)"
    },
    {
      "id": 30,
      "tasks": ["28.3", "29.1"],
      "note": "Day 10: Audit hash chain property test + viewer screen — require audit service (wave 29)"
    },
    {
      "id": 31,
      "tasks": ["31.1"],
      "note": "Day 11: Vault uniqueness guard + migration — requires vault CRUD (wave 6)"
    },
    {
      "id": 32,
      "tasks": ["31.2"],
      "note": "Day 11: Vault uniqueness property test — requires vault uniqueness guard (wave 31)"
    },
    {
      "id": 33,
      "tasks": ["32.1", "32.2"],
      "note": "Day 11: Design polish — require all UI screens complete (waves 11, 21)"
    },
    {
      "id": 34,
      "tasks": ["33.1"],
      "note": "Day 11: Demo seed data — requires vault CRUD + Intake Agent + rules (waves 6, 9, 25)"
    },
    {
      "id": 35,
      "tasks": ["33.2", "34.1"],
      "note": "Day 11: Demo run script + architecture SVG — require seed data + all systems wired (wave 34)"
    },
    {
      "id": 36,
      "tasks": ["35.1", "35.2", "35.3"],
      "note": "Day 12: Submission assets — require demo run validated (wave 35)"
    }
  ]
}
```
