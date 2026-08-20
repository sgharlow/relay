# The rate limiter's stance, re-derived

> **2026-08-20.** `lib/http/rate-limit.ts` justified itself by a trade against a **$250 ad test**
> that was cancelled on 2026-08-16 (`ratified.retire-paid-advertising`,
> `ratified.g1-google-lane-cancelled`). Its stated upgrade trigger — *"if lead spam actually
> materialises"* — can therefore never fire. Recorded as
> `PROJECT.yaml → deferred → the-rate-limiters-justification-cites-a-cancelled-flight` (D6).
>
> This is the re-derivation, and it ends in a **decision for Steve**. A shared store is
> infrastructure: proposing is in scope here, adding it is not.

## The answer, first

**No new infrastructure, and not because it is too expensive.** Because this codebase has already
solved durable metering twice, with storage it already owns, and neither solution was a shared
store:

| Existing mechanism | How it counts | What it guards |
|---|---|---|
| `lib/notify/invite-budget.ts` | `audit_log` rows per owner per day | invitation email spend |
| `lib/auth/signin-attempts.ts` | an append-only table + a window predicate (migration 036) | the owner front door |
| `recipient-code.ts` / `verifier-code.ts` | `failed_attempts` on the code's own row | guessing a claim code |

So the choice was never *per-instance memory or new infrastructure*. It is **per-instance memory, or
the durable pattern already in the repository, applied to the endpoints that earn it** — and that is
an endpoint-by-endpoint judgement, because the durable version costs a database round trip on the
path it guards.

**The strongest case for a shared store has already been answered without one.** The argument was
always sharpest for authentication, and owner sign-in's per-address budget became a row on
2026-08-20. What remains in memory there is only the per-source spray bound.

## Two premises in the item itself that turned out to be wrong

Recorded rather than quietly dropped, because they are what the item was scoped on:

1. **"paid third-party calls behind public endpoints"** — naming `/api/ai/intake` (OpenAI) and
   `/api/stripe/checkout` (Stripe). **Both are authenticated.** They rate-limit per *owner*, not per
   stranger, so their limiter is a burst bound on somebody who already signed in, not a boundary
   against the public. The genuinely public money-spending endpoints are the ones that **send
   email**.
2. **"real users, free standby accounts"** as a reason the exposure grew. True in principle, and
   `demand_signal` is still `none` — the population that would make this urgent does not exist yet.
   That is an argument for *readiness*, not for *spend*.

## What is actually only guarded by memory

Cross-referenced against `lib/ops/route-auth.ts` → `PUBLIC_ROUTES`, which is the repo's own declared
list rather than a judgement made here.

| Public endpoint | Budget (per IP) | What a distributed flood actually costs |
|---|---|---|
| `/api/auth/signup` | 10 / hour | junk accounts + DSQL rows. **Also the release gate's own ceiling** — one `verify:live` chain is exactly 10 signups |
| `/api/caregivers/interest` | 5 / 10 min | **corrupts the G1 measurement.** The original reason this module exists |
| `/api/support` | 5 / 10 min | email to the operator's own inbox — floods the channel a human reads |
| `/api/access/resend` | 3 / hour | email to the contact **on record**, never an attacker-chosen address |
| `/api/verify/resend` | 3 / hour | same |
| `/api/auth/recover` | 5 / hour | email + recovery-code attempts (which carry their own durable budget) |
| `/api/incident` | 10 / min | ops alert mail |
| `/api/csp-report` | 20 / min | report sink |
| `/api/webauthn/authenticate/options` | 20 / 5 min | challenge rows (burned single-use, `auth_challenges`) |

### The other half of the surface: where memory is a burst bound, not a boundary

⚠️ **This table exists because the guard demanded it.** The first draft tabulated the public
endpoints and left these in prose — and `lib/ops/rate-limit-stance.test.ts` failed, naming six
routes the document did not. A stance doc that lists nine endpoints while the limiter guards
seventeen understates the exposure in the one place a reader trusts to be exhaustive. The list is
derived from the code now, not written from memory.

