# A place for the walks to run — does the 2026-08-20 ruling still hold?

**Drafted 2026-08-30 by Claude. Nothing here has been executed.**

> 🔴 **THIS BRIEF WAS COMMISSIONED AS "GET A DECISION FROM STEVE", AND THAT WAS
> WRONG — THE DECISION EXISTS.** `PROJECT.yaml → deferred.verify-live-cannot-enter-ci`
> carries a `ruled:` block dated **2026-08-20, by steve**: *"DEFER the test
> cluster until the first paying customer. Offered the priced alternative (an
> isolated single-region DSQL cluster, plausibly inside the free allowance,
> priced live before provisioning) and declined it for now."* It resumes when
> `g1-arms-length-demand` is met.
>
> The error was reading the entry's `blocked_on:` line — *"a separate test
> cluster. Infrastructure with a cost attached, Steve's call"* — and stopping
> there. That line is a true statement about the CAUSE and it sits forty lines
> above the ruling on it. `ROADMAP.md` §2-D repeats the same reading, and so did
> the plan this brief was written from.
>
> **So this is not a request for a ruling. It is the smaller and more useful
> thing: a record of what changed since that ruling, and whether any of it
> should reopen it.** The short answer is no — and one item moved in the
> direction that makes deferring easier to defend rather than harder.

> **Authority.** Every number in this brief either names the command that
> produces it or points at the one document allowed to hold it. AWS prices live
> in [`docs/unit-economics.md`](unit-economics.md), which opens by saying no part
> of it may be quoted anywhere else — so this file references it and does not
> copy it. Re-read it before ruling; vendor prices change without telling us.

---

## 1. The problem, stated as the register states it

`PROJECT.yaml → deferred.verify-live-cannot-enter-ci` (D4) has been open since
2026-08-18, owner `steve`, `blocked_on: a separate test cluster`.

Eight end-to-end walks across two chains — `verify:live` (five) and
`verify:journeys` (three) — drive the running application against the
**production** cluster, creating and deleting real accounts as they go. They are
deliberately out of CI, and the reasoning has not changed:

> "A job doing that on every pull request would be writing to customers' data to
> check a diff — and the rows it forgot would be the ones nobody was watching."

That is not hypothetical. Abandoned accounts have been left on production at
least twice, and **every run that made them reported success**.

So the release gate has two halves. One is `npm run gate` — types, lint, tests,
build — which CI runs on every push. The other is these eight walks, and it is
**one command a person has to remember**. The half that catches the class of
regression a unit suite cannot see is the half nothing schedules.

### What is already true, and changes the size of this decision

Two things landed on 2026-08-30 that were previously part of this problem:

1. **The freshness dead-mans exist.** Both chains stamp a JSONL log on success,
   and `lib/ops/verify-live-freshness.test.ts` / `verify-journeys-freshness.test.ts`
   turn the suite red when a stamp ages out. They report that the walks have
   stopped. They do not run them.
2. **The abandoned-row half is now watched, and it needed no cluster.**
   `/api/health/orphans` + `.github/workflows/orphan-monitor.yml` count
   reserved-domain accounts older than a day and dangling rows, daily, with no
   credential. This is the finding D4 itself called *"a smaller and more useful
   thing than the cluster"* — and it is done.

**A cluster would make the walks SAFE. It would not have made an abandoned row
VISIBLE, and that half is closed.** The remaining question is narrower than the
register entry makes it sound.

---

## 2. What a test cluster would actually cost

### Money

The shape, not the figures — derive those from `docs/unit-economics.md`:

- **Aurora DSQL idles to zero.** There is no per-hour charge for a cluster nobody
  is querying. The walks are a few hundred statements a day at most, and the
  free tier is sized in hundreds of thousands of DPU. On the compute side this is
  close to a rounding error, and materially smaller than the phrase
  "infrastructure with a cost attached" implies.
- **The real recurring line is a KMS key.** Per-key, per-month, prorated hourly.
  This is the one genuinely fixed cost.
- **Storage** is charged per GB-month against a free allowance the walks cannot
  plausibly exhaust.

> ⚠️ **A separate CMK is the point, not an optimisation.** Pointing a test
> environment at the production key would give a lower-trust environment
> `Decrypt` on the key that opens every real vault. If the cost of a second key
> is what decides this, the answer is not to share the first one — it is to
> decline the cluster and record why.

**Steve should confirm the current prices before ruling.** Console →
Billing → Free tier is the fastest read; `docs/unit-economics.md` records what
was verified and when.

### Effort, which is the larger cost

- **`scripts/provision-dsql.sh` exists** and provisions a linked multi-region
  pair. It was written for the production pair and hard-codes the two-region
  active-active shape. **A test environment does not need two regions** — the
  failover property is a production guarantee, not something the walks assert —
  so this either runs as-is and provisions more than is needed, or gets a
  single-region path added.
- **38 migrations, applied by hand, in order.** `db/migrations/migrate.ts` says
  it plainly: *"Migrations are NOT tracked in a table; pass the file you intend
  to apply."* Standing up a schema means 38 invocations, and keeping it current
  means remembering every future one. `npm run verify:schema` compares a cluster
  against what the migrations declare and would be the check that catches drift —
  but it is, again, a command somebody runs.
