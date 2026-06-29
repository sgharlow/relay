# Relay — H0 Submission Runbook (cliff-day, ordered)

**Hackathon:** H0 "Hack the Zero Stack with Vercel and AWS Databases" · Track: **Monetizable B2C** · AWS Database: **Amazon Aurora DSQL**
**Deadline:** 2026-06-29 5:00pm PDT · **Submit-by target: June 27** (2-day buffer)
**Sibling entry:** `orbis-exchange` (Track 3) shares this exact deadline.

> **Why this file exists:** the detailed docs are correct but scattered —
> [`aws-setup.md`](aws-setup.md) (provisioning), [`e2e-verification.md`](e2e-verification.md)
> (dogfood), [`../specs/Relay_Devpost_Submission.md`](../specs/Relay_Devpost_Submission.md)
> (paste-blocks + video script). This is the single **ordered** path that stitches
> them together. Each step points to the detailed doc — it does not duplicate it.
> Everything from Step 1 on is **user/interactive** (needs real AWS creds).

---

## Status snapshot (updated 2026-06-27)

| Layer | State |
|---|---|
| Code: backend (28 routes) + all UI + recipient notifications | ✅ complete |
| Tests | ✅ **405 / 58 files green** (`npx vitest --run`) |
| `tsc --noEmit` · `next build` | ✅ clean |
| **Sign-in upsert (was integration Risk A)** | ✅ **FIXED — commit `c4b0005`** (app-level intent-read, no `ON CONFLICT`, no UNIQUE-index dependency). Sign-in now works on real DSQL **without** migration 002. |
| Live infra (DSQL + KMS + Vercel deploy) | ✅ provisioned + deployed live |
| Authenticated E2E on real infra | ✅ **dogfooded live 2026-06-27** — full crypto round-trip, release spine, active-active multi-region, audit chain |
| Demo video | ✅ **published** — <https://youtu.be/FU3azKJOesY> (narrated, `demo-out/relay-demo-narrated.mp4`) |

**Bottom line:** no code blocker remains; provisioning, the live dogfood, and the demo video are done. Only the Devpost form (Aurora DSQL screenshot + paste fields) remains.

---

## Step 0 — Pre-flight (no infra needed, ~3 min)
- [ ] `npx vitest --run` → **403 passed**.
- [ ] `npx tsc --noEmit` → exit 0. (Stale errors? `rm -f tsconfig.tsbuildinfo` first.)
- [ ] `npm run build` → "Compiled successfully".

## Step 1 — Provision AWS (~30–45 min) → [`aws-setup.md`](aws-setup.md) Steps 1–7
- [ ] Aurora DSQL **primary** cluster in `us-east-1` (deletion-protected) → ACTIVE.
- [ ] Aurora DSQL **secondary** cluster in `us-west-2` → ACTIVE.
- [ ] **Link** them multi-region active-active.
- [ ] Record `DSQL_PRIMARY_ENDPOINT`, `DSQL_SECONDARY_ENDPOINT`, `DSQL_CLUSTER_ARN`.
- [ ] KMS CMK + alias `alias/relay-h0-mvp` → record `KMS_KEY_ID`.
- [ ] IAM policy + role (`relay-backend-dsql`); prefer **Vercel AWS OIDC** over long-lived keys.
      The policy's Deny on `relay-ai-intake*` enforces the ZK boundary (Intake Agent can't `kms:Decrypt`).

> Automated alternative: `scripts/provision-dsql.sh`.

## Step 2 — Secrets + environment (~10 min) → [`e2e-verification.md`](e2e-verification.md) §0
Fill `.env.local` **and** the Vercel project env (Settings → Environment Variables):
- [ ] `DSQL_PRIMARY_ENDPOINT`, `DSQL_SECONDARY_ENDPOINT`, `DSQL_CLUSTER_ARN`, `KMS_KEY_ID`
- [ ] `NEXTAUTH_SECRET` (`openssl rand -base64 32`), `NEXTAUTH_URL`
- [ ] `RECIPIENT_JWT_SECRET`, `VERIFIER_JWT_SECRET` (`openssl rand -base64 32` each)
- [ ] `CRON_SECRET` (`openssl rand -hex 32`)
- [ ] `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4o-mini`)
- [ ] `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (verified sender)
- [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` (local dev only; use the IAM role in prod)
- [ ] **`TOTP_SECRET`** (base32) — **required for sign-in**; add it to an authenticator app. Without it `authorize()` throws and no one can log in.

## Step 3 — Migrate + seed (~5 min) → [`aws-setup.md`](aws-setup.md) Step 8 + [`e2e-verification.md`](e2e-verification.md) §2
- [ ] `npx tsx db/migrations/migrate.ts` → 7 tables created.
- [ ] `npx tsx db/seeds/demo-seed.ts` → "Seeded demo owner … 25 items, 2 recipients, 2 verifiers, 4 rules, 2 release states." Demo owner `demo@relay.test`, `auth_sub=credentials:demo@relay.test`, `is_demo_account=true`.
- [ ] **Migration 002 (`002_unique_auth_sub.sql`) is OPTIONAL and should be left UNAPPLIED.** Risk A is already fixed in code (`c4b0005`); 002 is an infra-gated schema change that DSQL may not even enforce. Do **not** apply it under cliff-time pressure.

