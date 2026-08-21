# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Relay is a "living-continuity" platform. Owners build an encrypted vault of
accounts/credentials/documents/instructions, assign scoped access to recipients, and configure
verified trigger conditions. When a trigger fires, the system advances a release state machine
(`ARMED → PENDING → GRACE → RELEASED`) guarded by optimistic concurrency control. **Every release
is reversible** — when the owner checks back in, access closes. The default-safe state is always
`ARMED`.

> ⚠️ This paragraph read *"Emergencies are reversible; estate handoffs are permanent"* until
> 2026-08-21, a week after estate was withdrawn. **Relay offers no estate or inheritance capability
> and confers no legal authority on anyone** (`PROJECT.yaml → gates.g2-counsel-opinion.declined`,
> 2026-08-14, permanent). The `estate` trigger type survives in the domain enum for compatibility
> and is excluded from `USER_SELECTABLE_TRIGGER_TYPES` (`lib/domain/enums.ts`); `lib/ops/gates.test.ts`
> stops that list widening by accident. `README.md` has said this since the ruling — the first
> paragraph a new session reads had not caught up, which is the more expensive of the two places to
> be wrong. **Do not widen the selectable list and do not build estate.** Copy anywhere in the repo
> that still offers estate to a user is a defect to fix, not a feature to restore.

**Stack (locked):** Next.js 16 App Router (TypeScript) on Vercel · Aurora DSQL across two regions
(us-east-1 / us-west-2) · AWS KMS client-side envelope encryption · Vercel Cron · OpenAI · Resend.

The specs live in `.kiro/specs/relay-h0-mvp/` (`requirements.md`, `design.md`, `tasks.md`) and
`specs/Relay_H0_Build_Spec_v2.md`. **Each now opens with a dated banner naming what in it is stale —
read the banner before the body.**

Before changing release/crypto/OCC logic, read `design.md` **§Release State Machine** (the
permitted-transition table — seven edges, matching `PERMITTED_TRANSITIONS` exactly) and
**§Correctness Properties**. Those two sections are authoritative. The rest of that file is not:

> ⚠️ **One of the seven has NO CALLER, and that is deliberate — do not "clean it up".** `grace →
> cancelled` lost its only caller on 2026-08-21 when `POST /api/triggers/[id]/cancel` was retired:
> `cancelled` is the one terminal state a reversible trigger could reach, so a two-tap control on an
> emergency screen permanently retired the trigger type for that owner. Stand-down covers the case
> it was reached for and re-arms. The **edge** stays because production holds rows that took it and
> narrowing the state machine is a separate decision from removing a button.
> `lib/release/state-machine.ts` carries the argument in place, and a test asserts it is still seven.
> Reason and replacement: `docs/retired-surface.md`.

| For | Go to, not `design.md` |
|---|---|
| the schema | `db/migrations/*.sql`, re-measured live by `npm run verify:schema` |
| the routes | `src/app/api/**` |
| how a recipient is authenticated | `docs/standby-architecture.md` (hybrid+6, ratified 2026-08-11) |

> ⚠️ This pointer used to read *"it defines the schema, state-transition table, and the demo spine"*,
> and it sent people to a DDL block declaring **8 tables** — frozen at migration 001, and that
> number is fixed because the block is — when the migrations declare far more. Count them, don't
> read a number here: `grep -hoiE '^ *CREATE TABLE (IF NOT EXISTS )?[a-z_]+' db/migrations/*.sql | awk '{print tolower($NF)}' | sort -u` — anchored to the start of the line on purpose, because an
> unanchored grep also matches the phrase inside a comment in `029_auth_challenges.sql` and reports
> a table called `if`. The DDL is also missing
> `secret_kinds`, `factors_required`, `kms_context_era`, `received_denials` and `session_epoch`,
> which are exactly the columns the release and crypto paths write. Narrowed 2026-08-21. A pre-read
> named in an agent instruction file gets read; a stale one gets believed.
>
> ⚠️ **A count sat here too, from 2026-08-21 until later the same day.** This note said the
> migrations declare "**27**" — accurate when written, and wrong the next time anyone adds a table,
> two paragraphs above the one that bans hardcoded counts and explains that a hardcoded test count
> "sat here drifting for weeks; that is why it is gone." The number was never the point; the gap
> between 8 and *whatever it is now* is.

## Build state — commercialising, live at relaystandby.com

H0 is over: relay **won "Most Impactful"** (2026-08-05) and the product is now on the G1→G5
commercial track. `npm run build`, `npx tsc --noEmit` and `npm test` are green — **derive the test
count with the command in `PROJECT.yaml` (`derived.test_count`) rather than trusting a number
quoted in prose.** A hardcoded count sat here drifting for weeks; that is why it is gone.

