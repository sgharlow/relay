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

## Build state — code-complete, deployed, dogfooded live (2026-06-27)

`npm run build`, `npx tsc --noEmit`, and `npx vitest --run` (**403 tests, 58 files**) are all green. The entire backend (28 API routes) and all UI screens are complete, and the full app was **dogfooded end-to-end on live Aurora DSQL + AWS KMS on 2026-06-27**: owner TOTP sign-in, vault + importance engine, the release state machine (ARMED→PENDING→GRACE→RELEASED), active-active multi-region (a release written in us-east-1 read strongly-consistent from us-west-2), the full crypto round-trip (create item → in-browser AES-GCM + KMS wrap → DSQL → recipient token → KMS unwrap → plaintext), and the hash-chained audit log (server + client verification both intact). Deployed live at https://relay-three-henna.vercel.app.

Per-task implementation detail lives in the specs (`.kiro/specs/relay-h0-mvp/`, `specs/Relay_H0_Build_Spec_v2.md`); the live-dogfood checklist is `docs/e2e-verification.md`. Remaining work is submission packaging only (demo video, Devpost form) — see `docs/SUBMISSION-RUNBOOK.md`.

Conventions to preserve: `tsconfig.json` targets `ES2020` (required for the `bigint` OCC version type — if `tsc` reports stale errors after a config change, delete `tsconfig.tsbuildinfo`); `.eslintrc.json` ignores `^_`-prefixed unused vars. Reset the demo to a clean 25-item/ARMED state with `npx tsx --env-file=.env.local scripts/reset-demo.ts`. To visually verify UI, `npm run dev` then drive with Playwright.

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

- Git is initialized with remote `origin` → github.com/sgharlow/relay (branch `master`).
- `README.md` is a real project README (rewritten 2026-06-19) — safe to read for project info.
