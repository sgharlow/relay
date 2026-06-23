# Relay — standby access for the people who'll need it

**Living-continuity for your digital life.** Relay lets you build an encrypted
vault of accounts, credentials, documents, and instructions, then assign
**scoped, reversible access** to the right people under rules you set. When a
trigger fires — a missed check-in, a manual emergency request, or a verified
estate event — Relay runs a controlled release (notify the owner, require N-of-M
trusted verifiers, observe a grace window) and only then opens a guided,
prioritized access dashboard to the recipient. **Emergencies are reversible:**
when you recover and check in, access closes automatically. Estate handoffs are
permanent. The default-safe state is always `ARMED`.

> **H0 — Hack the Zero Stack with Vercel and AWS Databases** · Track: **Monetizable B2C** · AWS Database: **Amazon Aurora DSQL**

**▶ Live:** <!-- FILL AT SUBMISSION: paste the Vercel production URL here --> _(deployed at submission — see [`docs/SUBMISSION-RUNBOOK.md`](docs/SUBMISSION-RUNBOOK.md))_ · **🎬 Demo video:** <!-- FILL AT SUBMISSION: paste the public YouTube URL here --> _(link added after recording)_

> **Submission status:** code complete · **401 tests / 58 files green** · `tsc` + `next build` clean. The only remaining work is live AWS provisioning → deploy → dogfood → capture → Devpost form. Turnkey paste sheet: [`specs/DEVPOST-PASTE-MAP.md`](specs/DEVPOST-PASTE-MAP.md). Ordered cliff-day path: [`docs/SUBMISSION-RUNBOOK.md`](docs/SUBMISSION-RUNBOOK.md).

---

## Why it's more than a vault

- **An importance engine.** Import a password-manager export and dozens of
  accounts populate instantly; Relay ranks them by what matters in a crisis and
  surfaces the few that count — including the risk-graph insight that your primary
  email is the key that unlocks most password resets. The engine sees **non-secret
  metadata only** (zero-knowledge boundary) — the smartest part of the product
  never sees a secret.
- **A release that's correct under pressure.** The irreversible handoff is a state
  machine (`ARMED → PENDING → GRACE → RELEASED`) whose every transition is a
  **compare-and-set validated by Aurora DSQL's optimistic concurrency** — it can
  never double-release, even when the owner, the verifiers, and the scheduler all
  act at once.

## The four demo moments

1. **Reversible emergency** — request access, verifiers confirm, recipient gets a
   scoped plan; owner checks in and access closes automatically.
2. **Region failover** — flip to the us-west-2 endpoint; access keeps working,
   strongly consistent, no interruption (active-active Aurora DSQL).
3. **OCC correctness** — two concurrent releases, exactly one advances.
4. **Importance / risk graph** — the importance engine ranks the vault and reveals
   the "gates N" dependency edges.

## Stack (locked)

Next.js 14 (App Router, TypeScript) on **Vercel** · **Amazon Aurora DSQL**
(two regions, active-active, IAM auth) · **AWS KMS** (`@aws-sdk/client-kms`)
client-side envelope encryption · **NextAuth** + TOTP MFA · **OpenAI** (importance
engine) · **Resend** (notifications) · **node-postgres** · Vitest + **fast-check**
(property tests).

### The non-obvious invariants (preserve these)
- **No foreign keys** (DSQL) — referential integrity is app-enforced (`lib/db/integrity.ts`).
- **Snapshot isolation → 40001 retries** — every racy write goes through `withOccRetry`; on exhaustion a release row ends in `ARMED` (safe default).
- **Plaintext never leaves the browser** — per-item AES-GCM-256 data key, wrapped by KMS; the server stores only ciphertext + wrapped key.
- **AI sees metadata only** — `lib/ai/metadata-query.ts` is the sole accessor for `/api/ai/*`; never passes secret columns to an LLM.
- **Audit log is append-only + hash-chained** per owner; audit writes block the triggering op if they fail.

## Quickstart

```bash
npm install
npm test          # vitest --run — 401 tests / 58 files, all green
npm run build     # next build — production build
npm run dev       # http://localhost:3000  (needs DSQL + KMS env for DB-backed routes)
```

Tests are property-based where it matters (state machine, OCC, N-of-M, hash chain)
via `fast-check`. Pure logic is factored into `lib/` and unit-tested; route
handlers are thin and build-verified. AWS provisioning + live dogfood:
[`docs/aws-setup.md`](docs/aws-setup.md), [`docs/e2e-verification.md`](docs/e2e-verification.md).

## Status

Backend complete (**28 API routes**), all UI built, recipient-release
notifications wired. `npx vitest --run` = **401 green**; `tsc --noEmit` + `next
build` clean. Remaining work is deploy + capture + submit — see the ordered
[**Submission runbook**](docs/SUBMISSION-RUNBOOK.md). Specs (the build contract):
[`.kiro/specs/relay-h0-mvp/`](.kiro/specs/relay-h0-mvp/) and
[`specs/Relay_H0_Build_Spec_v2.md`](specs/Relay_H0_Build_Spec_v2.md);
Devpost write-up: [`specs/Relay_Devpost_Submission.md`](specs/Relay_Devpost_Submission.md).

## License

MIT — see [LICENSE](LICENSE).