Live on **https://relaystandby.com** (the custom domain — the old `relay-three-henna.vercel.app`
is a stale surface, not the product). Many sprints past the H0 MVP have shipped — **count them with
`ls docs/sprint-reports/ | wc -l`, and read the newest for what landed most recently.** Among them:
self-serve signup with per-user TOTP, access policies, delegation with consent, verifier
deny/abstain, access requests, recovery codes, the wired heartbeat scheduler with an off-Vercel
dead-man's switch, and live-mode Stripe billing.

> ⚠️ This said **"Six sprints"** until 2026-08-21, by which point `docs/sprint-reports/` held far
> more than six. Twelve lines above, this same file bans hardcoded counts and explains that a
> hardcoded test count "sat here drifting for weeks; that is why it is gone" — and then hardcoded a
> sprint count in the next paragraph. The rule was right and the application of it was incomplete.

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
npm run test:coverage  # vitest --coverage (v8). The thresholds are declared in vitest.config.ts and
                       # are enforced ONLY here and in CI, never by `npm run gate` — see "Two gates".

npm run gate           # types + lint + test + build. No database, no server. ⚠️ NOT identical to
                       # CI — CI runs `test:coverage` where this runs `vitest --run`, so gate
                       # evaluates NO coverage threshold. See "Two gates" below.
npm run verify:live    # the five E2E walks. NEEDS .env.local AND `npm run dev` running.
npm run verify:reveal  # the fourth walk, alone: an owner stores a structured secret with a
                       # TOTP seed, a recipient claims, a verifier confirms, and Reveal is
                       # pressed. Asserts the plaintext returns byte for byte as LABELLED
                       # fields, that the seed yields a six-digit code matching one computed
                       # independently, and that a LEGACY {"username","password"} item still
                       # decodes (every item imported before 2026-08-17 is stored that way and
                       # can never be rewritten). Run it after ANY change to secret-payload.ts,
                       # AccessClient or the KMS path.
npm run verify:factors # the fifth walk, alone. The migration-035 columns through the real
                       # stack, rather than through mocks: the browser
                       # declares what it encrypted (`secret_kinds`), a read returns it, the
                       # owner declares what the account demands (`factors_required`), and a
                       # password stored behind a coded door stops counting as reachable.
                       # NEEDS .env.local AND `npm run dev`. Creates one owner on a reserved
                       # domain and closes it. Run after ANY change to preparedness.ts,
                       # usability.ts, secret-payload.ts or the vault read path — the columns
                       # shipped fully unit-tested and completely INERT for a day, because no
                       # SELECT returned them and no client wrote them.
npm run verify:schema  # do both DSQL regions have the tables AND COLUMNS the migrations
                       # declare? Read-only (SELECT on pg_tables + information_schema).
                       # NEEDS .env.local, no server. Run it FIRST after applying a
                       # migration, and before a release. Columns since 2026-08-17: it
                       # compared table names only, so 028 and 034 — whose entire content
                       # is an ADD COLUMN — passed it while unapplied.
npm run verify:funnel  # is the G1 demand instrument alive? Drives a real browser against
                       # production under src=qa (gate-excluded), writes nothing.
                       # Run it on placement day and daily while a piece is live —
                       # docs/g1-editorial-lane.md step 5, ROADMAP Sprint 4.
                       # ⚠️ It used to be documented ONLY by "run it daily during an ad
                       # flight — see docs/g1-ad-creatives.md". Paid advertising was
                       # retired 2026-08-16 (ratified.retire-paid-advertising) and that
                       # doc carries a ⛔ RETIRED banner, so a live command's only
                       # instructions pointed at a document telling you not to act on it.
npm run verify:iam     # the OTHER half of the least-privilege wall — can the live site's IAM
                       # principal still obtain a DSQL ADMIN token? Reads the live policy,
                       # managed AND inline, wildcards included. verify:roles cannot see
                       # this. Read-only; NEEDS .env.admin (an identity that can read IAM).
npm run verify:kms     # the wall UNDERNEATH both of those, and the only one whose failure
                       # is permanent. Is the CMK every vault is wrapped under still there,
                       # enabled, not scheduled for deletion, rotation as intended, and does
                       # its key policy still let the runtime principal GenerateDataKey and
                       # Decrypt? A disabled or deleted key leaks nothing and makes every
                       # vault permanently unreadable — and a key PENDING DELETION still
                       # decrypts, so every other signal stays green for the whole waiting
                       # period and then the data is gone. Read-only (DescribeKey,
                       # GetKeyPolicy, GetKeyRotationStatus); NEEDS .env.admin, because the
                       # application deliberately does not hold kms:DescribeKey.
