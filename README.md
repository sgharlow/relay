# Relay — standby access for the people who'll need it

**Standby access for your digital life.** Relay lets you build an encrypted
vault of accounts, credentials, documents, and instructions, then assign
**scoped, reversible access** to the right people under rules you set. When a
trigger fires — a missed check-in or a manual emergency request — Relay runs a
controlled release (notify the owner, require N-of-M trusted verifiers) and
only then opens a guided, prioritized access dashboard to the recipient.
**Releases are reversible:** when you recover and check in, access closes
again. The default-safe state is always `ARMED`.

Relay does not offer estate or inheritance services and confers no legal
authority on anyone. (The domain model retains an `estate` trigger type for
compatibility, but it is permanently excluded from what a user can select —
see `lib/domain/enums.ts` and the Terms.)

> 🏆 **Winner — "Most Impactful"** in **H0: Hack the Zero Stack with Vercel and AWS Databases** (announced 2026-08-05, ~9,800 participants). Track: **Monetizable B2C** · AWS Database: **Amazon Aurora DSQL** · [Devpost submission](https://devpost.com/software/relay-n5c9re)

**▶ Live:** <https://relaystandby.com> · **🧭 Guided demo (no account needed):** <https://relaystandby.com/demo> · **🎬 Demo video:** <https://youtu.be/FU3azKJOesY>

The live deployment runs on Aurora DSQL, multi-region active-active. The guided demo is a read-only
walkthrough of the vault, the zero-knowledge envelope, the release state machine, and the
hash-chained audit log — the audit chain shown there is computed and verified with the same
primitives the app uses in production.

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
2. **Region failover** — flip to the us-west-2 endpoint; the data keeps working,
   strongly consistent, no interruption (active-active Aurora DSQL). ⚠️ **It is a
   *database* failover: decrypt stays in us-east-1.** The CMK is single-Region, so
   a us-east-1 KMS impairment leaves the site up, the dashboard rendering, and
   Reveal alone failing. Known and accepted — `PROJECT.yaml → deferred →
   the-failover-does-not-carry-the-ability-to-decrypt` (B3); the fix is a
   multi-Region CMK and is gated on the Infrastructure Change Policy
   ([`docs/kms-region-proposal.md`](docs/kms-region-proposal.md)).
3. **OCC correctness** — two concurrent releases, exactly one advances.
4. **Importance / risk graph** — the importance engine ranks the vault and reveals
   the "gates N" dependency edges.

## Stack (locked)

Next.js 16 (App Router, TypeScript) on **Vercel** · **Amazon Aurora DSQL**
(two regions, active-active, IAM auth) · **AWS KMS** (`@aws-sdk/client-kms`)
client-side envelope encryption · **NextAuth** + per-user TOTP MFA and
**WebAuthn passkeys** · **Stripe** (live-mode annual billing) · **OpenAI**
(importance engine) · **Resend** (notifications) · **node-postgres** · Vitest +
**fast-check** (property tests).

### The non-obvious invariants (preserve these)
- **No foreign keys** (DSQL) — referential integrity is app-enforced (`lib/db/integrity.ts`).
- **Snapshot isolation → 40001 retries** — every racy write goes through `withOccRetry`; on exhaustion a release row ends in `ARMED` (safe default).
- **Plaintext never leaves the browser** — per-item AES-GCM-256 data key, wrapped by KMS; the server stores only ciphertext + wrapped key.
- **AI sees metadata only** — `lib/ai/metadata-query.ts` is the sole accessor for `/api/ai/*`; never passes secret columns to an LLM.
- **Audit log is append-only + hash-chained** per owner; audit writes block the triggering op if they fail.

## Quickstart

```bash
npm install
npm test          # vitest --run — full suite green (405 at submission; run for the live count)
npm run build     # next build — production build
npm run dev       # http://localhost:3000  (needs DSQL + KMS env for DB-backed routes)
```

Tests are property-based where it matters (state machine, OCC, N-of-M, hash chain)
via `fast-check`. Pure logic is factored into `lib/` and unit-tested; route
handlers are thin and build-verified. AWS provisioning + the H0 live dogfood:
[`docs/aws-setup.md`](docs/aws-setup.md), [`docs/e2e-verification.md`](docs/e2e-verification.md)
— **both are H0-era records and both open with a banner saying which of their instructions have
since stopped working.** The identity model that supersedes the provisioning half is
[`docs/least-privilege-cutover.md`](docs/least-privilege-cutover.md).

## Status

**Claim ladder: `dogfooded` — and narrower than the word sounds.** `PROJECT.yaml`
is the authority (`ladder` + `ladder_evidence`, checked by `lib/ops/ladder-claim.ts`,
which goes red if the claim stops carrying its own evidence and a scope). It means the
mechanism was walked end to end against production on a dated occasion — real Aurora
DSQL, real KMS, live-mode Stripe checkout — **not** that Relay is in continuous use.

Many sprints past the H0 MVP have shipped — **count them with
`ls docs/sprint-reports/ | wc -l`, and read the newest for what landed most recently**
(the same derivation `CLAUDE.md` uses, so the two front-door documents cannot disagree).
Among them, at **`live-proven`, which is one rung below `dogfooded` and is not the same
claim**: self-serve signup with per-user TOTP, **WebAuthn passkeys**, access policies,
delegation with consent, verifier deny/abstain, access requests, recovery codes, and
**live-mode Stripe billing**. The evidence for that rung is the 2026-08-13 production
re-sweep at the top of [`docs/user-journeys.md`](docs/user-journeys.md), the same record
`PROJECT.yaml → ladder_evidence` cites.

One item on that list is **not** at that rung and is called out rather than folded in:
the **heartbeat scheduler is `wired`** — `docs/user-journeys.md` J5 says "wired (it had
never been scheduled)". Its off-Vercel dead-man's switch
(`.github/workflows/scheduler-monitor.yml`) is proven in both directions as a *monitor*;
that proves the monitor exists, not that a real trigger has fired for a real owner.

