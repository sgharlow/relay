# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Relay is a "living-continuity" platform (H0 hackathon MVP). Owners build an encrypted vault of
accounts/credentials/documents/instructions, assign scoped access to recipients, and configure
verified trigger conditions. When a trigger fires, the system advances a release state machine
(`ARMED → PENDING → GRACE → RELEASED`) guarded by optimistic concurrency control. Emergencies are
reversible; estate handoffs are permanent. The default-safe state is always `ARMED`.

**Stack (locked):** Next.js 16 App Router (TypeScript) on Vercel · Aurora DSQL across two regions
(us-east-1 / us-west-2) · AWS KMS client-side envelope encryption · Vercel Cron · OpenAI · Resend.

The full source-of-truth specs live in `.kiro/specs/relay-h0-mvp/` (`requirements.md`, `design.md`,
`tasks.md`) and `specs/Relay_H0_Build_Spec_v2.md`. Read `design.md` before changing any
release/crypto/OCC logic — it defines the schema, state-transition table, and the demo spine.

## Build state — commercialising, live at relaystandby.com

H0 is over: relay **won "Most Impactful"** (2026-08-05) and the product is now on the G1→G5
commercial track. `npm run build`, `npx tsc --noEmit` and `npm test` are green — **derive the test
count with the command in `PROJECT.yaml` (`derived.test_count`) rather than trusting a number
quoted in prose.** A hardcoded count sat here drifting for weeks; that is why it is gone.

Live on **https://relaystandby.com** (the custom domain — the old `relay-three-henna.vercel.app`
is a stale surface, not the product). Six sprints past the H0 MVP have shipped: self-serve signup
with per-user TOTP, access policies, delegation with consent, verifier deny/abstain, access
requests, recovery codes, the wired heartbeat scheduler with an off-Vercel dead-man's switch, and
live-mode Stripe billing.

**All ten user journeys were re-walked against production on 2026-08-13** — see the re-sweep
table at the top of `docs/user-journeys.md`, which supersedes both the 2026-08-08 sweep below it
and the `[BUILT]`/`[GAP]` tags further down that file. The 2026-08-08 walk is kept as the
historical record; where the two differ, the newer wins. The 2026-06-27 dogfood described below is still
true and is now the *older* of two live proofs.

Authority for build state: `PROJECT.yaml` (gates, volatile facts) and the sweep table in
`docs/user-journeys.md`. Per-task detail lives in the specs (`.kiro/specs/relay-h0-mvp/`,
`specs/Relay_H0_Build_Spec_v2.md`); `docs/e2e-verification.md` is the HISTORICAL H0 dogfood record (its sign-in procedure died with TOTP_SECRET on 2026-08-13 — the banner at its top says what replaced it).

The 2026-06-27 dogfood on live Aurora DSQL + AWS KMS proved: owner TOTP sign-in, vault + importance
engine, the release state machine (ARMED→PENDING→GRACE→RELEASED), active-active multi-region (a
release written in us-east-1 read strongly-consistent from us-west-2), the full crypto round-trip
(create item → in-browser AES-GCM + KMS wrap → DSQL → recipient token → KMS unwrap → plaintext),
and the hash-chained audit log (server + client verification both intact).

Conventions to preserve: `tsconfig.json` targets `ES2020` (required for the `bigint` OCC version type — if `tsc` reports stale errors after a config change, delete `tsconfig.tsbuildinfo`); `eslint.config.mjs` (flat config — `.eslintrc.json` is gone) ignores `^_`-prefixed unused vars. Reset the demo to a clean 25-item/ARMED state with `npx tsx --env-file=.env.local scripts/reset-demo.ts`. To visually verify UI, `npm run dev` then drive with Playwright.

## Commands

