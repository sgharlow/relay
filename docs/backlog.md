# Backlog — the execution queue for `/sprint`

> **Written 2026-08-19.** This is the **sequencing view** of the Claude-court work already
> inventoried in `ROADMAP.md` §2. It exists because `~/.claude/commands/sprint.md` resolves a
> backlog source in a fixed order and `docs/backlog.md` is the first file it looks for — without
> one, every sprint marks itself `BACKLOG INFERRED` and escalates asking for a real source.
>
> **It is not a third register.** `PROJECT.yaml` stays authoritative for gates, dates and debt;
> `ROADMAP.md` stays authoritative for the remaining-work inventory and the sprint *thesis*. This
> file holds only *what to run next, in what order, and what "done" looks like*. An item is struck
> here when it closes there — and item **S1-2** below is the change that gives these findings a home
> in `PROJECT.yaml`, after which this file is a queue and not the only record.
>
> **Division of labour, 2026-08-19:** Steve runs the demand lane (ROADMAP Sprint 1 — op-ed, cohort,
> G3 ruling, deliverability). These sprints are ROADMAP Sprint 2 and the front half of Sprint 3,
> broken into runs of five. The two lanes contend for nothing.

---

## How to run these

```
/sprint docs/backlog.md sprint-1        # then sprint-2, sprint-3, sprint-4
```

Each numbered sprint below is sized to the skill's **hard cap of 5 iterations** — five items, one
commit each, on `sprint/<UTC-date>-<n>`. Run them **in order**: later sprints depend on earlier ones
and say so.

### Two constraints that shape every acceptance criterion here

1. **The worktree has no credentials.** `.env.local` and `.env.admin` are gitignored and therefore
   absent, by design. Nothing here may define "done" as a live run against DSQL, KMS, IAM, Stripe or
   Resend. Where an item produces a tool that must eventually touch the real thing, its criterion is
   the **pure logic plus the wiring**, tested — and the live run is named as a post-merge step for
   the main checkout. `lib/ops/iam-wall.ts` + `scripts/verify-iam.ts` is the precedent to copy: the
   predicate is unit-tested, the script is a thin shell over it.
2. **A migration is a sysadmin act.** `db/migrations/migrate.ts` needs `.env.admin` and Steve. Any
   item that wants a column **authors the migration and does not apply it**, and its code must
   behave correctly against a cluster where the migration has *not* landed yet. ⚠️ Migration 029 is
   the recorded incident: code that required a table before it existed took passkey sign-in down for
   four minutes. Deploy order is migration first, code second — never the reverse.

---

# Sprint 1 — The front door, the key, and the record

**Theme:** the four things a custodian of other people's credentials must be able to say are true
before the beta cohort creates accounts that are not Steve's. Security first, per the standing
instruction.

**Depends on:** nothing. Run this first.

---

### S1-1 · Sign-in has an attempt budget and a witness

- **Axis:** security · **Effort:** S · **Blast:** all users · **Priority:** jumps the queue —
  exploitable defect on a reachable path

**The defect.** Owner sign-in is `email` + a six-digit TOTP code and nothing else — there is no
password (`src/app/auth/signin/SignInForm.tsx` says so in its own comment). The `email-totp`
provider's `authorize` in `lib/auth/auth-options.ts` performs a database lookup and a code
comparison per attempt, with **no per-account failure counter and no call into
`lib/http/rate-limit`**. A takeover yields decrypted vault items: `/api/kms/unwrap` requires only an
owner session, and `lib/ops/step-up-guard.ts` correctly elevates bulk export, recovery codes and
account deletion but not item-by-item reveal.

**Why this is an oversight and not a decision** — the argument that makes it worth a queue jump:
`lib/auth/recipient-code.ts`, `lib/auth/verifier-code.ts` and `lib/auth/recovery-code.ts` each carry
`MAX_FAILED_ATTEMPTS`; `/api/account/step-up` calls `rateLimit`; the `break-glass` provider carries a
written argument for why ~59 bits of entropy needs neither. The six-digit code is the **shortest
secret in the product** and the only one with no argument attached.