npm run verify:stamp   # the last link in verify:live, not run by hand. Appends one
                       # line to docs/verify-live-runs.jsonl recording that the
                       # chain completed, and against which commit. It runs only
                       # after all five walks exit 0, so the stamp is a side effect
                       # of success rather than a claim of it — and its ABSENCE is
                       # what lib/ops/verify-live-freshness.test.ts alarms on.
                       # Needs no credentials. Commit the log line with the work
                       # that run covered.
npm run verify:orphans # what did the walks leave behind on PRODUCTION? Counts every
                       # account on a reserved domain (.test/.invalid/.localhost),
                       # reports each one's rows, and EXITS 1 if any is older than
                       # 24h (`-- --hours N` to change it). READ-ONLY — it never
                       # deletes; closing an account is deleteAccount()'s job,
                       # which cancels billing first and repairs standby roles in
                       # OTHER owners' rosters. An account holding a subscription
                       # or standing by for someone else is reported HELD, never
                       # sweepable. NEEDS .env.local, no server. Run it after
                       # verify:live, and on any day a walk was interrupted.
npm run verify:dogfood # can the owner's vault host a cohort invitation? Counts
                       # items, recipients, verifiers, access rules and configured
                       # triggers for NON-DEMO owners, and names what is missing.
                       # Run it BEFORE `npm run invite:cohort`: that script invites
                       # people to stand by as recipients and verifiers for the
                       # owner's vault, and on 2026-08-20 that vault held one
                       # account and NOTHING else — zero items, zero people, no
                       # release ever opened — so an invitee would have been
                       # standing by for nothing. The access-rule count is the one
                       # that matters most: items and people with no rule between
                       # them are two lists, not a plan.
                       # ⚠️ A not-ready result is a STATUS, not a defect — nothing
                       # in this repo fixes it and no commit turns it green. Exit 1
                       # = not ready, exit 2 = the probe could not run, and the two
                       # are deliberately different. Demo-flagged owners are
                       # excluded on purpose: reset-demo.ts would satisfy every
                       # count while proving nothing. Read-only, asserted by test.
                       # NEEDS .env.local, no server.
npm run flight:snapshot # the G1 instrument's daily read, and the pre-placement check that
                       # the measurement starts from zero. Prints the snapshot row + the
                       # lead notes (verdict line 4), and EXITS 1 if caregiver_leads is
                       # not empty before the window opens — a lane that starts with rows
                       # in it has an N contaminated from day one. Read-only; runs as
                       # relay_dev, which cannot write that table. NEEDS .env.local, no
                       # server. Occasion: docs/g1-editorial-lane.md step 5, ROADMAP
                       # Sprint 4 ("day-of verify:funnel and flight:snapshot").
                       # ⚠️ This read "the sitting sheet's pre-flight line 3" until
                       # 2026-08-21. docs/g1-sitting-sheet.md is ⛔ RETIRED — "there is
                       # no sitting" — though its three pre-flight commands are the part
                       # its own banner says remains correct. The command is unchanged;
                       # only the occasion moved from a paid flight to a placement.

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

**Three env files, and the split is the security model** (2026-08-15; a third added 2026-08-21). There is one cluster and there
will be one until G1 is decided, so least privilege is built from identity, not environments.

| File | Identity | Can |
|---|---|---|
| `.env.local` | IAM `relay-dev` → DB role `relay_dev` | read/write product tables. **No DDL.** **Cannot write `caregiver_leads`.** |
| `.env.admin` | IAM `autospecai` → DB role `admin` | everything: migrations, roles, grants |
| `.env.ro` | IAM `relay-ro` → DB role `relay_ro` | **SELECT on every table and nothing else.** No writes, no DDL, and its IAM policy carries `dsql:DbConnect` with **no KMS at all** |

Those three are the **identities**. `ls .env*` also shows `.env.example` (the committed template)
and `.env.dsql` (cluster endpoints and ARNs from `provision-dsql.sh` — gitignored, no credentials,
not an identity). The table is the security model; it is not an inventory of files on disk.

`.env.ro` exists because an agent running anywhere but this laptop could not check ANYTHING
about the live system — the only credentials that existed could also write. Five of the seven
read-only verifications talk only to the database and **can** run under it:

```bash
npx tsx --env-file=.env.ro scripts/verify-schema.ts      # and verify-dogfood.ts,
npx tsx --env-file=.env.ro scripts/disposable-sweep.ts   # flight-snapshot.ts, verify-roles.ts
```