## Step 4 — Deploy to Vercel (~10 min)
- [ ] Deploy `apps`/repo to Vercel with the Step-2 env set; confirm `NEXTAUTH_URL` = the deployed URL.
- [ ] DB-backed GET routes are `force-dynamic` (already set) so build won't hit the DB.
- [ ] Record the **published Vercel project link** + **Vercel Team ID** (Devpost requires both).

## Step 5 — Live dogfood (the quality gate before footage, ~30–45 min) → [`e2e-verification.md`](e2e-verification.md) §3–§9
Run it top to bottom on the deployed URL. The critical proofs:
- [ ] **Sign-in** with `demo@relay.test` + a live TOTP code lands on `/vault`; wrong code is rejected; the "Demo account" marker confirms you're on the seeded row. *(This is where the Risk A fix gets confirmed against the real cluster — it should now simply work.)*
- [ ] **Crypto round-trip:** add a REAL item via `/vault/new`, confirm the request body carries only base64 ciphertext (never plaintext); decrypt it on the recipient side after a real release → plaintext returns. *(Seeded items intentionally won't decrypt — Risk C, by design.)*
- [ ] **Release spine:** simulate (10s ARMED→…→RELEASED), heartbeat reversal, N-of-M, cron `401` on bad secret; two concurrent simulates → exactly one wins (OCC).
- [ ] **Recipient email** (Risk B): a real release emails each scoped recipient an `/access?token=…` link — **confirm actual delivery in Resend** (simulate suppresses these by design).
- [ ] **Audit chain** verifies "intact" client + server.

> Auth/credential paths need a **real human** completing sign-in + an emergency end-to-end (Risk F) — synthetic checks don't substitute.

## Step 6 — Multi-region failover + storage screenshots (~15 min) → [`aws-setup.md`](aws-setup.md) "Failover Testing"
- [ ] Set `DSQL_USE_SECONDARY=true` (Vercel env), redeploy/restart, reload `/access` → data still loads from us-west-2; confirm via DSQL metrics the secondary took traffic. **Reset to false after.**
- [ ] Capture the **Aurora DSQL console screenshot** (cluster + region config) — a hard submission requirement.

## Step 7 — Record the demo video (<3 min, YouTube) → [`../specs/Relay_Devpost_Submission.md`](../specs/Relay_Devpost_Submission.md) "Demo video script"
- [ ] Problem → who/why → working app (import → importance ranking → scoped emergency access with real verifier confirm) → **live region failover** → reversible close → the Aurora DSQL consistency/OCC explanation. Publish public/unlisted-public.

## Step 8 — Fill Devpost → [`../specs/Relay_Devpost_Submission.md`](../specs/Relay_Devpost_Submission.md)
- [ ] Paste the description blocks; **name Amazon Aurora DSQL** as the database.
- [ ] Demo video link · Vercel project link + **Team ID** · architecture diagram (`relay_architecture.svg` — confirm it exists/exports to an uploadable image) · Aurora DSQL screenshot.
- [ ] **Verify every link opens logged-out / incognito.**

## Step 9 — Bonus (+ Stage-2 points)
- [ ] Build post on builder.aws.com / dev.to / LinkedIn / Medium with **#H0Hackathon** + the required "created for this hackathon" statement; add the URL into the Devpost entry.

## Step 10 — Submit + final re-verify
- [ ] **Submit by June 27.**
- [ ] Morning of **June 29**: re-verify the live app + every submitted link one more time.

---

## Integration-risk register (status)
| Risk | Status |
|---|---|
| **A — `auth_sub` uniqueness / sign-in upsert** | ✅ **FIXED in code** (`c4b0005`, app-level intent-read). Confirm it works during Step 5 sign-in. |
| **B — recipient access-link delivery** | Wired (`notifyRecipientsOfRelease`); **verify real Resend delivery** in Step 5. |
| **C — seed items not decryptable** | By design (placeholder ciphertext). Only `/vault/new` + `/import` items decrypt. Not a bug. |
| **D — DSQL specifics** (no FK/UNIQUE, 40001 retries, `gen_random_uuid`, `ON CONFLICT`) | Confirm against the live cluster in Step 5; unit tests mock the driver. |
| **E — KMS IAM** | Confirm the role can `GenerateDataKey`+`Decrypt`; Intake role DENIED `Decrypt` (ZK boundary). |
| **F — human dogfood** | A real person must complete sign-in + an end-to-end emergency on the deployed URL. |

## Teardown / hygiene (after capture)
- [ ] Reset `DSQL_USE_SECONDARY` to unset/false.
- [ ] Remove E2E test item + any test recipients/rules (or re-seed a fresh schema).
- [ ] Rotate any secrets used in a shared environment.
- [ ] Clusters are deletion-protected — keep them until results, then tear down to stop spend.

---
*Generated 2026-06-19 as Story 3 of the daily-priority session (docs only). Orbis's equivalent cliff-day runbook already exists — see `orbis-exchange/docs/SUBMISSION-STATUS.md` §1–8 + `SUBMISSION-CHECKLIST.md` §D — so no duplicate was created there.*
