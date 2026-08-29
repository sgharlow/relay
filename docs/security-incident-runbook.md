# Security incident and breach runbook

> **Written 2026-08-20**, because `docs/` held a backup runbook, an email-DNS runbook and a
> submission runbook, and nothing at all for the event a credential custodian most has to be ready
> for. Recorded as `PROJECT.yaml → deferred → no-incident-or-breach-runbook`.
>
> **This is cheap now and unwritable at 3am.** That is the entire argument for it existing before
> there is anything to use it on.

## ⚠️ "Incident" already means two other things in this repository

Both predate this document and neither is what this is about. Getting them confused mid-event would
be expensive, so they are named here first:

| Name | What it is |
|---|---|
| `/api/audit/incidents`, `lib/audit/incident-record.ts` | **a customer-facing feature** — "what happened while you were away", a reading of the audit log for an owner returning from hospital |
| `/api/incident`, `lib/ops/incident.ts` | **a client-side error beacon** — the browser telling us a page failed |
| **this document** | somebody may have obtained access they should not have |

## The one fact that shapes every answer below

**Relay cannot read its customers' secrets, and neither can an attacker who takes its database.**
Vault contents are AES-GCM ciphertext plus a data key wrapped by a KMS CMK; the plaintext data key
exists only in a browser. `CLAUDE.md`'s zero-knowledge invariant is not marketing — it is the
reason the honest answer to *"what was exposed?"* is narrower here than at most companies, and it
is the single most useful thing to be able to say accurately and early.

**What a database compromise alone does NOT expose:** vault item contents, passwords, TOTP seeds,
recovery-code sheets, documents, instructions.

**What it DOES expose, and must be said plainly rather than buried:** email addresses and display
names; the *titles*, categories and importance of vault items — `Chase checking`, `Mum's care home
login` — which are metadata by our definition and are deeply personal by any reader's; who is in
somebody's circle and in what role; the audit log of who accessed what and when; and TOTP secrets
for owner sign-in, which are stored server-side and are **not** wrapped by the CMK.

> 🔴 **That last one is the exception that must not be lost in the good news.** The zero-knowledge
> claim is about vault *contents*. Owner authenticator seeds are a different class of secret and a
> database compromise puts them at risk. Any notice that says "we cannot read your data" without
> saying that is a notice that misleads.

## Step 0 — before anything: do not destroy the evidence

The audit log is **append-only and hash-chained per owner** (`lib/audit/chain.ts`;
`entry_hash = SHA-256(prev_hash || canonicalJson(entry))`). It is the only record of what actually
happened, and its value in an investigation is exactly its integrity.

- **Never UPDATE or DELETE an audit row.** Not to tidy, not to remove a test entry, not to "clean
  up" an attacker's traces. A single edit invalidates every hash after it and converts the one
  trustworthy artifact into an unusable one.
- **Verify the chain before you touch anything else**, and record the result with a timestamp:
  `verifyAuditChain()` in `lib/audit/chain.ts` returns `{ valid, brokenSeq, reason }`. A break found
  *at the start* is evidence; a break found later is a question about what you did.
- Capture, in this order: Vercel runtime logs for the window, the audit chain per affected owner,
  `scheduler_runs`, and `email_send_attempts`. Vercel log retention is finite — pull first, reason
  second.

### The command (B24, 2026-08-29)

Every bullet above was a sentence until 2026-08-29, and nothing scripted any of it. At 3am a
runbook step with no command is a step that gets approximated.

```bash
npm run incident:evidence                    # every owner — chain check only, stamped
npm run incident:evidence -- <email>         # one owner — chain + telemetry bundle
npm run incident:evidence -- <email> --since 24h
```

Read-only, under `.env.ro` (`relay_ro`: SELECT everywhere, no DML, no DDL, **no KMS grant at
all**). It cannot repair a chain, and there is no repair path here by design. Exit **0** every
chain verified · **1** a chain is BROKEN (a finding, not a script failure) · **2** could not look.