⚠️ **THE `npm run` SHORTCUTS DO NOT USE IT — spell the `.env.ro` path yourself.** Every one of
`verify:schema`, `verify:dogfood`, `verify:orphans`, `flight:snapshot` and `verify:roles` is still
declared in `package.json` as `--env-file=.env.local`, so `npm run verify:schema` connects as
`relay_dev` — an identity that can write. This paragraph said those five "now run under it" on the
day the role shipped, and `.env.ro`'s own header lists them by their **npm script names**, which
reads as a promise the scripts do not keep. Corrected 2026-08-21. Switching `package.json` over is a
one-line change per script and deliberately not made here: it belongs with whoever owns that file,
and a doc quietly asserting it had already happened is the failure being fixed.

⚠️ **`verify:iam` and `verify:kms` are NOT unlocked by it** — they read the AWS API rather than
the database, and a credential that lives in someone else's cloud has no business enumerating
IAM. They stay admin-run.

⚠️ **Read-only is not harmless.** Emails, display names and vault item TITLES are plaintext
columns, so this is still production PII. What it can never do is decrypt: with no KMS grant the
vault stays ciphertext with no key, which is the property that makes it safe to put somewhere
less trusted than this machine. `relay_ro` is watched by `npm run verify:roles` alongside the
other two — a wall that instrument does not check is a wall that can be widened silently.

`.env.admin` holds **no secrets** — just `AWS_PROFILE`, so the key stays in `~/.aws/credentials`
alone. Being a sysadmin is something you *choose* by naming that file, not a power you carry by
default. Until this existed the app minted an **admin** token, so production ran with full DDL
rights and the same IAM user's key sat on a laptop; nothing anywhere could tell them apart.

✅ **Production moved off the admin path on 2026-08-16.** `DSQL_ROLE=relay_app` is set in Vercel
and `dsql:DbConnectAdmin` has been stripped from `relay-runtime-policy` (v2; v1 retained as the
rollback), so the live site cannot obtain database admin by permission rather than by
configuration. Both halves are re-measurable: `npm run verify:roles` for the database wall,
`npm run verify:iam` for the IAM wall. A denied write still surfaces as `500 CaptureRefused`; if
you ever see that on the lead form, it is a grant, not a bug.

> ⚠️ This paragraph read *"Production is still on the admin path… Vercel moves to `relay_app` as a
> separate, explicit step"* for a day after that step was taken, while the `verify:roles` section
> 110 lines below already said the cutover was done. One file, two answers, about which identity
> the live site holds. Corrected 2026-08-16.

### 🔴 `master` IS BRANCH PROTECTED — `git push origin master` will be REFUSED

Enabled 2026-08-21. It sits beside the identity table because it is the same kind of rule — what a
credential is *allowed* to do — and it is the one that surfaces as a git error rather than a
database one: **an agent that does not know about it reads `protected branch hook declined` as a
broken credential and starts debugging the wrong thing.** Work goes on a branch and through a PR.

| Setting | Value | What it means for you |
|---|---|---|
| Pull request required | yes | no direct push, ever |
| Required approvals | **0** | a solo operator self-merges; the gate is the checks, not a second human |
| Required checks | **`verify`**, **`axe`** | the job names in `.github/workflows/ci.yml` and `a11y.yml`. Both run on `pull_request`, so both can actually report |
| Strict | yes | the branch must be up to date with `master` before merge |
| `enforce_admins` | **true** | it applies to Steve's own token too — deliberately, since a rule an admin routes around is a note, not a rule |
| Force pushes / deletions | blocked | a history rewrite now needs protection lifted first, on purpose |

**Read the required checks precisely: they are the gate, and `npm run gate` is not what they run.**
`verify` runs `test:coverage` with the thresholds, plus the AI-co-authorship trailer check — see
"Two gates" below. A PR that passes `gate` locally and fails `verify` on coverage is the expected
failure mode, not a surprise.

**Rollback, in one command**, because this is a change to a working repository and the policy that
governs those requires the way back to be written down before it is needed:

```bash
gh api -X DELETE repos/sgharlow/relay/branches/master/protection   # removes protection entirely
gh api repos/sgharlow/relay/branches/master/protection             # read the live settings
```

