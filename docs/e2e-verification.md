# Relay — End-to-End Verification Checklist

What's already proven and what is NOT:

- ✅ **Unit/property tests** (`npx vitest --run`, 401) cover all pure logic, every API handler (mocked
  DB/KMS/OpenAI), and the correctness properties (OCC, state machine, N-of-M, hash chain, ranking…).
- ✅ **Build + types** (`npm run build`, `npx tsc --noEmit`) are clean.
- ✅ **Visually verified (Playwright)**: `/auth/signin`, `/auth/error`, the owner→signin redirect, and
  the Access-mode invalid-token path.
- ❌ **NOT verified**: any authenticated flow against real infrastructure — the encrypt/decrypt
  round-trip, the release/simulate spine, AI agents, region failover, KMS, and DSQL behaviour.

This checklist is the live dogfood that closes that gap. It requires real AWS infra (Aurora DSQL +
KMS), OpenAI, and Resend. Run it top to bottom; each step lists the **action** and the **expected
result**. **Synthetic E2E does not replace customer dogfood** for auth/credential paths — note where
human confirmation is required.

---

## 0. Prerequisites

### Infrastructure
- [ ] Aurora DSQL cluster provisioned in **us-east-1** (primary) and **us-west-2** (secondary); both
  regional endpoints reachable. (`scripts/provision-dsql.sh`, `docs/aws-setup.md`.)
- [ ] KMS CMK created; the app's IAM role has `kms:GenerateDataKey` + `kms:Decrypt` on it.
  (`infra/iam-policy.json`.)
- [ ] OpenAI API key with access to the configured model (default `gpt-4o-mini`).
- [ ] Resend API key + a verified `from` address.