It prints **counts and windows, never `detail` values** — an evidence bundle that quotes vault
data is a vault export with an official-sounding filename.

> 🔴 **Run it FIRST, before anything else touches anything.** The bullet above says a break found
> at the start is evidence and a break found later "is a question about what you did". The script
> stamps `verified_at` on every run, and that timestamp is the artefact — the same output produced
> an hour into an investigation is worth strictly less, and nothing about the output would say so.

> ⚠️ **It does NOT pull the Vercel logs, and it says so on every run.** Those need a Vercel token
> rather than a database credential, and theirs is the only part of the bundle with a clock on it
> (~24h retention). That half stays human: `vercel logs relay --prod`, or the dashboard's Logs
> tab. A clean report from this script does not mean the bundle is complete.

> **It also doubles as the pre-release chain check**, which is why the no-argument form sweeps
> every owner rather than demanding one.

## Step 1 — containment

**Do these in the order given.** Each one is cheap and reversible; the order is about not locking
yourself out of the investigation.

### 1a. End sessions

| Situation | What to do | The honest state of the mechanism |
|---|---|---|
| One account | `bumpSessionEpoch(userId)` (`lib/auth/session-epoch.ts`) — every existing session for that user fails its next request | Built for exactly this. Currently called from **one** place: `/api/auth/recover` |
| Everybody, now | **Rotate `NEXTAUTH_SECRET`** in Vercel and redeploy. The JWT session strategy means every cookie in existence stops verifying | ⚠️ There is **no bulk `bumpSessionEpoch`** and no operator UI for it. This is the global signout, and it is a blunt one |

> ⚠️ **Rotating `NEXTAUTH_SECRET` signs out every owner in the world, including people mid-crisis.**
> That is a *feature* here and an outage on an ordinary Tuesday. Decide deliberately, and expect
> support contacts. **`docs/secret-rotation-runbook.md` §1** carries the mechanics — including the
> trap that `AUTH_SECRET` is a second name for the same value and three modules read only the first,
> so setting the wrong one leaves sessions working while step-up and passkeys throw.

### 1b. Cut the token paths, if the exposure could reach them

Recipient and verifier links are signed JWTs (`RECIPIENT_JWT_SECRET`, `VERIFIER_JWT_SECRET`).
Rotating either **invalidates every live link immediately** — and during an open release that means
a verifier clicking a legitimate link gets an error at the moment a family is waiting. Rotate anyway
if the secret is implicated: the release state is the source of truth and links can be reissued. Know
the cost before you pay it, not after.

**`docs/secret-rotation-runbook.md` §2** is the procedure, including how to check whether a release
is open first, and the fact that a contact who has CLAIMED a standby account is unaffected — these
secrets cover unclaimed contacts only, so the more of a circle that has claimed, the smaller this
blast radius is.

### 1c. Protect the key

`npm run verify:kms`. A CMK that is disabled, scheduled for deletion, or whose policy has changed is
not an access problem, it is an **erasure** — and a key pending deletion still decrypts, so nothing
else in the product will tell you. If the key policy has been altered by someone who should not have
altered it, that is the highest-severity finding available in this system and it outranks everything
above.

### 1d. Close the door that was used

`npm run verify:iam` and `npm run verify:roles` re-measure the two least-privilege walls from live
state rather than from what a migration file once said. Run both. Then rotate the credential that
was used, and only then start reasoning about scope.

## Step 2 — scope, in writing

Answer these four in a file, with timestamps, before telling anybody anything:

1. **What identity was used?** Owner session, recipient token, verifier token, an IAM principal, or
   direct database access. They have very different blast radii.
2. **Which owners are affected?** The audit chain is per owner, so this is answerable precisely
   rather than by assumption.
3. **Was any unwrap performed?** `/api/kms/unwrap` writes an audit entry on every decrypt. This is
   the question that separates "metadata exposure" from "a vault was opened", and it is the
   difference between two very different notices.