⚠️ **Read the live settings rather than trusting the table.** It is a GitHub-side setting that
leaves no trace in this repo — exactly the shape `verify:roles` and `verify:iam` exist for, and
nothing re-measures this one. The table is what was set on the day; the API is what is true now.

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

  🔴 **THE SWITCH MOVES THE DATA AND NOT THE KEY, and until 2026-08-20 nothing said so.**
  `lib/kms/kms-client.ts` builds one `KMSClient` from `AWS_REGION` (default `us-east-1`) against
  one CMK. Flipping `DSQL_USE_SECONDARY` reaches the us-west-2 database and then asks a us-east-1
  key to unwrap what it finds there. So a **regional KMS impairment in us-east-1 makes every vault
  unreadable from BOTH regions** — the failover is a database failover, and this product's data is
  ciphertext plus a wrapped key. Reads of non-secret rows keep working, which is the part that
  makes it confusing on the day: the site is up, the dashboard renders, and Reveal is the only
  thing that fails.
  Known, accepted, and recorded as `PROJECT.yaml → deferred → the-failover-does-not-carry-the-ability-to-decrypt`
  (B3). The fix is a multi-Region CMK — an infrastructure change to a working system, so it needs
  the 5-gate policy and Steve's explicit request: `docs/kms-region-proposal.md`. Do not take it as
  part of something else.

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

`npm run gate` is types + lint + test + build. It needs no credentials and no server, so CI runs the
same four stages on every push.

> ⚠️ **BUT `gate` IS NOT WHAT CI RUNS, and this section claimed it was until 2026-08-21.** CI's test
> step is **`npm run test:coverage`**; `gate:test` is **`vitest --run`**. Same suite, but coverage
> instrumentation and **the thresholds declared in `vitest.config.ts`** are evaluated only in CI.
> (The numbers are deliberately not repeated here — they live in that file, and this paragraph is
> about *which command reads them*, not what they are. They were spelled out twice in this file
> until 2026-08-21 — here and in the Commands block — which is once more than the repo's own
> one-authoritative-place rule allows.) **So a green `gate` can be a red CI**: delete the last
> test covering a branchy module and `gate` passes while CI fails on the threshold. CI also runs an
> AI-co-authorship trailer check that `gate` has no equivalent for.
>
> This divergence was *created* by closing D8 (`the-coverage-gate-is-declared-and-unenforced`) — the
> thresholds had been declared and read by nothing, and switching them on in CI was right. What went
> unrecorded is that turning them on in one of two "gates" made the two stop being the same thing,
> in a file that says they are. Documented rather than closed: making `gate:test` run with coverage
> would slow every local run to buy a signal CI already produces, and that is a `package.json`
> decision, not a doc one. **Before pushing anything that could move coverage, run
> `npm run test:coverage` rather than `npm run gate`.**

**`npm run verify:live` is the other half**: five walks that drive the running app —
`e2e-stepup` (17 assertions over HTTP), `e2e-multiowner` (14), `e2e-ui` (26, in a real browser),
`e2e-reveal` (20) and `e2e-factors` (17). Start `npm run dev` first.

> ⚠️ Those five counts are the volatile-number trap this repo's own rules name, and one of
> them had already sprung it: `e2e-factors` read **15** until 2026-08-18, when the walk was
> run and printed 17. The walk had grown and the line had not. **Each walk prints its own
> count on every run — read it there, not here.** The numbers are kept only so a wildly
> different total is noticeable; a difference of one or two means this line is stale, not
> that something is broken.

> ⚠️ **A LOCAL GREEN IS NOT A CI GREEN FOR ANYTHING THAT READS A CLOCK.** CI runs in
> **UTC**; this laptop does not. On 2026-08-18 a `snapshotDate` test asserted that the
> local rendering DIFFERS from the UTC one — true at UTC-07:00, false in UTC, where the
> two coincide by definition — so `npm run gate` passed here and CI failed on master.
> Run **`TZ=UTC npx vitest run`** before pushing anything that touches dates. Note the
> deeper half: in UTC that regression cannot be observed AT ALL, so a date rule needs a
> structural guard as well as a behavioural one.

> 🔴 **THE CHAIN CANNOT BE RUN TWICE IN AN HOUR FROM ONE HOST, and until 2026-08-20 nothing said
> so.** `/api/auth/signup` allows **10 per hour per client key** (`LIMIT = 10`,
> `WINDOW_MS = 60 * 60 * 1000`), and one full chain performs **exactly 10 signups**. So the first
> run consumes the entire budget and a second inside the hour is guaranteed to fail — as a bare
> `ERROR: signup begin 429`, part-way through, with nothing saying why. Found by hitting it: a walk
> reported `25/26` and the next two runs died outright, which reads exactly like a flaky test and is
> not one.
>
> The limiter is **per-instance memory** (`lib/http/rate-limit.ts`), so **restarting `npm run dev`
> resets the budget** and is the fix when you need a second run — that is the same fresh-instance
> state a real release run starts from, not a weakening of anything. ⚠️ Check that the old process
> actually died first: on Windows, killing the shell can leave `next dev` bound to 3000, and two
> listeners means walks land on whichever instance answers — including the one whose budget is
> already spent. `netstat -ano | grep :3000` should show exactly one `node`.
>
> The sign-in source limiter added the same day (`MAX_SOURCE_ATTEMPTS = 45` per 15 minutes,
> `lib/auth/signin-throttle.ts`) has more headroom — one chain performs ~11 sign-ins — but it is the
> same class, and roughly four chains inside fifteen minutes would trip it.