### Environment (`.env.local`, or Vercel env)
Copy `.env.example` and fill ALL of:
- [ ] `DSQL_PRIMARY_ENDPOINT`, `DSQL_SECONDARY_ENDPOINT`, `DSQL_CLUSTER_ARN`
- [ ] `KMS_KEY_ID`
- [ ] `NEXTAUTH_SECRET` (`openssl rand -base64 32`), `NEXTAUTH_URL`
- [ ] `RECIPIENT_JWT_SECRET`, `VERIFIER_JWT_SECRET` (`openssl rand -base64 32` each)
- [ ] `CRON_SECRET` (`openssl rand -hex 32`)
- [ ] `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`)
- [ ] `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`
- [ ] `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (local dev; use the IAM role in prod)
- [ ] `TOTP_SECRET` — base32 (e.g. add it to an authenticator app as the account secret). **Required
  for sign-in.** Without it, `authorize()` throws and no one can log in.

> ✅ **`auth_sub` upsert — already FIXED (commit `c4b0005`, see §10 Risk A).** The sign-in upsert was
> rewritten to the app-level intent-read pattern in `lib/auth/upsert-user.ts` (SELECT → UPDATE/INSERT
> via `withOccRetry`, **no `ON CONFLICT`**, no UNIQUE-index dependency), so sign-in no longer requires
> migration 002. Migration `002_unique_auth_sub.sql` is now OPTIONAL/unapplied. Step 3 below just
> confirms sign-in works against your live DSQL cluster — it should simply succeed.

---

## 1. Pre-flight (no infra needed)
- [ ] `npx vitest --run` → **401 passed**.
- [ ] `npx tsc --noEmit` → exit 0. (If it reports stale errors, `rm -f tsconfig.tsbuildinfo` first.)
- [ ] `npm run build` → "Compiled successfully", exit 0.

## 2. Migrate + seed
- [ ] `npx tsx db/migrations/migrate.ts` → all 7 tables created (`users`, `recipients`, `verifiers`,
  `vault_items`, `access_rules`, `release_state`, `verifier_confirmations`, `audit_log`).
- [ ] `npx tsx db/seeds/demo-seed.ts` → prints "Seeded demo owner … 25 items, 2 recipients, 2
  verifiers, 4 rules, 2 release states." Demo owner = `demo@relay.test`, `is_demo_account=true`,
  `auth_sub=credentials:demo@relay.test`, emergency + estate release states ARMED.
- [ ] Quick DB sanity: `SELECT email, is_demo_account, auth_sub FROM users WHERE email='demo@relay.test'`
  → one row, `is_demo_account=t`, `auth_sub=credentials:demo@relay.test`.

## 3. Sign-in (MFA)
- [ ] Generate the current TOTP code:
  `npx tsx -e "import {generateTotpCode} from './lib/auth/totp'; console.log(generateTotpCode())"`
  (or read it from your authenticator app keyed on `TOTP_SECRET`).
- [ ] Visit `/vault` unauthenticated → redirects to `/auth/signin`. ✅ (already verified)
- [ ] Sign in with `demo@relay.test` + the 6-digit code → lands on `/vault`.
- [ ] **Wrong code** → stays on sign-in with the error message (MFA gate holds).
- [ ] After login, the sidebar shows a "Demo account" marker (confirms `is_demo` survived the upsert —
  proves §10 Risk A is resolved and you're on the seeded row).

## 4. Owner vault + the crypto round-trip (the core security claim)
- [ ] `/vault` shows the 25 seeded items grouped by category; **Gmail** and **1Password** carry a
  **ROOT** badge; bank items (Chase/BofA/Fidelity) show a **gates N** pill.
- [ ] **Add a REAL item** (seed items use placeholder ciphertext and will NOT decrypt): `/vault/new` →
  title "E2E Test", type login, secret "round-trip-secret-123" → Save. Network tab shows
  `POST /api/kms/wrap` then `POST /api/vault/items`; **the request body contains only base64
  ciphertext — never the plaintext "round-trip-secret-123".**
- [ ] DB check: `SELECT title, encode(ciphertext,'hex') FROM vault_items WHERE title='E2E Test'` →
  ciphertext bytes ≠ the UTF-8 of the plaintext (zero-plaintext-at-rest).
- [ ] Item appears on `/vault`. (Decryption of this item is verified in §7.)

## 5. People + rules
- [ ] `/recipients` lists the 2 seeded recipients + 2 verifiers; add one of each → appears in the list;
  delete → disappears.
- [ ] `/rules`: builder lists vault items + recipients; pick the **E2E Test** item + a recipient,
  trigger `emergency`, scope `view` → Add → appears in the rule list.
- [ ] Select trigger `estate` → the **Reversible** checkbox forces off + disables (Property 7 in the UI).
- [ ] Creating the rule provisioned/kept an emergency `release_state` (check on `/triggers`).

## 6. Release / demo spine
- [ ] `/triggers` shows emergency + estate release states with state badges (ARMED).
- [ ] **Cadence**: change check-in interval to 14 → Save → reload shows 14. Set to 0 or 400 → 400 error.
- [ ] **N-of-M**: set required confirmations to 2 (you have 2+ verifiers) → OK; set to 99 → 400 ("N≤M").
- [ ] **Simulate** (demo-only button visible): click → 10s countdown bar → "Released via pending →
  grace → released"; the emergency badge ends RELEASED. (Run twice concurrently in two tabs → exactly
  one succeeds, the other 409 — OCC; this is also Demo Moment 3.)
- [ ] **Heartbeat reversal**: re-arm (or simulate a fresh trigger to GRACE), then
  `PUT /api/checkin` (or the check-in action) → reversible trigger returns to ARMED; an **estate**
  trigger mid-release returns 409 "cannot be reversed".
- [ ] **Cron**: `curl -X POST $URL/api/cron/heartbeat -H "Authorization: Bearer $CRON_SECRET"` →
  `{evaluated, transitioned, failures}`. Wrong/no secret → 401.
- [ ] **Verifier email**: Initiate emergency → check the Resend dashboard / verifier inbox for the
  confirmation email with a `/confirm?token=…` link (Req 6.2). ⚠️ Confirm a real email was delivered.

## 7. Recipient access + decrypt (the other half)
- [ ] **Auto-notification**: after a real release reaches RELEASED (initiate → verifier confirms →
  release, NOT simulate which suppresses email), each scoped recipient gets an email with an
  `/access?token=…` link (`notifyRecipientsOfRelease`). Check the Resend dashboard / recipient inbox.
  Re-send on demand: `POST /api/triggers/<releaseStateId>/notify` (owner-authed) → `{notified}`.
- [ ] (Alternative for a token without email) Get a recipient id + the released emergency
  release_state id + its version from the DB, then mint a token:
  `npx tsx -e "import {issueRecipientToken} from './lib/auth/recipient-token'; console.log(issueRecipientToken('<recipientId>','<releaseStateId>', <version>n))"`
- [ ] Visit `/access?token=<token>`:
  - If the release is **RELEASED** → the amber Access page shows a numbered step plan grouped into
    Do today / This week / Within 30 days; the recipient's scoped items only.
  - If **not released** → "Access not yet active" with limited fields (no decrypt). ✅ (invalid-token
    path already verified)
- [ ] Ensure the **E2E Test** item is scoped to this recipient + RELEASED, then click **Reveal** →
  `POST /api/access/<id>/decrypt` → the browser shows `{"username":…,"password":"round-trip-secret-123"}`.
  **This proves the full owner-encrypt → KMS → recipient-decrypt loop.** (Seeded items will show the
  "could not decrypt — demo/seed data" message — expected.)
- [ ] Tamper test: mint a token with the wrong `version` → `/access` → 403 "invalid or expired".

## 8. AI agents (need OPENAI_API_KEY)
- [ ] `curl -X POST $URL/api/ai/intake -H "Cookie: <owner session>"` → `{scored, warnings, results}`;
  reload `/vault` → importance scores + ROOT/recurring/irreplaceable flags now reflect the model (not
  the seed's hardcoded values); bank→Gmail `depends_on` edges populated (gates pills update).
- [ ] `POST /api/ai/prioritize` → ranked gaps incl. CUSTODY_RISK for irreplaceable items without a
  recipient/note.
- [ ] `POST /api/ai/triage` `{recipient_id, trigger_type:'emergency'}` → step plan; every item appears
  after its dependency; buckets match scores.

## 9. Audit chain
- [ ] `/audit` shows entries in ascending seq for everything done above (kms_wrap_requested,
  vault_item_created, release_transition_*, owner_checkin, vault_item_decrypted, …). Server badge = "intact".
- [ ] Click **Verify chain** → "Client: intact" (client-side Web Crypto recompute agrees with server —
  this parity is unit-proven, but confirm visually on real data).
- [ ] Optional tamper: hand-edit one `audit_log.detail` row in the DB, reload `/audit`, Verify chain →
  the altered seq highlights red and the badge shows "broken @ <seq>".

## 10. The four demo moments (design.md)
1. **Reversible emergency** — §6 simulate + §6 heartbeat reversal.
2. **Region failover** — set `DSQL_USE_SECONDARY=true` (Vercel env or `.env.local`), redeploy/restart,
   reload `/access` (or any read) → data still loads (served from us-west-2). Confirm via DSQL metrics
   that the secondary endpoint took traffic. Reset to primary after.
3. **OCC correctness** — two concurrent simulates → exactly one advances (§6).
4. **Importance / risk graph** — after §8 intake, Gmail ranks first with a "gates N" reveal on the
   vault + the recipient access plan (§7).

---

## Known integration risks (verify explicitly — most likely to break on real infra)

- **Risk A — `auth_sub` uniqueness — FIXED (commit `c4b0005`).** The sign-in upsert no longer uses
  `ON CONFLICT (auth_sub)`; `upsertUser()` (`lib/auth/upsert-user.ts`) now does an app-level
  intent-read (SELECT → UPDATE/INSERT via `withOccRetry`), so it needs no UNIQUE index and no schema
  change and works on both Postgres and DSQL. Migration `002_unique_auth_sub.sql` is OPTIONAL/unapplied
  (infra-gated + possibly DSQL-incompatible — do not apply). Confirm sign-in works live in Step 3.
- **Risk B — recipient access-link delivery.** RESOLVED: recipients are auto-emailed an `/access`
  link the moment a real release reaches RELEASED (`notifyRecipientsOfRelease`, wired into the
  confirmation path), and `POST /api/triggers/<releaseStateId>/notify` re-sends on demand. Verify a
  real email is actually delivered (Resend) for the deployed URL. (Simulate intentionally suppresses
  these emails — Req 9.5.)
- **Risk C — seed items are not decryptable.** `db/seeds` uses placeholder ciphertext. Only items
  created via `/vault/new` (or `/import`) decrypt. Don't judge the decrypt path on seed data.
- **Risk D — DSQL specifics.** No FK/UNIQUE enforcement, snapshot isolation (SQLSTATE 40001 retries),
  `gen_random_uuid()` availability, and `ON CONFLICT` semantics should all be confirmed against the
  actual cluster — the unit tests mock the driver and cannot catch these.
- **Risk E — KMS IAM.** Confirm the running role can `GenerateDataKey` + `Decrypt`; the Intake Agent's
  role should be DENIED `kms:Decrypt` (Req 11.5/2 — ZK boundary), which the app cannot self-verify.
- **Risk F — auth/credential paths need human dogfood.** Synthetic checks here do not substitute for a
  real person completing sign-in + an end-to-end emergency on the deployed URL.

## Cleanup
- [ ] Reset `DSQL_USE_SECONDARY` to unset/false.
- [ ] Remove the E2E Test item + any test recipients/rules, or re-run the seed against a fresh schema.
- [ ] Rotate any secrets used for the test if the environment is shared.
