# Proposal: a database identity on a CI runner — `relay-ro-ci` (OIDC)

**Status: DRAFTED, NOT BUILT.** Steve ruled **"yes, via OIDC"** on 2026-09-01 (co-pilot sitting).
This is that ruling written out as a reviewable change for `/safe-execute`. Nothing here has been
executed, and no IAM object exists.

> **The ruling being implemented:** *may a CI runner hold a database credential?* — **yes, via
> OIDC**: no stored secret, a role assumed per-run from a pinned ref, scoped to the read-only
> database identity. The `kms-wall.yml` precedent (2026-08-24) already proves a runner can reach
> AWS with nothing stored.

---

## 1. 🔴 The blocker is smaller than its own description — measured 2026-09-01

D21 has been carried as *"a database credential on a runner"*, and B28 (owner-mode accessibility in
CI) has been blocked on it since 2026-08-21. That phrasing implied a **write** identity, because
the audit "mints an owner session" and creating an owner sounds like a write.

It is not. Measured by reading the two scripts:

| What the a11y audit does | What it actually needs |
|---|---|
| `scripts/disposable-owner.ts create` — makes the account | **No database access at all.** It goes through the ordinary signup HTTP API (`POST /api/auth/signup`), exactly as a person would |
| `scripts/mint-owner-session.ts` — mints the session cookie | **One statement: `SELECT id, email FROM users WHERE email = $1`** |

So the entire database dependency of owner-mode a11y is a single SELECT on `users`. **`relay_ro`
covers it** — the identity that holds SELECT on every table, no DML, no DDL, and (per
`lib/ops/iam-wall.ts → READONLY_CONTRACT.forbidsServices`) **no `kms:*` action at all**, which is
the property that makes it placeable somewhere less trusted than Steve's laptop.

This matters for the ruling's scope: what was approved as a general "database credential" is, for
the item that needed it, a read-only one. **Nothing in this proposal asks for write.**

⚠️ **What that does NOT mean.** `relay_ro` still reaches production PII — emails, display names and
vault item *titles* are plaintext columns. It cannot decrypt (no KMS), so vault contents stay
ciphertext with no key, but "read-only" is not "harmless" and this proposal does not pretend
otherwise. The blast radius section below states it plainly.

---

## 2. What gets built, if approved

One change, mirroring `kms-wall.yml` exactly:

1. **`relay-ro-ci`** — an IAM role trusted by GitHub's OIDC provider, with the trust policy pinned
   to `repo:sgharlow/relay:ref:refs/heads/master` (the same pin `relay-kms-wall-ci` uses — a
   pull-request ref must never assume it, or a fork's PR could).
2. Its **only** permission: `dsql:DbConnect` on the primary cluster, as the `relay_ro` database
   role. Not `DbConnectAdmin`. Not KMS. Not S3.
3. A **fifth `CONTRACTS` entry** in `lib/ops/iam-wall.ts` for it, so `verify:iam` audits this role
   like the other four. **A principal absent from that list is audited by nothing** — that is the
   file's own rule and the reason this step is not optional.
4. `a11y.yml` gains the OIDC step and drops its `A11Y_SCOPE=public` limitation, so the 8 owner-mode
   screens are audited on every run instead of "when somebody runs it locally".
5. **Proof-of-red**, per B13's standard: dispatch the workflow with the role pointed at a database
   role that does not exist, and watch it fail. A checker that has only ever passed has not been
   seen to work.

---

## 3. What it unblocks, and what it does not

**Unblocks now:**

- **B28** — owner-mode a11y in CI, blocked since 2026-08-21. Today CI audits 27 signed-out pages
  and says so on every run; the 8 owner-mode screens — the ones a paying owner actually uses — are
  audited only when somebody remembers.
- **Scheduled `check:subscription`** (D19). It was wired as a command on 2026-09-01 with its
  occasions written down, and explicitly *not* called monitoring, because unattended scheduling
  needed exactly this.
- **`verify:roles` on a schedule** — it re-measures the database half of the least-privilege wall
  and currently runs when a person types it.

**Does not unblock, and must not be read as unblocking:**

- **The live walk chains (D4/D1).** Those create and delete real accounts on the customers'
  cluster. They need a separate test cluster, which is spend and a different decision. A read-only
  runner identity changes nothing about that.
- **Anything needing write.** No path in this proposal can INSERT, UPDATE or DELETE.

---

## 4. Cost and blast radius

- **Money: none.** OIDC assume-role is free; a public repo's Actions minutes are free and unlimited
  (measured 2026-09-02 while diagnosing B11 — the "minutes exhaustion" theory was never possible).
- **Stored secrets: none.** That is the point of OIDC and the reason the ruling was "yes, *via
  OIDC*" rather than "yes". A GitHub Actions secret holding a database credential would be a
  standing target with no expiry; a per-run assumed role is neither.
- **If the role were compromised:** SELECT on production, from `master` only. Real PII exposure —
  emails, names, item titles — and **no** ability to decrypt a vault, write a row, or alter a
  policy.
- **Rollback:** delete the role. The workflows fall back to the state they are in today (a11y
  public-scope only), which is a degradation rather than a breakage.

---

## 5. The honest risk this does not close

It puts one more scheduled job **inside GitHub Actions** — the same trap every alarm here shares,
and the one B12 exists to break. It is worse than that today: as of 2026-09-02 GitHub delivers
about 6% of the sub-hourly schedules it is asked for, and the a11y workflow is on the *daily* tier
which currently delivers 100%. So this lands in the reliable tier, and the off-GitHub heartbeat
(B12.i, built 2026-09-01) is what covers the case where GitHub stops delivering entirely.

---

## The one line to rule on

> **Create `relay-ro-ci` (OIDC, master-ref-pinned, `dsql:DbConnect` as `relay_ro` only), add its
> `CONTRACTS` entry, and turn on owner-mode a11y in CI — yes / no.**

**If yes**, this goes through `/safe-execute` as an infrastructure change: documented problem
(above), rollback in one command (delete the role), no snapshot needed because nothing is mutated,
and the proof-of-red in the same change.

**If no**, the honest alternative is not "run the a11y audit by hand" — that is the state being
reported, and it has been the state for eleven days. It is a dated cadence with an owner and a
freshness dead-man, the shape `verify-live-freshness.test.ts` already uses, so that *"nobody
audited owner mode"* is itself detectable. Say so and that gets built instead.