**It is deliberately NOT in CI.** These walks create and delete real accounts, and `.env.local`
points at the **production** cluster because Relay has no dev database. A job doing that on every
pull request would be writing to customers' data to check a diff — and the rows it forgot would be
the ones nobody was watching (an early run of the multi-owner walk left four behind; that is the
argument, not a hypothetical). Closing this properly needs a separate test cluster: an
infrastructure change with a cost, and Steve's call.

**And since 2026-08-19 it has a dead-man, because "one command a person runs" was the whole
weakness.** The chain ends with `npm run verify:stamp`, which appends a line to
`docs/verify-live-runs.jsonl` — so a stamp exists only if all five walks exited 0.
`lib/ops/verify-live-freshness.test.ts` then fails the suite when the newest stamp ages past 14
days. That is deliberate: this test is designed to go red on a date with no code change, exactly as
`gates.test.ts` is, and when it fires it is reporting that the live walks have stopped rather than
that something is broken. The portfolio rule it implements is that a check whose success signal is a
side effect must have its ABSENCE monitored — a job that never runs produces no failure to alert on,
and every previous attempt here was a note asking somebody to remember. A corrupt or future-dated
log reads as `unreadable`, never as fresh and never as "never run": those are different findings
with different fixes, and collapsing them is how a monitor lies. Exactly one line in that file was
written by hand (the 2026-08-18 chain run, backfilled with its evidence cited); every line after it
is script-written.

**`npm run verify:orphans` is the half of that problem a test cluster would NOT solve**, added
2026-08-19. Four more abandoned accounts were found on production on 2026-08-18 — not by the walks,
by looking, after an unrelated question, the oldest a day old. **Every run that created them
reported success**, because a walk that dies mid-way and a fixture script with no close step both
leave rows and say nothing. A separate cluster makes the walks *safe*; it does not make an
abandoned row *visible*, and nothing here was counting. This counts: reserved-domain accounts, their
rows, and a non-zero exit when any is older than a day, so the check can be watched rather than
remembered. It reports and never deletes — an account holding a subscription, or standing by in
another owner's roster, is HELD, because "a disposable-looking account holding live billing" is a
recorded trap in this portfolio and this schema has no foreign keys to catch a careless purge.

So it is one command a person runs before a release. Each walk asserts the layer the others cannot:
the server refusing correctly, and the screen a person actually meets. The UI walk exists because
the HTTP ones passed while the picker was laying itself out sideways on a phone.

**`verify:reveal` is the fourth, added 2026-08-17, and it covers the moment the product exists for.**
J8 is the primary demand journey and its evidence had gone stale in the most expensive way
available: the last live proof of the decrypt round trip was 2026-08-08, and it proved a screen that
secret-types Phase 0 then replaced — `<pre>{value}</pre>` became labelled fields, a masked password
and a generated TOTP code. The other three walks were green throughout and said nothing about it,
because none of them reveals anything. This one runs the whole chain — in-browser AES-GCM, KMS wrap,
DSQL, release, KMS unwrap, decrypt — and asserts the plaintext comes back byte for byte, as labelled
fields, with a six-digit code that matches one computed independently from the same seed. It also
decodes a LEGACY `{"username":…,"password":…}` item, because every item imported before Phase 0 is
stored in that shape permanently and the server can never rewrite it.

**`verify:factors` is the fifth, folded into the chain on 2026-08-18 — the day after it was
written as a standalone.** Its own sprint report filed that standalone status as debt and opened
no item for it: it "needs `.env.local` and a running server like the others, so it inherits the
same 'somebody must remember' weakness". The same day supplied the argument against leaving it
there. D1's fail-closed boundary — `secret_kinds` required on every vault write — broke
`e2e-multiowner` and `e2e-ui`, and `gate` was green throughout, because a unit suite cannot see a
real write path. `verify:factors` is the walk that proves the migration-035 columns are not
inert, which makes it exactly the walk that a change to those columns breaks. A gate somebody has
to remember is a gate on the days they remember.