- **Three IAM identities and their DB roles** (`relay_app`, `relay_dev`,
  `relay_ro`) exist as migrations plus policies. A second cluster needs its own,
  or it needs the walks pointed at a role that does not exist there yet.
- **A `.env.test`**, and a decision about which existing files change. Today
  `.env.local` points at production *because there is no alternative*; that
  sentence appears in `CLAUDE.md`, `.env.ro`, and the D4 entry. Adding a fourth
  env file means those three statements need updating in the same change.

### What it does NOT fix

- **The signup rate limit.** `/api/auth/signup` allows 10 per hour per client
  key, one full `verify:live` chain performs exactly 10, and the limiter is
  per-instance memory. A different database does not change that; restarting the
  dev server does.
- **`verify:kms` and `verify:iam`.** They read the AWS API, not the database.
- **The dogfood.** `verify:dogfood` asks whether the *real* owner's vault can
  host a cohort. That question is only meaningful against production.

---

## 3. Why this is a decision and not a task

Under the portfolio **Infrastructure Change Policy**, the five-gate procedure
governs *changes to a working system*. This is not one: it is a **new
environment standing beside** a working one, and nothing about production
changes. That distinction is what makes this a spend-and-effort decision rather
than a snapshot-and-rollback exercise.

Two caveats keep it honest:

- **The `.env` split is a change to a working system.** Repointing `.env.local`,
  or adding a file the walks pick up by default, touches the identity model that
  `CLAUDE.md` calls "the security model". Any such change should land on its own,
  after the cluster exists and is proven.
- **Rollback is genuinely cheap**, which is unusual here and worth stating:
  delete the cluster, delete the key, delete the env file. Nothing in production
  refers to any of it. `provision-dsql.sh` leaves deletion protection off during
  provisioning for exactly this reason.

---

## 4. Does anything here reopen the ruling?

The 2026-08-20 ruling defers the cluster until the first paying customer, and
names what stands in for it in the meantime: `verify:orphans` (the counting
half), the 14-day freshness dead-man on `verify:live` (the remembering half),
and a person running the chain from the main checkout.

Measured against that, one thing has changed and it points the same way.

| Since the ruling | Effect on it |
|---|---|
| `verify:orphans` was **still not scheduled** on 2026-08-30 — it was a command a person had to remember, and it was reporting a FAIL nobody had seen | The ruling's first named stand-in was weaker than the ruling assumed |
| That is now fixed with **no infrastructure**: `/api/health/orphans` + a daily monitor, no credential, no cluster | The stand-in is now real rather than nominal, which makes the deferral *more* defensible, not less |
| Both chains now carry freshness dead-mans (`verify:journeys` gained one 2026-08-29) | The second stand-in is now symmetric across both chains |
| Nothing has changed about the CAUSE: the walks still write to production | The condition the ruling turns on is untouched |

**Recommendation: the ruling stands, unchanged, and needs no fresh decision.**

Two things are worth Steve's attention anyway, neither of which is a request to
re-rule:

1. **`blocked_on:` and `ruled:` say different things in the same entry, and the
   first is what everyone reads.** That is how this brief came to be
   commissioned, how `ROADMAP.md` §2-D describes D4, and how the readiness plan
   described it. The entry is not wrong — a cause can be recorded alongside a
   decision to live with it — but the ordering costs a re-read every time.
   Worth a one-line pointer at the top of the entry; Claude has added one.
2. **The counter-argument to deferring is real and should not be softened.** The
   walks are the only thing that catches a broken real write path. `npm run gate`
   was green throughout the last time one broke, and only a deliberate manual
   re-run caught it. The deferral trades that risk for effort and a monthly key,
   knowingly. If Steve ever wants that trade revisited before
   `g1-arms-length-demand`, the options are below and the effort estimate above
   is honest.

### If it is ever reopened, these are the shapes

| | What it is | Cost | What it closes |
|---|---|---|---|
| **A** | **Scratch cluster, single region.** Provision, migrate, own IAM + CMK, `.env.test`, then move both chains onto a schedule. | One key per month + the effort in §2 | D4 in full: the walks become a gate nobody has to remember |
| **B** | **Ephemeral per-run cluster.** Create, migrate, walk, destroy, inside the workflow. | Near-zero standing cost; much higher complexity and run time (38 migrations per run) | The same, more expensively in engineering terms |
| **C** | **Status quo.** The two freshness dead-mans say when the walks have stopped; the orphan monitor now says when one left something behind. | Nothing | The two loudest symptoms, which is what is covered today |

`provision-dsql.sh` provisions the two-region production shape; **A** would want
a single-region path added first, since failover is a production guarantee the
walks do not assert.

---

## 5. What Claude has done with this

- Left the ruling alone. It is Steve's, it is dated, and it carries a condition.
- Added a pointer at the top of the register entry so the next reader meets
  `ruled:` before `blocked_on:`.
- Closed the gap the ruling had assumed was already closed — the counting half is
  now scheduled, and it needed none of what the ruling deferred.

> ⚠️ **No fourth deferral is being recorded here, because no new deferral is
> being made.** The existing ruling already carries `resumes_when:` — a
> condition, not a date — which is what the register's own rule asks for.