```bash
npm run dev            # next dev (http://localhost:3000)
npm run build          # next build — production build
npm run lint           # eslint . --max-warnings=0 (flat config: eslint.config.mjs)
npm test               # vitest --run (one-shot, the default)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest --coverage (v8; thresholds 80/80/70/80 lines/fn/branches/stmts)

npm run gate           # types + lint + test + build. No database, no server. CI runs this.
npm run verify:live    # the three E2E walks. NEEDS .env.local AND `npm run dev` running.
npm run verify:schema  # do both DSQL regions have the tables the migrations declare?
                       # Read-only (SELECT on pg_tables). NEEDS .env.local, no server.
                       # Run it FIRST after applying a migration, and before a release.
npm run verify:funnel  # is the G1 ad instrument alive? Drives a real browser against
                       # production under src=qa (gate-excluded), writes nothing.
                       # Run it daily during an ad flight — see docs/g1-ad-creatives.md.
npm run flight:snapshot # the G1 flight's daily read AND the sitting sheet's pre-flight
                       # line 3. Prints the snapshot row + the lead notes (verdict line
                       # 4), and EXITS 1 if caregiver_leads is not empty before the
                       # window opens. Read-only; runs as relay_dev, which cannot write
                       # that table. NEEDS .env.local, no server.

npx vitest --run lib/db/occ.test.ts          # run a single test file
npx vitest --run -t "OCC retry"              # run tests matching a name
npx tsx --env-file=.env.admin db/migrations/migrate.ts 0NN_x.sql   # migrations = a SYSADMIN act
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

**Two env files, and the split is the security model** (2026-08-15). There is one cluster and there
will be one until G1 is decided, so least privilege is built from identity, not environments.

| File | Identity | Can |
|---|---|---|
| `.env.local` | IAM `relay-dev` → DB role `relay_dev` | read/write product tables. **No DDL.** **Cannot write `caregiver_leads`.** |
| `.env.admin` | IAM `autospecai` → DB role `admin` | everything: migrations, roles, grants |

`.env.admin` holds **no secrets** — just `AWS_PROFILE`, so the key stays in `~/.aws/credentials`
alone. Being a sysadmin is something you *choose* by naming that file, not a power you carry by
default. Until this existed the app minted an **admin** token, so production ran with full DDL
rights and the same IAM user's key sat on a laptop; nothing anywhere could tell them apart.

⚠️ **Production is still on the admin path.** `DSQL_ROLE` unset means `admin`, deliberately —
Vercel moves to `relay_app` as a separate, explicit step. A denied write surfaces as
`500 CaptureRefused`; if you ever see that on the lead form, it is a grant, not a bug.

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

  ⚠️ **The token model is being demoted to a fallback — see `docs/standby-architecture.md`
  (hybrid+6, the ratified direction as of 2026-08-11).** Under that plan a recipient or verifier who
  has claimed a **standby account** signs in as themselves and the dashboard resolves an open
  release server-side; no code is minted, nothing secret is emailed, and `?token=` leaves the URL.
  The version check survives — it moves from a JWT claim to a server-side comparison per request,
  so a re-arm still closes every open dashboard on its next call. `recipient-token.ts` is retained
  for **unclaimed** contacts only. Do not build new work against the token path assuming it is the
  primary one.

- **Authentication nonces are single-use, and elevation is a row.** `auth_challenges`
  (migration 029) backs both: `openChallenge()` BURNS a WebAuthn challenge, so a captured
  assertion cannot be replayed inside its five-minute window; and step-up elevation
  (`lib/auth/step-up.ts`) is a five-minute sudo window recorded as a row so it can be
  *withdrawn*, not just expire. A signed token proves we minted it and never that it is
  unspent — that distinction is the whole point of the table. Sensitive routes call
  `requireStepUp` (window) or `requireStepUpOnce` (spends it; account closure only);
  `lib/ops/step-up-guard.ts` fails the build if a declared route drops the call or a new
  handler appears under `/api/account` unclassified. The guard deliberately **stands down**
  for an account with neither TOTP nor a passkey — a freshly-claimed contact — because a
  guard nobody can satisfy is a lockout. The sweep in the heartbeat cron is housekeeping,
  **not** a dead-man's-switch candidate: expiry is enforced by a predicate on the read path.

- **Audit log is append-only and hash-chained per owner.** Each entry:
  `entry_hash = SHA-256(prev_hash || canonicalJson(entry))`, first entry `prev_hash = '0'*64`.
  INSERT-only, never UPDATE/DELETE. Audit writes **block** the triggering operation if they fail —
  by design, do not make them best-effort.

## Two gates, and why only one of them is in CI

`npm run gate` is types + lint + test + build. It needs no credentials and no server, so CI runs it
on every push. **`npm run verify:live` is the other half**: three walks that drive the running app —
`e2e-stepup` (17 assertions over HTTP), `e2e-multiowner` (14), `e2e-ui` (19, in a real browser).
Start `npm run dev` first.

**It is deliberately NOT in CI.** These walks create and delete real accounts, and `.env.local`
points at the **production** cluster because Relay has no dev database. A job doing that on every
pull request would be writing to customers' data to check a diff — and the rows it forgot would be
the ones nobody was watching (an early run of the multi-owner walk left four behind; that is the
argument, not a hypothetical). Closing this properly needs a separate test cluster: an
infrastructure change with a cost, and Steve's call.

So it is one command a person runs before a release. Each walk asserts the layer the others cannot:
the server refusing correctly, and the screen a person actually meets. The UI walk exists because
the HTTP ones passed while the picker was laying itself out sideways on a phone.

**`npm run verify:schema` is a third, and the cheapest.** `migrate.ts` applies one named file and
tracks nothing, so which migrations have reached which cluster was never recorded anywhere. On
2026-08-15 that produced its first alert: `auth_challenges` was absent for four minutes while
migration 029 was being applied, every passkey sign-in threw, and the thing that noticed reported it
as a production failure from a laptop. This compares what the migrations declare against what each
cluster has — **both regions**, because failover here is an env switch (`DSQL_USE_SECONDARY`) and a
migration applied to only one region stays invisible until the day somebody flips it. Read-only, so
it is safe against production, which is the only place worth running it.

It also asks whether each declared table is **readable by the identity you are connecting as**,
because presence is not usability. Migration 030 granted the least-privilege role
`SELECT … ON ALL TABLES`, which resolves once against the tables existing at that moment; 031
created one the next day and the first read failed with `permission denied`. `pg_tables` is
readable by any role, so the presence check passed cleanly on a table the application could not
touch. Migration 032 fixes the cause (`ALTER DEFAULT PRIVILEGES`, verified supported on DSQL), and
the probe is here because that rule binds to the creating role — a table made by any other identity
would drop straight back into the hole, silently, at runtime. Both halves were proven by planting a
`REVOKE` and watching the check fail in both regions.

**`npm run verify:roles` is a fourth**, and it guards a wall that leaves no trace in this repo. The
least-privilege split is enforced by GRANTs on a live cluster: `db/migrations/*.sql` records what was
*intended* when each file ran, and anyone with admin can widen a role in one statement that appears
in no diff, test run or build. It re-measures the thing itself — both regions, read-only — asserting
that `relay_app` (the live site, IAM `relay-runtime`) has full DML including `caregiver_leads`, that
`relay_dev` (a laptop) can read that table and not write it, that neither holds DDL, and that each is
bound to exactly one IAM principal. Proven to fail in both directions by planting a widened
`relay_dev` and a starved `relay_app`. ✅ **Cutover DONE 2026-08-16**: production connects as `relay_app`, and `dsql:DbConnectAdmin` has been
stripped from `relay-runtime-policy` (v2; v1 retained as rollback), so the live site can no longer
obtain database admin by permission rather than by configuration. `docs/least-privilege-cutover.md`.

Accessibility is a fifth: `node scripts/a11y-audit.mjs` with `A11Y_OWNER_EMAIL` set to an account
that exists (`scripts/disposable-owner.ts create` makes one). CI covers the signed-out half only —
it has no database credentials to mint an owner session, and the script says so on every run.

## The structural checks in `lib/ops/` — read these before adding a route or a screen

They all exist for one reason: **a guard that lives in a helper is a guard on the helper.**
A request-body cap shipped in `readJson` on 2026-08-13 and was recorded as closed while sixteen
handlers still called `req.json()` directly. Each check below is the sibling that asserts routes
actually *use* the thing, and each fails loudly rather than silently:

| Check | Asserts | How you satisfy it |
|---|---|---|
| `body-limit.ts` | no handler reads an unbounded body | `readJson` / `readJsonOptional`, or `ALLOWED_RAW` + reason |
| `route-auth.ts` | every handler establishes a principal | a session/token/secret call, or `PUBLIC_ROUTES` + reason |
| `step-up-guard.ts` | sensitive handlers re-authenticate | `requireStepUp` / `requireStepUpOnce`, or classify it |
| `api-reachability.ts` | no handler is unreachable | wire it, retire it, or `REACHED_FROM_OUTSIDE` + reason |
| `fetch-routes-exist.test.ts` | the other direction — no `fetch` names a route nothing serves | spell the path the way `src/app/api` spells it |
| `scrollable-regions.test.ts` | a box that scrolls sideways is focusable AND named | `tabIndex={0}` + `role="region"` + `aria-label`, or stop it scrolling |
| `type-scale.ts` | no page invents a tenth type step | `t1`–`t9`, never a px literal |
| `raw-color.test.ts` | hardcoded colours do not spread | the tokens in `globals.css` |

Two habits they encode. **Every allowlist entry argues for itself** — a reason under ~40 characters
fails, and a reason that makes a checkable claim (*"it is rate-limited"*) is itself checked, because
a justification that cannot be falsified is decoration. **Every check can be proven to fail** via a
planted violation, because three checks in this repo have passed on the very defect they were
written for: `api-reachability`'s module-specifier false positive, `step-up-guard`'s `Once?` typo,
and `type-scale`'s backtracking lookahead, which counted 388 violations that were all tokens.

## Conventions observed in the existing code

- Pools/clients initialize lazily so missing env vars don't crash at import time during tests.
- Pure logic is factored out of route handlers into `lib/` so it can be property-tested without a
  running server or DB (mock the `pg`/KMS/OpenAI boundary in tests).
- Source files carry a header comment citing the `Requirements: N.N` they satisfy — keep this
  traceability when adding files, referencing `.kiro/specs/relay-h0-mvp/requirements.md`.

## Notes

- Git is initialized with remote `origin` → github.com/sgharlow/relay (branch `master`).
- `README.md` is a real project README (rewritten 2026-06-19) — safe to read for project info.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