**`npm run verify:schema` is a third, and the cheapest.** `migrate.ts` applies one named file and
tracks nothing, so which migrations have reached which cluster was never recorded anywhere. On
2026-08-15 that produced its first alert: `auth_challenges` was absent for four minutes while
migration 029 was being applied, every passkey sign-in threw, and the thing that noticed reported it
as a production failure from a laptop. This compares what the migrations declare against what each
cluster has — **both regions**, because failover here is an env switch (`DSQL_USE_SECONDARY`) and a
migration applied to only one region stays invisible until the day somebody flips it. Read-only, so
it is safe against production, which is the only place worth running it.

**Columns too, since 2026-08-17, and that is now the likelier half.** It compared `pg_tables` and
nothing else, so a migration whose entire content is `ALTER TABLE vault_items ADD COLUMN ...` passed
while being entirely unapplied — 028 and 034 are both exactly that shape, and both carry the owner's
own overrides. The table was present, so the answer was OK; the column was not, and the first report
would have been a runtime error on whoever pressed Save. Proven in both directions: clean against
both regions with all 31 added columns present, and failing in both regions on a planted column.

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
`relay_dev` (a laptop) can read that table and not write it, that **`relay_ro` (IAM `relay-ro`,
migration 039) holds SELECT and writes NOTHING — no DML on any table, no DDL, and an IAM policy
carrying `dsql:DbConnect` with no KMS at all**, that none of the three holds DDL, and that each is
bound to exactly one IAM principal. Proven to fail in both directions by planting a widened
`relay_dev` and a starved `relay_app`.

> ⚠️ **This paragraph described a TWO-role check ending "neither holds DDL" while three roles were
> being checked** — corrected 2026-08-21, the day `relay_ro` was added, and the same one-file-two-
> answers shape as the `relay_app` cutover and KMS paragraphs. The Environment section above already
> said `relay_ro` was watched here. The script fixed its own version of this on the same day: its OK
> line is now **derived from `CONTRACT`** rather than spelled out, precisely because a summary that
> silently stops describing what ran is the smallest version of the drift the whole file exists to
> catch. **So do not restate the role list from here — run it and read what it prints.** The point
> that generalises: a read-only role this instrument did not watch would be a wall that could be
> widened silently, which is the argument for adding it to `CONTRACT` rather than trusting that
> nobody grants it INSERT.

✅ **Cutover DONE 2026-08-16**: production connects as `relay_app`, and `dsql:DbConnectAdmin` has been
stripped from `relay-runtime-policy` (v2; v1 retained as rollback), so the live site can no longer
obtain database admin by permission rather than by configuration. `docs/least-privilege-cutover.md`.

**`npm run verify:iam` is the sixth, and it watches the half `verify:roles` structurally cannot.**
The cutover has two walls. `verify:roles` re-measures what a role may do *once connected*, by
reading the live catalog; the IAM policy decides something prior — whether the production principal
can obtain an admin connection at all. One `aws iam create-policy-version` puts `dsql:DbConnectAdmin`
back, in no diff, no test run and no build, and the app keeps working. This reads the live policy and
refuses three ways it can return: the literal action, a wildcard (`dsql:*`, `*`) that confers it
without naming it, and an **inline** user policy, which is a different API call entirely. It also
asserts the positive half — a policy stripped to nothing grants no admin and takes the site down, and
a check that is happiest when the product is broken is measuring the wrong thing. Proven in both
directions against real AWS data, with no IAM mutation: v1 is retained as the rollback and still
carries the grant, so pointing the reader at it is a live negative control.

**`npm run verify:kms` is the seventh, added 2026-08-20, and it watches the layer under both of
those.** `verify:roles` and `verify:iam` protect ACCESS to data that, if they fail, still exists.
Underneath them sits the customer master key, and every vault here is ciphertext plus a data key
wrapped by it — so the failure this watches for is not a breach, it is an **erasure with no
rollback**. A disabled key, a scheduled deletion, or a key policy that stops naming the runtime
principal leaks nothing and makes every vault permanently unreadable; `docs/backup-restore-runbook.md`
covers the database, and a restored cluster is ciphertext without the key that opens it.

**And the product looks fine the whole time**, which is why this is a scheduled re-measurement
rather than a note asking somebody to look: a key pending deletion **still decrypts**, so every
health check, canary and page stays green for the entire waiting period and then the data is gone.
That is the same green-signal-measuring-the-wrong-thing shape as the rest of this directory.