**And nothing is watching.** `lib/ops/guess-watch.ts` exists precisely because "a guess at a code
that does not exist left no trace at all". Its `GuessKind` union is
`recipient | verifier | invitation | recovery`. TOTP is absent, so a walk through the sign-in
keyspace is both unlimited and unobserved.

**Acceptance criteria**

- [ ] `authorize` on the `email-totp` provider calls `rateLimit`, keyed primarily on the **normalised
      email** — the target is fixed and an attacker's IP is not, so an IP-only key is the wrong
      control here. A second per-IP key is welcome, not sufficient.
- [ ] A refused attempt returns the **same `null`** as every other failure. The provider's existing
      comment is explicit that an unknown address, a wrong code and an undecodable secret must be
      indistinguishable from outside; a limiter that answers differently leaks account existence and
      would be a new defect, not a fix.
- [ ] `GuessKind` gains `totp`, and a failed code records a miss through `recordCodeMiss`. The
      limiter and the alarm ship **in one change** — a limiter without an alarm hides the attack it
      deflects.
- [ ] The budget is chosen against a real person mistyping on a bad connection, and the number
      carries its reasoning in a comment, in this repo's usual shape.
- [ ] Red-green proven: a test that fails before the change and passes after, for **both** the
      refusal and the recorded miss.
- [ ] The limitation is written down where the next reader meets it: `lib/http/rate-limit.ts` says in
      its own header that it is per-instance memory and "not a security boundary". That is still
      true here. This item raises the floor from *nothing* to *the same control step-up already
      has*; the durable per-account budget is **S2-1** and this item's comment must point at it.

**Files:** `lib/auth/auth-options.ts`, `lib/ops/guess-watch.ts` (+ tests)

**Cannot be proven in the worktree:** nothing. This one is fully provable offline.

**Post-merge, from the main checkout:** `npm run verify:live` — the step-up walk signs in for real
and is the walk that would notice a limiter that refuses a legitimate person.

---

### S1-2 · The findings get a home in `PROJECT.yaml`

- **Axis:** correctness (of the record) · **Effort:** S · **Blast:** all future sessions
- **Why early:** it unblocks the most other items — every sprint below is discoverable from
  `PROJECT.yaml` afterwards and from nowhere else before.

**The defect.** The nine findings from the 2026-08-19 deep pass live in `ROADMAP.md` §2-B and §2-E
and nowhere else. `ROADMAP.md` is **subsidiary** to `PROJECT.yaml`, whose `deferred:` block is the
repo's debt register and the thing the next session reads. That register's own header says what an
unwritten item becomes. `ROADMAP.md` §7 already records this as a known weakness of that revision —
this item is the fix it names.

**Acceptance criteria**

- [ ] Each of B1–B9, E1, E2, C6, C7, D6, D7 enters `PROJECT.yaml → deferred:` as an entry in the
      existing shape: `id`, `owner`, `opened`, `what`, `why_it_matters`, `ends_when`. `ends_when`
      is a **condition, not a date**, where the existing entries use one (D2's `resumes_when` is the
      model: *"a number, not a date"*).
- [ ] Items closed by Sprint 1 in the same run are entered **and closed in the same commit**, with
      the closure recording what shipped — the shape every closed entry in that file already uses.
- [ ] `ROADMAP.md` §2 entries gain a pointer to the `deferred:` id, and §7's warning paragraph is
      struck, because it will no longer be true.
- [ ] `npx tsx` parses the YAML — a malformed `deferred:` block is silent until something reads it.
- [ ] No volatile number is copied into either file in the process.

**Files:** `PROJECT.yaml`, `ROADMAP.md`

---

### S1-3 · `verify:kms` — the third wall

- **Axis:** security · **Effort:** M · **Blast:** all users (catastrophic, irreversible)

**The gap.** Ciphertext without the CMK is unrecoverable. A deleted key, a scheduled deletion, or a
key policy edited to drop the runtime principal destroys every vault permanently — and none of it
appears in a diff, a test run or a build. This is exactly the class `verify:roles` and `verify:iam`
were built for, one layer down: **two walls have re-measuring probes and the one underneath them has
none.** `docs/backup-restore-runbook.md` covers the database; a restored cluster is ciphertext
without the key that opens it.

**Acceptance criteria**