4. **Is it still happening?** If yes, go back to Step 1.

## Step 3 — notification

**The operator is Steve personally. There is no entity, no legal department and no PR function**
(`PROJECT.yaml → ratified.relay-operator-is-an-individual`). That is not a gap to apologise for
here; it is a fact that decides who does each of the following, which is Steve, and it is why this
section exists in advance.

- **State breach-notification law binds an individual operator exactly as it binds a company.** All
  fifty states have a statute; most are triggered by unauthorised acquisition of personal
  information and most require notice "without unreasonable delay", with several imposing an outer
  bound measured in days. Relay holds names, email addresses and — per the list at the top — item
  titles that are personal by any ordinary reading.
- **Do not wait for certainty to start drafting.** A notice that arrives late because it was being
  perfected is worse than one that says plainly what is known and what is still being established.
- **Say the narrow true thing, not the reassuring one.** "We cannot read your vault contents and
  neither can whoever did this" is true, valuable, and must appear **beside** the exposure list
  above, including owner TOTP seeds. A notice that omits the exception is a notice that misleads,
  and it is the sentence that would be quoted back.
- **Tell people what to do**: re-enrol the authenticator, review `/audit` for their own account
  (they can verify the chain themselves — the client-side verifier exists), and rotate credentials
  for any account whose *title* being known matters.
- **The customer contact route is `hello@relaystandby.com`, and the commitment on it is
  `SUPPORT_RESPONSE_TIME` in `lib/contact.ts` — one business day.** Ruled by Steve 2026-08-20
  (`PROJECT.yaml → deferred → support-has-an-address-and-no-commitment`, C6, closed), chosen to be
  honest on a solo operator's worst week rather than flattering on his best. `/about` and the
  support form both render it from that one definition, and
  `lib/ops/support-commitment.test.ts` fails the build if a second surface states a different
  number — so **do not write a rival figure into an incident notice.** If the incident warrants
  faster, say so as an explicitly temporary commitment scoped to this incident ("while this is
  open we are answering within N hours"), and let it lapse back rather than editing the standing
  one under pressure.
  - ⚠️ **That temporary figure must not be typed into a `src/app/**` surface.** The same guard
    cited two lines above fails the build on *any* page or component that states a response time
    without importing `SUPPORT_RESPONSE_TIME` — `/within (a few|\d+|one|two|three|24|48)
    (hours?|days?|business days?)/i` — and an incident status page is exactly that. So put the
    temporary commitment in the **emailed notice**, or render it from a scoped constant that
    imports the standing one. Discovered 2026-08-21: this step handed an operator mid-incident a
    remedy `npm run gate` refuses, at the worst possible hour to find that out.

  > **Was:** *"It has no stated response commitment … so if it is going to carry an incident it
  > needs one that day."* True when this runbook was written; C6 was ruled the same day and this
  > line was not updated, so the step told an operator at 3am to invent a number that already
  > existed. Corrected 2026-08-21.

## Step 4 — afterwards

- Write it up in `docs/sprint-reports/` with the same discipline as any other finding: what
  happened, what was true, what was assumed and wrong.
- **Every regression found by clicking becomes a test in the same commit as the fix.** That is a
  standing portfolio rule and it applies most here.
- Re-run the full wall set — `verify:roles`, `verify:iam`, `verify:kms`, `verify:schema` — and
  `npm run verify:live`, and stamp it.
- If the cause was a control that existed but was not called, add the sibling guard in `lib/ops/`
  rather than a note asking somebody to remember. That is what every check in that directory is.

## What this document deliberately does not do

It does not define severity tiers, an on-call rotation, or an escalation matrix. There is one
operator and no rota, and inventing that ceremony would produce a document that reads as though
somebody else is coming. Nobody else is coming. What is written here is what one person needs, in
order, at three in the morning.