Read-only — `DescribeKey`, `GetKeyPolicy`, `GetKeyRotationStatus`, nothing else. `lib/ops/kms-wall.ts`
holds the pure verdict so every rule is proven against a planted fixture with no credentials, in the
shape `iam-wall.ts` established. It asserts the positive half too: a key policy that grants **nobody**
fails, because a check that is happiest when the product is dead is measuring the wrong thing.
Rotation is compared against `ROTATION_INTENDED`, which records the as-provisioned state rather than a
recommendation — the finding worth alarming on is nobody having decided.

✅ **LIVE-PROVEN 2026-08-20, and it has been seen to FAIL — which is the half that matters.** The
first live run read CMK `b3af288c…` in us-east-1: Enabled, customer-managed, `SYMMETRIC_DEFAULT`,
not pending deletion, key policy still granting the runtime principal `GenerateDataKey` and
`Decrypt` — with the principal ARN *derived from the key's own ARN* rather than configured, so the
check cannot be satisfied by a stale setting. `ROTATION_INTENDED = false` matched the live key, so
the pin records the as-provisioned state and a silent change in **either** direction is catchable.
The B3 single-Region note printed as a NOTE, not a failure, because a check that fails on a
knowingly-accepted limitation is a check somebody disables.

**Three negative controls, all exit 1:** (1) a key id that does not exist → `NotFoundException`
reported as a finding rather than a crash; (2) `KMS_KEY_ID` unset → refused before any AWS call;
(3) `alias/aws/s3` — a key that really exists and is **not ours** → the policy rule fires, which
proves the refusal is about the key's *state* and not merely about absence. Record:
`PROJECT.yaml → deferred → nothing-watches-the-key` (B4, closed 2026-08-20).

> ⚠️ This paragraph read *"The wiring is not yet live-proven… Point `KMS_KEY_ID` at a key that does
> not exist and confirm it exits 1"* for a day after that run happened — telling an operator to go
> and produce a proof the register already held. Corrected 2026-08-21. The same one-file-two-answers
> shape as the `relay_app` cutover paragraph above; both were closures recorded in `PROJECT.yaml`
> and not carried back here.

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
| `signin-is-throttled.test.ts` | the owner front door spends an attempt budget and rings the alarm | `checkSigninAllowed` before the lookup, `recordSigninFailure` + `recordCodeMiss('totp')` on refusal, `clearSigninFailures` on success |

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

## Runbooks — the documents nobody reads until they have to

| Runbook | For |
|---|---|
| `docs/security-incident-runbook.md` | somebody may have obtained access they should not have |
| `docs/secret-rotation-runbook.md` | a credential may have leaked, or is being rotated — one section per secret: what it protects, blast radius, and the procedure |
| `docs/backup-restore-runbook.md` | the data is gone, damaged, or a restore needs proving |
| `docs/email-dns-runbook.md` | mail is not arriving |
| `docs/kms-region-proposal.md` | not a runbook — the standing decision behind the failover limitation both of the first two describe |

> ⚠️ **This table said "the four documents" and omitted `secret-rotation-runbook.md` — the one the
> incident runbook hands off TO.** `docs/security-incident-runbook.md` routes its containment steps
> into that file (§1 for the mechanics, §2 for the procedure), so the index a person opens under
> pressure did not name the document the first runbook depends on. Added 2026-08-21; the runbook
> itself shipped 2026-08-20 (`PROJECT.yaml` B8) and its acceptance criterion required exactly this
> cross-link. Shipping a runbook and not indexing it is how it stays unread on the day it matters.

⚠️ **"Incident" already means two other things in this codebase**, and the security runbook opens by
saying so: `/api/audit/incidents` is a *customer-facing feature* ("what happened while you were
away") and `/api/incident` is a *client-side error beacon*. Neither is a security event.

Two facts from that runbook worth knowing before you need it, because both are counter-intuitive
under pressure. **There is no bulk session revocation** — `bumpSessionEpoch` is per user and is
called from exactly one place, so signing everybody out means rotating `NEXTAUTH_SECRET`, which is
a global outage as well as a containment. And **the zero-knowledge claim does not cover owner
authenticator seeds**: `users.totp_secret` is plaintext server-side and is not wrapped by the CMK,
so a database compromise reaches it even though it reaches no vault contents.

## Notes

- Git is initialized with remote `origin` → github.com/sgharlow/relay (branch `master`). **`master`
  is protected and refuses a direct push** — the settings, the required checks and the rollback
  command are in the Environment section, stated once, above.
- `docs/retired-surface.md` is where a deleted endpoint's reason and replacement live, so *"it used
  to be here"* has an answer other than `git log`. Check it before concluding a spec requirement is
  unimplemented — the route may have been retired on purpose, with the requirement met elsewhere.
- `README.md` is a real project README (rewritten 2026-06-19) — safe to read for project info.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
