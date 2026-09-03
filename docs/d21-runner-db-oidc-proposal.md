# Proposal: a database identity on a CI runner — `relay-ro-ci` (OIDC)

**Status: EXECUTED 2026-09-03 — repo side merged (PR #60, `1441eff`) and the infrastructure half applied under `/safe-execute`: role `arn:aws:iam::461293170793:role/relay-ro-ci` created (inline `dsql:DbConnect` on both clusters, nothing else), migration 040 applied in both regions, `npm run verify:iam` → "all 5 principals hold their contract", `npm run verify:roles` intact in both regions with two declared principals for `relay_ro`. Snapshots of both walls were taken before the change; rollback is `create-relay-ro-ci.mjs --delete` plus one `AWS IAM REVOKE` per region. ⛔ Steps 5–6 (the proof-of-red dispatch, then a normal one) and B28's closure wait for a dedicated audit-FIXTURE owner in `A11Y_OWNER_EMAIL` — `deferred.owner-mode-a11y-is-armed-by-configuration-not-required`.** ~~Status: BUILT (repo side) 2026-09-02 — infra pending `/safe-execute`.~~ Steve ruled **"yes, via
OIDC"** on 2026-09-01 (co-pilot sitting). The repository half is written, tested and committed; **no
IAM object exists and no AWS call has been made from this change.** §7 is what the controller runs
next. On the claim ladder this is `built` — not `wired`, because nothing has connected; the first
thing that moves it is a `verify:iam` run against the real role.

> ⚠️ **One measurement changed the scope of §2.4 and it is recorded here rather than left in a
> report.** Before the workflow was written, every owner-mode page render was traced for database
> WRITES and KMS calls: the layout's session check, `runPrioritize` on `/vault`, and the eleven GET
> endpoints the owner screens fetch on mount are all SELECT-only, and `/api/kms/unwrap` is reached
> only from the export button. The one write on that path is
> `escalateLapsedRequestsForOwners`, called from `/api/standby` — which `SidebarNav` fetches on every
> owner screen. It is unreachable for an owner who stands by for nobody (the resolver returns early),
> and its call site swallows failures so rung 0 still renders. So owner mode renders under
> `DSQL_ROLE=relay_ro`. **What does NOT survive the measurement: `disposable-owner.ts create` cannot
> run in CI.** It signs up over HTTP against the server under audit, and that server holds SELECT
> only — so CI audits an owner account that ALREADY EXISTS, named by `secrets.A11Y_OWNER_EMAIL`,
> and that account must be an audit fixture rather than a customer (axe prints element HTML, and on
> owner screens that HTML carries vault item titles).

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

---

## 7. What the controller runs next

Nothing below has been done. Each step is an infrastructure act on a working system, so it runs
under `/safe-execute` with the rollback stated: **delete the role**, and every workflow falls back
to the state it is in today (a11y public-scope, with a printed warning), which is a degradation
rather than a breakage.

**1. Create the role `relay-ro-ci`** in account `461293170793`, with this trust policy. The OIDC
provider already exists — it was created for `relay-kms-wall-ci` — so this adds a role, not a
provider.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::461293170793:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:sgharlow/relay:ref:refs/heads/master"
        }
      }
    }
  ]
}
```

**2. Attach its only permission** — one connect grant, on the primary cluster, naming its target.
`Resource: "*"` is a finding here (`READONLY_CI_CONTRACT.resourceScope`), and so is anything with
`kms:` in it.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DsqlConnectNonAdmin",
      "Effect": "Allow",
      "Action": ["dsql:DbConnect"],
      "Resource": ["arn:aws:dsql:us-east-1:461293170793:cluster/frt34buqso4inluojgnj6horuy"]
    }
  ]
}
```

**3. Apply the grant, in BOTH regions.** `migrate.ts` does not honour `DSQL_USE_SECONDARY`, so the
second run overrides the endpoint in the shell — shell env wins over `--env-file`:

```bash
npx tsx --env-file=.env.admin db/migrations/migrate.ts 040_relay_ro_ci_grant.sql
DSQL_PRIMARY_ENDPOINT=<secondary endpoint> npx tsx --env-file=.env.admin db/migrations/migrate.ts 040_relay_ro_ci_grant.sql
```

**4. Set the two workflow values.** Neither is a credential; both are secrets so they are masked in
a public repository's logs. `A11Y_OWNER_EMAIL` must name an audit fixture owner, never a customer —
see the note under the status line.

```
secrets.DSQL_PRIMARY_ENDPOINT   the primary cluster endpoint
secrets.A11Y_OWNER_EMAIL        an owner account that EXISTS and holds no real data
```

**5. Measure both walls, from the laptop, before trusting either.**

```bash
npm run verify:iam     # .env.admin — five principals now; relay-ro-ci must hold dsql:DbConnect,
                       # no kms: action at all, and a trust policy pinned to the master ref
npm run verify:roles   # .env.ro — relay_ro bound to BOTH declared principals in BOTH regions,
                       # and nothing else bound to it
```

**6. Prove the alarm fires, then prove the check passes — in that order.** Dispatch `a11y.yml` with
`dsql_role` set to something that does not exist (`relay_ro_nope`) and confirm the run goes RED with
`OWNER MODE WAS REQUIRED AND WAS NOT AUDITED`. Then dispatch it again with the default and confirm
the eight owner screens are audited at both viewports. A checker that has only ever passed has not
been seen to work — and until step 6 has been run, this document is `built`, not live-proven.

**7. Then, and only then, close B28** — and record which run closed it.