| Endpoint | Key | Principal established by | Why memory suffices |
|---|---|---|---|
| `/api/account/step-up` | per **owner** | session | already signed in; the elevation itself is a revocable row |
| `/api/ai/intake` | per **owner** | session | burst bound on somebody who is already a customer — the OpenAI spend is theirs to make |
| `/api/fire-drill` | per **owner** | session | a drill is a deliberate act; the bound stops a stuck button |
| `/api/invitations` | per **owner** | session | ⭐ backed by a **durable** daily count in `lib/notify/invite-budget.ts` — memory is only the burst half |
| `/api/stripe/checkout` | per IP | session | authenticated; the IP key is a double-submit guard, not a boundary |
| `/api/resend/webhook` | per IP | Svix signature | forged calls are refused by signature before the limiter matters |
| `/api/access/code` | per IP | single-use code redeemed from the body | ⭐ each code carries a **durable** `failed_attempts` on its own row |
| `/api/verify/code` | per IP | single-use code redeemed from the body | ⭐ same |

The three starred rows are the point of this whole document: **the endpoints that actually needed
durable metering already have it**, and none of them bought a shared store to get it.

**The bounded ones are bounded by design, not by the limiter.** `access/resend` and `verify/resend`
can only mail the address already on the record — an attacker cannot choose the victim, so the harm
ceiling is annoying one known contact and spending sender reputation. `access/code` and
`verify/code` sit in the second table rather than this one for the same kind of reason: they redeem
a single-use code, which `lib/ops/route-auth.ts` correctly counts as authentication arriving in the
body, and each code carries its own durable `failed_attempts`.

**Two are worth more than the rest**, and neither is about money:

- **`/api/caregivers/interest`** — spam does not cost dollars, it corrupts the one number the
  project is being judged on. `caregiver_leads` is the G1 instrument and `relay_dev` deliberately
  cannot write it so a laptop cannot pollute it. A distributed flood would.
- **`/api/auth/signup`** — junk accounts, and it is the ceiling the release gate runs into
  (`CLAUDE.md`). Ten per hour is *tight*, which is itself the evidence that it has never been under
  real pressure.

## The three options

### Option A — leave it, and say so honestly *(recommended)*

Correct the header (done), keep memory, and extend the **existing durable pattern** to a specific
endpoint on the day there is evidence it needs it.

- **Cost:** none.
- **Risk accepted:** a distributed flood gets through every public endpoint above. The realistic
  attacker today is one client hammering a form, which memory does stop.
- **Why it is defensible rather than lazy:** `demand_signal` is `none`; there are no real users to
  protect and no revenue to lose. The endpoint whose corruption would matter most —
  `caregivers/interest` — currently holds **zero rows**, and `flight:snapshot` exits non-zero if it
  is non-empty before a measurement window opens, so pollution would be *noticed* even though it is
  not *prevented*.
- **Reopens when:** the first arms-length person, the first published placement (an op-ed is the
  first time a stranger has a reason to find the lead form), or any observed abuse.

### Option B — extend the durable pattern to the two that earn it

`caregivers/interest` and `auth/signup`, counted the way `invite-budget.ts` already counts — rows in
storage we own, no new service.

- **Cost:** no money. One query per request on two public endpoints, and a migration if a table is
  preferred over `audit_log` rows.
- **Buys:** a flood across instances is actually stopped on the two paths where getting through
  matters.
- **Costs:** a DB round trip on the exact endpoints an attacker is hammering — the limiter becomes a
  way to make the database do work. `invite-budget` avoids this by being per *owner* (authenticated);
  a per-IP durable counter does not have that protection. **This is the objection to answer before
  building it**, and it is why this is not recommended today.

### Option C — a shared store (Upstash Redis via the Vercel Marketplace)

- **Cost:** free tier covers this volume; ~$0.20 per 100k commands beyond it. The money is not the
  argument in either direction.
- **Against:** a new external dependency, a new secret in the rotation runbook, a new failure mode
  on public paths, and a new thing that can be down. It buys a boundary the product does not yet
  have anything to protect.
- **Recorded so it is not re-proposed as the obvious answer.** It is the conventional solution and
  it is the wrong one at this stage.

## Recommendation

**Option A now; Option B when the first stranger arrives, and only for `caregivers/interest` and
`auth/signup`.** Option C stays closed unless something makes a genuine per-IP global boundary
necessary, which nothing does today.

⚠️ **What makes Option A honest is that the exposure is written down and the trigger is named.** The
previous stance was defensible too — and its trigger had been dead for four days before anyone
noticed, which is the actual failure this item exists to correct.

## One thing to fix regardless of the ruling

`/api/auth/signup`'s 10/hour ceiling is the release gate's ceiling too: one `verify:live` chain
performs exactly ten signups, so the chain cannot run twice in an hour from one host. That is
documented in `CLAUDE.md` now. It is worth noticing that **a rate limit tuned for strangers is
currently also the constraint on our own release process** — if the limit is ever raised, raise it
for a reason about strangers, and re-read that note.