- [ ] `lib/ops/kms-wall.ts` holds the **pure verdict function** over an AWS response shape — no SDK
      call, no environment, no I/O. Mirrors `lib/ops/iam-wall.ts` exactly, including that every
      refusal names *which* rule refused.
- [ ] It refuses on each of: key absent · `KeyState` not `Enabled` · a pending deletion · rotation
      state not what the repo intends (decide and record the intent — a symmetric CMK's rotation is
      backwards-compatible, so "on" is defensible; what is not defensible is nobody knowing) · the
      key policy no longer granting the runtime principal · **and the positive half** — a policy
      that grants nobody must also fail, because a check that is happiest when the product is broken
      is measuring the wrong thing (`verify-iam`'s own words).
- [ ] `scripts/verify-kms.ts` is a thin shell: `DescribeKey`, `GetKeyPolicy`, `GetKeyRotationStatus`,
      read-only, no mutation, exits non-zero on any refusal. It runs under `--env-file=.env.admin`,
      like `verify:iam`, because the application's own identity deliberately cannot read this.
- [ ] `package.json` gains `verify:kms`, and `lib/ops/gate-script.test.ts` covers it — that guard
      exists because two scripts shipped invoking a bare `tsx` and could not start.
- [ ] Every rule is red-green proven against a **planted** response fixture.
- [ ] `CLAUDE.md` gains `verify:kms` in the commands block and in the pre-release list beside
      `verify:roles` / `verify:iam`, in the same voice.

**Files:** `lib/ops/kms-wall.ts` (+ test), `scripts/verify-kms.ts`, `package.json`, `CLAUDE.md`

**Cannot be proven in the worktree:** the live run. The predicate is fully testable offline; the
script's AWS wiring is not.

**Post-merge, from the main checkout:** `npm run verify:kms` against the real key, and — the part
that matters — a **negative control**, the way `verify:iam` uses policy v1: point it at something
that should fail and watch it fail. A wall-checker that has only ever been seen to pass has not been
seen to work.

---

### S1-4 · The failover does not carry the ability to decrypt, and nothing says so

- **Axis:** documentation (of a correctness property) · **Effort:** S · **Blast:** all users

**The finding.** `lib/kms/kms-client.ts` builds one `KMSClient` from `AWS_REGION` (default
`us-east-1`) against one CMK. `lib/db/connection.ts` keeps primary and secondary pools, and
`DSQL_USE_SECONDARY=true` fails the **database** over to us-west-2. The crypto path does not move
with it. A us-east-1 KMS impairment therefore makes every vault unreadable **from both regions** —
and `CLAUDE.md`'s "Multi-region failover is an env switch, not infra" invariant currently reads as
though the switch is sufficient.

**This item writes the limitation down. It does not fix it.** A multi-Region CMK is an
infrastructure change to a working system: it needs the 5-gate policy, a snapshot, a rollback and
Steve's explicit request. Proposing is in scope; taking it is not.

**Acceptance criteria**

- [ ] `CLAUDE.md`'s failover invariant states the boundary: the env switch moves the data path and
      not the key, and what that means on the day somebody flips it.
- [ ] `docs/backup-restore-runbook.md` says the same where a person mid-restore will meet it — a
      restored cluster in the other region is ciphertext until KMS in the key's region answers.
- [ ] A short proposal (its own section in the runbook, or a doc) sets out the multi-Region-key
      option, its cost, its migration shape and its rollback, addressed to Steve as a **decision**,
      explicitly not taken.
- [ ] No code changes. If this item finds itself editing `lib/kms/`, it has become S4 and should
      stop.

**Files:** `CLAUDE.md`, `docs/backup-restore-runbook.md`

---

### S1-5 · The incident and breach runbook

- **Axis:** documentation · **Effort:** S · **Blast:** all users

**The gap.** `docs/` holds a backup/restore runbook, an email-DNS runbook and a submission runbook.
For a product holding other people's credentials there is no written answer to: what is done first,
what is preserved, who is told, and by when. Cheap now; unwritable at 3am.

**Acceptance criteria**

- [ ] One page, `docs/incident-response-runbook.md`, covering: **containment order** (session-epoch
      revocation first — `migration 025` already exists for exactly this; then secret rotation, which
      points at S2-4; then the KMS key policy, which points at S1-3), **evidence preservation** (the
      audit chain is append-only and hash-chained per owner — say explicitly that it must not be
      touched, and how to verify the chain), **notification** (who decides, who writes it, what a
      custodian owes a customer, and the fact that state breach-notification law applies to an
      individual operator exactly as it does to a company), and **the roll-back-nothing rule** for
      the audit log.
- [ ] It names the operator by the ratified answer (`ratified.relay-operator-is-an-individual`) —
      the person who makes each call is a real person, not a role that does not exist.
- [ ] It states what Relay **cannot** disclose because it cannot read it, which is the one genuinely
      good piece of news in a breach and belongs in the notice template.
- [ ] Linked from `CLAUDE.md` where the other runbooks are named.

**Files:** `docs/incident-response-runbook.md`, `CLAUDE.md`

---

# Sprint 2 — Durability, independence, and the two runbooks

**Theme:** the second stage of the security work — the parts that need persistence, a second
channel, or a written procedure.

**Depends on:** Sprint 1 (S2-1 extends S1-1; S2-3 is pointed at by S1-5).

---

### S2-1 · A durable per-account sign-in budget

- **Axis:** security · **Effort:** M · **Blast:** all users · **Depends on:** S1-1

**Why this is a second stage.** S1-1 raises the floor to the control `/api/account/step-up` already
has — and `lib/http/rate-limit.ts` says in its own header that per-instance memory is not a security
boundary. A distributed attempt against one email is under-counted by construction. Closing that
needs a row.

**⚠️ The deploy-order trap this item must not repeat.** Migration 029 shipped code that required
`auth_challenges` before the table existed, and passkey sign-in threw for four minutes. **The
migration is authored here and applied by Steve.** Until it lands, the code must fall back to the
in-memory limiter from S1-1 and sign-in must keep working — a security control that takes the front
door down is a worse outcome than the gap it closes.

**Acceptance criteria**

- [ ] `db/migrations/036_signin_attempts.sql` authored, in the style of the existing files, **not
      applied** — and the item's report says in one line that it is Steve's to run, against **both
      regions**, followed by `npm run verify:schema`.
- [ ] The budget is per-account, decays on a clock, and **resets on a successful sign-in**.
- [ ] Absence of the table is tolerated: the code detects it (`42P01`) once, falls back to the
      in-memory limiter, and logs that it did — it must never throw on the sign-in path, and it must
      never fail closed and lock everybody out.
- [ ] A lockout is **not** distinguishable from a wrong code to the caller. Same `null`, same
      response — S1-1's criterion, restated because this is where it would be easiest to break.
- [ ] There is a way back for the person who is genuinely locked out, and it is named in the code:
      the existing recovery-code path, which has its own budget and its own entropy argument.
- [ ] Red-green proven, including the table-absent branch, which is the one that would take the
      product down.

**Files:** `db/migrations/036_signin_attempts.sql`, `lib/auth/` (new module + wiring),
`lib/auth/auth-options.ts` (+ tests)

**Cannot be proven in the worktree:** anything touching the cluster. The table-absent branch is
testable against a mocked `pg` boundary and must be.

---

### S2-2 · The in-app alarm stops sharing fate with product email

- **Axis:** security / correctness · **Effort:** M · **Blast:** all users

**The finding.** `lib/ops/error-reporter.ts` and `lib/ops/incident.ts` alert through
`sendEmailBestEffort` — Resend, the same provider whose Outlook deliverability is an open ticket and
whose DMARC posture is still `p=none`. If Resend is degraded, or the alert lands in a junk folder,
500s stop being reported and the silence reads as health. The GitHub-hosted monitors do **not** share
this fate — they alert through GitHub — so the exposure is specific to the in-app half.

**The repo's own precedent decides the shape**: `scheduler-monitor.yml` and
`delivery-webhook-monitor.yml` both exist because "a watchdog must be able to outlive the thing it
watches". An in-app alerter that can only speak through the product's own mail provider is the same
mistake one layer up.

**Acceptance criteria**

- [ ] Either (a) in-app alerts become **readable by the independent monitor** — persisted, exposed on
      a health-shaped endpoint, polled by a GitHub Actions workflow that alerts through GitHub, in
      the shape the two existing monitors already use — or (b) a recorded ruling that the GitHub
      monitors are the alarm of record and the in-app mail is advisory, stated in
      `error-reporter.ts` itself so the next reader is not misled by it.
- [ ] If (a): the endpoint must not become a new unauthenticated leak. Counts and timestamps, never
      error text, never a stack, never an email address — `lib/ops/incident.ts` already reasons about
      exactly this and its constraint carries over.
- [ ] If (a): **the absence case is what is monitored**, not just the presence one. A reporter that
      has stopped reporting must be distinguishable from a product with no errors — that distinction
      is what `verify-live-freshness.ts` exists to make and the same rule applies here.
- [ ] Whichever branch is taken, it is recorded in `PROJECT.yaml → deferred` against the B6 entry
      that S1-2 created.

**Files:** `lib/ops/error-reporter.ts`, `lib/ops/incident.ts`, possibly `src/app/api/health/*`,
`.github/workflows/` (+ tests)

**Cannot be proven in the worktree:** the workflow firing. Assert the endpoint and the predicate
offline; the schedule is proven by the first real run.

---

### S2-3 · The secret rotation runbook

- **Axis:** documentation / security · **Effort:** M · **Blast:** all users

**The gap.** `NEXTAUTH_SECRET`, `RECIPIENT_JWT_SECRET`, `VERIFIER_JWT_SECRET`, `CRON_SECRET`,
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, the Stripe keys and a long-lived AWS access key pair all
sit in Vercel with no recorded age, no procedure and no owner. Nothing in `docs/` rotates anything.
This is the operational half of the arc `docs/least-privilege-cutover.md` closed on identity.

**Acceptance criteria**

- [ ] `docs/secret-rotation-runbook.md`, one section per secret: **what it protects · blast radius on
      rotation · the safe order · what breaks mid-flight · how to verify afterwards.**
- [ ] The two that are not merely inconvenient are called out in their own words:
      **`RECIPIENT_JWT_SECRET` / `VERIFIER_JWT_SECRET`** — rotating either invalidates every live
      link, which during an open release means a verifier clicking a valid link gets an error at the
      moment a family is waiting. The procedure must say when it is safe (no open release) and what
      to do when it is not (rotate anyway and re-issue; the release state is the source of truth, the
      link is not).
- [ ] **`NEXTAUTH_SECRET`** signs live sessions: rotation signs everybody out. That is a *feature*
      during an incident (S1-5's containment step) and an outage on an ordinary Tuesday. Say which.
- [ ] A recorded **last-set date** per secret, with the honest answer where it is unknown — "unknown"
      is a finding, not a blank.
- [ ] Cross-linked from `docs/incident-response-runbook.md`, which points at this for the rotation
      step, and from `.env.example` where each variable is described.

**Files:** `docs/secret-rotation-runbook.md`, `docs/incident-response-runbook.md`, `.env.example`

---

### S2-4 · Relay's own continuity, stated

- **Axis:** completeness (a promise the product implies and never makes) · **Effort:** S ·
  **Blast:** all users

**The finding.** The product's entire subject is what happens when the person holding everything
cannot act. Relay is operated by one individual (`ratified.relay-operator-is-an-individual`) and says
nothing about what becomes of a customer's vault if *that* individual is the one who stops. The
mechanism already exists — self-serve export at `/api/account/export`, and the encryption means the
operator was never able to read anything — so this is **a statement to write, not a system to
build**, and it is the most on-brand piece of trust copy available.

**Acceptance criteria**

- [ ] `/about` (and `/terms` where it is contractual) answers three questions plainly: what happens
      to a vault if the operator stops · what a customer can do about it today, in one click,
      unprompted · and why the operator's absence does not put the *contents* at risk, which is the
      one thing this architecture genuinely guarantees.
- [ ] It does **not** promise an escrow, a successor or a wind-down period that does not exist. The
      Terms already describe the mechanism actually operated (the g2 decision's shape); this holds
      the same line.
- [ ] Pinned by a test in the shape of `lib/ops/operator-named.test.ts`, so the sentence cannot
      quietly disappear in a copy edit.
- [ ] Accessibility unaffected: any new page section keeps the type scale and passes the existing
      structural checks.

**Files:** `src/app/about/page.tsx`, `src/app/terms/page.tsx`, `lib/ops/` (+ test)

---

### S2-5 · Stripe joins the subprocessor list

- **Axis:** correctness (of a legal page) · **Effort:** S · **Blast:** all paying users

**The defect.** `src/app/privacy/page.tsx` lists AWS, Vercel, OpenAI and Resend under "Who else is
involved" and omits **Stripe**, which processes the payment details of every paying customer.
Live-mode Stripe has been charging since 2026-08-08. This is the same class as the `og:description`
that still sold estate after estate was withdrawn: a factual defect on a page whose entire value is
that it is accurate.

**Acceptance criteria**

- [ ] Stripe is named, with what it receives and where — in the same voice as the other four.
- [ ] Pinned by a test that ties the rendered list to the set of providers the codebase actually
      talks to, so the **next** provider added is caught by a failure rather than by a reader. A
      hardcoded four-item assertion would pass the day a fifth arrives and is not worth writing.
- [ ] While in this file: check the rest of it against what the code now does, and report anything
      else found rather than fixing it silently.

**Files:** `src/app/privacy/page.tsx`, `lib/ops/` (+ test)

---

# Sprint 3 — Billing lifecycle, before the paywall decision

**Theme:** everything that must be true before `ratified.beta-free-release` comes up for its
**2026-10-01** revisit, so the flip is a decision rather than a hazard.

**Depends on:** Sprint 1 (S1-2 created the E1/E2 entries). Independent of Sprint 2.

**Why it is dated.** `TIER_LIMITS.free.canRelease` is one line from `false`. The moment it flips, an
expired card is a **blocked release** — the one thing the product exists to do, stopped by a billing
event nobody was told about.

---

### S3-1 · A failed renewal tells the owner

- **Axis:** correctness · **Effort:** M · **Blast:** all paying users

**The finding, stated precisely** — because the first draft of this analysis got it wrong and the
correction matters: `ACTIVE_STATUSES` in `src/app/api/stripe/webhook/route.ts` **includes
`past_due`**, so a card that fails on renewal does *not* revoke access during Stripe's retry window.
That is correct and deliberate. What is missing is everything around it: `invoice.payment_failed` is
not a handled event, and when a subscription finally lapses the handler writes an audit entry and
sends **no mail**.

**Acceptance criteria**

- [ ] `invoice.payment_failed` handled: the owner is told, once per invoice, in the product's own
      voice — what happened, what it means for their plan, and the one link that fixes it (the
      billing portal already exists at `src/app/api/stripe/portal`).
- [ ] Idempotent against Stripe's retries and redeliveries. The existing handler is
      order-independent by design (`currentSubscriptionStatus` re-reads rather than trusting the
      event); this must not regress that.
- [ ] The final lapse (`customer.subscription.deleted`, or a status leaving `ACTIVE_STATUSES`) also
      notifies, and says what S3-2 decides about the data.
- [ ] Nothing is sent to a reserved domain — `lib/notify/email.ts` refuses at the seam and the tests
      must not route around it.
- [ ] Red-green proven against the existing webhook test harness, including the
      already-notified-once case.

**Files:** `src/app/api/stripe/webhook/route.ts`, `lib/notify/`, `lib/billing/` (+ tests)

---

### S3-2 · What happens to a vault when someone stops paying

- **Axis:** completeness · **Effort:** M · **Blast:** all paying users

**The finding.** A lapsed owner drops to the free tier holding a vault that may exceed the free item
cap. `assertCanAddItems` gates *adding* only, so existing items are untouched — which is the humane
behaviour, and it is an **emergent property of where the check sits, not a decision anybody made or
wrote down**. A custodian must be able to answer "what happens to my data if I stop paying" in one
sentence, and the Terms cannot answer it because nothing has decided it.

**Acceptance criteria**

- [ ] The behaviour is **established by reading the code**, enumerated path by path — items, access
      rules, recipients, verifiers, release states, and the release path itself — and written down.
      Where the answer is "nothing happens", that is the finding and it is stated.
- [ ] A test pins each answer, so the humane behaviour stops being an accident. This is the point of
      the item: today, a refactor of `assertCanAddItems` could silently start deleting people's
      history and no test would notice.
- [ ] `/terms` gains the one sentence, matching the mechanism actually operated.
- [ ] Any place where the current behaviour is **not** defensible is reported, not silently changed.
      A change to what a lapse does to customer data is Steve's decision.
- [ ] ⚠️ In scope to *describe*, out of scope to *flip*: `canRelease` stays as it is. That is
      `ratified.beta-free-release`, dated 2026-10-01, and it is Steve's.

**Files:** `lib/billing/entitlements.ts`, `src/app/terms/page.tsx`, `lib/ops/` (+ tests)

---

### S3-3 · The paywall flip, assembled but not thrown

- **Axis:** completeness · **Effort:** S · **Blast:** all users · **Depends on:** S3-1, S3-2

**Why.** `ROADMAP.md` §2-F-j: the flip is three artifacts that must move together —
`TIER_LIMITS.free.canRelease`, the skipped entitlements test
(`lib/billing/entitlements.test.ts`, the one deliberate skip in the suite), and user-guide §2.7.
Assembling them ahead of the decision turns a dated ruling into a one-commit review instead of an
afternoon's archaeology under time pressure.

**Acceptance criteria**

- [ ] A single written change-set description naming every file the flip touches, verified by
      grepping for each rather than by memory.
- [ ] The skipped test is **read and confirmed still correct** for the behaviour that would be
      enabled — a test skipped since before the beta may assert something the product has since
      changed, and un-skipping a stale assertion on flip day is the worst possible moment to find
      out.
- [ ] The preconditions are stated as a checklist: S3-1 shipped, S3-2's sentence live. Without them
      the flip converts an expired card into a blocked release.
- [ ] **Nothing is flipped.** `lib/ops/gates.test.ts` guards the ordering; this item must leave it
      green.

**Files:** documentation only (plus any test-readability fix that does not change behaviour)

---

### S3-4 · Unit economics, one page

- **Axis:** documentation · **Effort:** S · **Blast:** the demand lane

**The gap.** Nothing anywhere derives the per-owner cost of DSQL, KMS requests, Vercel functions,
OpenAI intake and Resend against the **$119/yr** price (`PROJECT.yaml → monetization_path`). At
today's scale it does not matter; it is the arithmetic that tells the demand lane whether it is
selling something with a margin — and Steve is out selling it this week.

**Acceptance criteria**

- [ ] Cost per owner per year, itemised, with every assumption named and sourced from published
      pricing (vault size, KMS calls per reveal, intake tokens, emails per owner per year, function
      invocations). Where a driver is unknown, the assumption is stated as an assumption.
- [ ] Three scenarios — a dormant owner, a typical owner, an owner in an active release — because
      the third is the expensive one and it is the one the product is for.
- [ ] The break-even owner count for the fixed costs, and the gross margin at the current price.
- [ ] ⚠️ No number from this page is copied anywhere else. It is a derivation, and it goes stale the
      moment AWS changes a price — it says so at the top and names the date it was derived.

**Files:** `docs/unit-economics.md`

---

### S3-5 · Re-derive the rate limiter's stance

- **Axis:** security · **Effort:** S · **Blast:** all users

**The finding.** `lib/http/rate-limit.ts` is per-instance memory and says so. Its stated argument for
staying that way is that a shared store is not worth adding "for a $250 ad test" — **and that flight
was cancelled** (`ratified.g1-google-lane-cancelled`). The reasoning now rests on a premise that no
longer exists, while the endpoints it guards include ones that cost money (`/api/ai/intake` reaches
OpenAI; `/api/stripe/checkout` reaches Stripe) and one that is now an authentication control (S1-1).

**Acceptance criteria**

- [ ] A written re-derivation against the world that exists: real users, free standby accounts, an
      authentication path now depending on it, and paid third-party calls behind public endpoints.
- [ ] The header comment in `lib/http/rate-limit.ts` is corrected — leaving a justification that
      cites a cancelled ad flight is the drift this repo keeps catching.
- [ ] A recommendation with a cost, addressed to Steve as a decision. ⚠️ **A shared store is
      infrastructure**: proposing is in scope, adding it is not, and it needs the 5-gate policy.
- [ ] Recorded against the D6 entry S1-2 created.

**Files:** `lib/http/rate-limit.ts`, `docs/` (+ test only if a claim becomes checkable)

---

# Sprint 4 — The EncryptionContext change *(stretch — read the gate first)*

**Theme:** the deepest security item, in its own sprint because it is the one where a mistake is
unrecoverable.

**Depends on:** Sprints 1–3. **Gated:** see below.

**The finding (ROADMAP §2-B5).** `generateDataKey` and `decryptDataKey` in `lib/kms/kms-client.ts`
pass no `EncryptionContext`, and `DecryptCommand` names no `KeyId` — so any blob wrapped under the
CMK unwraps for any caller the *application* lets through. The application-layer hole this permitted
was found and closed on 2026-08-13 (the 🔴 header in `src/app/api/kms/unwrap/route.ts` tells the
story: a body-supplied `wrapped_data_key` was a cross-tenant oracle). The fix was correct. **The
structure that allowed it is unchanged**, and the portfolio rule is structural safety over
convention: make the cross-tenant unwrap impossible *at KMS* rather than refused by a check somebody
has to keep writing.

### ⛔ The gate on this sprint

Every wrapped key written before this change has **no context and must decrypt forever** — the same
permanent-legacy rule `lib/crypto/secret-payload.ts` already lives under, for the same reason: the
server cannot read plaintext, so no migration can ever rewrite a row. That means a column, which
means a migration, which means Steve. And the change cannot be live-proven in a credential-less
worktree, on the one path where being wrong is unrecoverable.

**So this sprint is DESIGN ONLY unless Steve says otherwise.** Its output is a plan someone can
execute with credentials at their elbow — not a merged crypto change nobody has watched work.

| # | Item | Effort |
|---|---|---|
| S4-1 | The compatibility rule, written first: how a legacy blob is recognised, and the proof that it still decodes. Nothing else starts until this is settled | S |
| S4-2 | `db/migrations/037_*.sql` authored, not applied — the per-row marker recording which wrapping era a key belongs to | S |
| S4-3 | The wrap/unwrap change itself, behind that marker, with `KeyId` named on Decrypt as the second half of the same fix | M |
| S4-4 | The live-proof script: a walk that wraps with context, unwraps it, **and** unwraps a legacy blob, in one run against the real CMK. This is what "done" means for S4-3, and it cannot run here | S |
| S4-5 | Roll-forward and roll-back notes: what a half-deployed state looks like in each direction, and which one is safe | S |

**Post-merge, and non-negotiable:** S4-4 run from the main checkout against production, plus
`npm run verify:reveal` — the walk that exists precisely because the product's most valuable moment
had no end-to-end proof.

---

## Not in these sprints, and why

| Item | Why not | Who |
|---|---|---|
| Restore drill including an unwrap (ROADMAP D3) | Needs AWS credentials and a real restore | Claude + Steve, main checkout |
| Live runs of `verify:kms`, `verify:live`, `verify:schema` | No credentials in a worktree, by design | Steve or Claude, main checkout, post-merge |
| Applying migrations 036 / 037 | A sysadmin act — `.env.admin`, both regions, then `verify:schema` | **Steve** |
| Multi-Region CMK · shared-state rate limiter · separate test cluster (D4) | Three infrastructure changes to a working system. Each needs the 5-gate policy, a snapshot, a rollback and an explicit request. S1-4, S3-5 and the D4 entry produce the proposals; none of them takes the change | **Steve** |
| Support response commitment (ROADMAP C6) | The commitment is a decision, not a build. `hello@relaystandby.com` is offered on the acute paths with no stated response time; the copy can only be made honest once there is something to be honest about | **Steve** |
| Flipping `canRelease` (F-j) | `ratified.beta-free-release`, dated 2026-10-01 | **Steve** |
| Everything in ROADMAP §2-F | Held behind demand evidence by name. Not eligible, and a sprint that reaches for one has misread the gate | — |