The standby-account direction
([`docs/standby-architecture.md`](docs/standby-architecture.md)) is ratified and partly
shipped. Estate and inheritance are **permanently withdrawn**, not pending.

**Not claimed:** no arms-length customer and no arms-length revenue.
`gates.g1-arms-length-demand` in `PROJECT.yaml` is the open gate that measures it, and
`market.wtp_evidence` reads `none`.

Full suite green — run `npx vitest --run` for the live count, and the commands in
`PROJECT.yaml → derived` for the route and page counts; `tsc --noEmit` +
`next build` clean. (This paragraph used to hardcode the route count. It had
drifted to under half the real number, in the first document a stranger reads —
which is why the counts are commands now and not copies. It also opened
*"Backend complete, all UI built"* — a bare completion claim with no ladder level, in
the same sentence as the fixed numbers, which is the identical failure in words instead
of digits. Corrected 2026-08-21.)

> **Was, and corrected the same day the paragraph above was written (2026-08-21):**
> - *"Six sprints past the H0 MVP have shipped"* — a hardcoded count, in the paragraph that ends
>   *"which is why the counts are commands now and not copies"*, and by then `docs/sprint-reports/`
>   held far more than six. It was hand-copied from `CLAUDE.md`, which was corrected the same day;
>   the two front doors disagreed for as long as it took somebody to read both.
> - The list was asserted **`live-proven` entire**, having dropped the qualifier its source carried:
>   `CLAUDE.md` reads *"the **wired** heartbeat scheduler"*. Promoting a `wired` item one rung, in
>   the paragraph explaining rungs, is the exact conflation it claims to fix. The scheduler is now
>   named separately above.
> - This Status section also used to read *"Deployed live and dogfooded end-to-end on Aurora DSQL +
>   AWS KMS, submitted to H0, and awarded **Most Impactful**"*. That sentence is gone rather than
>   corrected: the award is stated at the top of this file, and the dogfood basis is now stated in
>   ladder language with its scope, which the old sentence did not have. Recorded here because the
>   other deletion in this paragraph was marked and this one was not.

Specs (the build contract):
[`.kiro/specs/relay-h0-mvp/`](.kiro/specs/relay-h0-mvp/) and
[`specs/Relay_H0_Build_Spec_v2.md`](specs/Relay_H0_Build_Spec_v2.md);
Devpost write-up: [`specs/Relay_Devpost_Submission.md`](specs/Relay_Devpost_Submission.md).

## License

MIT — see [LICENSE](LICENSE).
