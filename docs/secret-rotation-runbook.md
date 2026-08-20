# Secret rotation runbook

> **Written 2026-08-20.** Eleven secrets sit in Vercel with no recorded age, no procedure and no
> owner, and nothing in `docs/` rotated anything. Recorded as
> `PROJECT.yaml → deferred → no-secret-rotation-runbook`.
>
> This is the operational half of the arc `docs/least-privilege-cutover.md` closed on identity.
> That work made it impossible for the live site to obtain database admin; this one answers the
> question that comes next — *what do we do when one of these leaks?* — before it is being asked
> under pressure.
>
> **Reached from `docs/security-incident-runbook.md` step 1**, which is the situation this exists
> for. Read that first if something is actually happening.

## The one rule that outranks the table

**Rotating a secret in Relay is never only a credential change. Every one of them is currently
signing or authenticating something that is in flight**, and for two of them that in-flight thing
is a family in an emergency. There is no secret here whose rotation is free, and the cost is not
proportional to how alarming the secret sounds.

So: read the row before you touch the variable, and **know which of the three costs you are about
to pay** — sign everybody out, break every live link, or lose telemetry.

## The rotation table

Every one of these lives in Vercel project environment variables. Changing one **requires a
redeploy** to take effect on running instances — Vercel does not hot-reload environment variables
into an existing deployment, and a rotation that is not redeployed is a rotation that has not
happened.

| Secret | Protects | Blast radius when rotated | Last set |
|---|---|---|---|
| `NEXTAUTH_SECRET` | owner sessions, step-up elevation, WebAuthn ceremonies, recovery enrolment | **Signs out every owner in the world.** See §1 | unknown |
| `AUTH_SECRET` | the fallback name for the same value | as above — and see the trap in §1 | unknown |
| `RECIPIENT_JWT_SECRET` | scoped recipient links to an open release | **Every live recipient link stops working.** See §2 | unknown |
| `VERIFIER_JWT_SECRET` | verifier confirmation links (72h TTL) | **Every live verifier link stops working.** See §2 | unknown |
| `CRON_SECRET` | `/api/cron/heartbeat` — the release sweep | the sweep stops until Vercel's cron config matches. See §3 | unknown |
| `STRIPE_SECRET_KEY` | checkout, portal, subscription reads | new checkouts fail until redeployed; existing subscriptions unaffected | unknown |
| `STRIPE_WEBHOOK_SECRET` | verifying Stripe's callbacks | **billing state silently stops reconciling.** See §4 | unknown |
| `RESEND_API_KEY` | every outbound email | all mail stops. Loud, and the monitors catch it | unknown |
| `RESEND_WEBHOOK_SECRET` | verifying Resend's delivery events | delivery telemetry stops; `/circle` reads `unknown` again | unknown |
| `OPENAI_API_KEY` | the importance engine | intake analysis degrades; the vault is unaffected | unknown |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (Vercel → IAM `relay-runtime`) | the IAM identity for DSQL **and** KMS in production | **the whole product**. See §5 | **2026-06-24** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (`.env.local` → IAM `relay-dev`) | a laptop's read/write on product tables. No DDL, cannot write `caregiver_leads` | local walks and scripts stop; production unaffected | **2026-08-16** |
| IAM `autospecai` access key (`~/.aws/credentials`, used by `.env.admin`) | **database admin** — migrations, roles, grants — plus IAM and KMS reads | migrations and every `verify:*` that needs `.env.admin` stop. Production unaffected: it does not hold this identity | **2025-06-29** |

> ⚠️ **"unknown" is a finding, not a blank.** Fill a cell the moment you rotate one, and the table
> starts being able to answer "are any of these old?". That is the whole reason the column exists
> before there is anything to put in it.
>
> ✅ **Three cells filled 2026-08-20, and they were free.** The AWS rows never needed anyone to
> remember: IAM records a `CreateDate` per access key, so their ages are *discoverable* rather than
> recalled. Re-derive at any time — no CLI needed, and the AWS CLI is in fact broken on this machine
> (Norton's CA bundle at `~/.aws-certs` goes stale as Norton rotates); Node's SDK uses a different
> trust store and works:
>
> ```bash
> npx tsx --env-file=.env.admin -e "import('@aws-sdk/client-iam').then(async m => { \
>   const c = new m.IAMClient({}); \
>   for (const u of ['relay-dev','relay-runtime','autospecai']) { \
>     const r = await c.send(new m.ListAccessKeysCommand({ UserName: u })); \
>     r.AccessKeyMetadata.forEach(k => console.log(u, k.Status, k.CreateDate.toISOString().slice(0,10))); } })"
> ```
>
> 🔴 **The oldest thing in the estate is the `autospecai` admin key at 418 days (as of 2026-08-20),
> and it is the one with database-admin rights.** It is also the only identity here that can issue
> DDL. If exactly one secret on this page gets rotated, it is that one — and note that rotating it
> is unusually *safe*, because production does not hold it: the blast radius is this laptop's ability
> to run migrations, not the live site.
>
> The nine remaining `unknown` rows are Vercel-held. Vercel records a last-updated timestamp per
> environment variable, so those are discoverable too — `vercel env ls` once the CLI is installed
> (`npm i -g vercel`), or read off the dashboard. Tracked as
> `PROJECT.yaml → deferred → every-secrets-age-is-unknown` (D11).

---

## §1 — `NEXTAUTH_SECRET` · signs everybody out

**What it actually signs**, which is more than the name suggests: owner session JWTs (24h), step-up
elevation tokens (5 min), WebAuthn challenge tokens (5 min), and recovery-enrolment tokens (15 min).
Rotating it invalidates all four at once.

- **The 24-hour one is the cost.** Every signed-in owner is signed out and must re-enter an
  authenticator code. The short-lived three are noise: an in-flight ceremony fails and the person
  presses the button again.
- **This is a FEATURE during an incident and an OUTAGE on an ordinary Tuesday.** It is the only
  global session revocation Relay has — `bumpSessionEpoch` is per user and is called from exactly
  one place. `docs/security-incident-runbook.md` §1a reaches for this deliberately. Reaching for it
  casually is a self-inflicted outage for every owner, including anybody mid-emergency.
- **Safe when:** you have decided the sign-out is worth it. There is no window that makes it free.
- **⚠️ THE TRAP: there are TWO names.** `lib/auth/auth-options.ts` reads
  `NEXTAUTH_SECRET ?? AUTH_SECRET`, and three other modules read `NEXTAUTH_SECRET` **only**
  (`step-up.ts`, `webauthn.ts`, `recovery-enrolment.ts` — `signup.ts` reads both). So setting
  `AUTH_SECRET` alone produces a half-working product: sessions verify, step-up and passkeys throw.
  **Rotate `NEXTAUTH_SECRET`. If `AUTH_SECRET` is also set, set it to the same value or unset it —
  never leave them different.**
- **Verify after:** sign in as an owner, then exercise a step-up (Account → export) so the second
  code path is proven, not assumed.

## §2 — `RECIPIENT_JWT_SECRET` and `VERIFIER_JWT_SECRET` · break every live link

**These are the two that are not merely inconvenient, and they are the reason this document exists
rather than a note in `.env.example`.**

Both sign links that are handed to people who are not signed in: a recipient's scoped access to an
open release, and a verifier's confirmation link (72-hour TTL). Rotating either **invalidates every
outstanding link immediately**.

**What that looks like on the day:** a doctor or an adult child clicks a legitimate link during an
emergency and gets an error. That is not hypothetical framing — it is what the token path is for.

- **Safe when: no release is open.** Check before touching either:
  ```bash
  npm run verify:orphans     # reports account/row state; a release in flight is visible
  ```
  and read `/audit` or `release_state` for anything not `armed`. If everything is `armed`, the only
  live links are unclaimed invitations, and reissuing those is routine.
- **When a release IS open and the secret is implicated: rotate anyway, then re-issue.** The
  **release state is the source of truth; the link is not.** A rotated secret does not close
  anybody's release — it closes their *link*, and the release is still open for a fresh one. Send
  the new link and tell the person plainly that the old one stopped working. A compromised signing
  key left in place because the timing was inconvenient is a worse answer.
- **⚠️ Do not rotate both at once unless both are implicated.** They protect different populations
  and there is no benefit to doubling the blast radius.
- **The standby path is unaffected**, and that matters: a contact who has *claimed* a standby
  account signs in as themselves and resolves the release server-side, with no token involved
  (`docs/standby-architecture.md`, hybrid+6). These secrets cover **unclaimed** contacts only. The
  more of the circle that has claimed, the smaller this blast radius gets.
- **Verify after:** issue one fresh link on a disposable account and walk it. `npm run verify:live`
  covers the recipient path end to end.

## §3 — `CRON_SECRET` · the sweep stops, and the dead-man notices

`/api/cron/heartbeat` refuses without it. Vercel Cron sends it, so the value has to match **in two
places** — the environment variable and whatever Vercel's cron invocation carries.

- **Blast radius:** the release sweep stops running. No release advances, no escalation fires, no
  challenge or attempt-budget housekeeping happens.
- **This one is watched.** `/api/health/scheduler` returns 503 once the sweep goes quiet, and
  `.github/workflows/scheduler-monitor.yml` turns that into an email through GitHub, off-platform.
  So a botched rotation here is loud within 30 minutes — which is a good reason to rotate it during
  a window you are watching rather than at the end of a day.
- **Verify after:** wait for one scheduled run, then `curl /api/health/scheduler` and confirm
  `healthy: true` with a fresh `lastRunAt`. Do not conclude from a 200 on the route itself.

## §4 — `STRIPE_WEBHOOK_SECRET` · the silent one

`src/app/api/stripe/webhook/route.ts` verifies every Stripe callback against it. A wrong value does
not break checkout and does not error anywhere a customer can see — it makes every callback fail
signature verification, so **subscription state silently stops reconciling**: cancellations do not
land, renewals do not update, and the product's view of who is paying quietly drifts from Stripe's.

- **Rotate in Stripe first**, take the new signing secret, set it in Vercel, redeploy. Between those
  steps callbacks are lost — Stripe retries for hours, so a short gap self-heals; a long one does
  not.
- **Verify after:** trigger a real event (a portal visit that changes something on a test-mode
  subscription) and confirm the row moved. **A 200 from the endpoint proves nothing** — an
  unverified callback is *supposed* to be refused, so the failure and the success look similar from
  outside.

## §5 — the AWS keys · the whole product

`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` authenticate the IAM user that mints DSQL connection
tokens **and** calls KMS. Everything depends on them.

- **⚠️ No application code reads these.** The AWS SDK picks them up from the environment itself, so
  grepping for them finds nothing and it is easy to conclude they are unused. They are not.
- **Rotate without downtime by making two keys valid at once** — this is the one rotation here that
  can be made seamless, and the only reason it is not trivial is ordering:
  1. Create a **second** access key for the same IAM user in the AWS console.
  2. Set the new pair in Vercel and redeploy.
  3. Confirm the product works: `npm run verify:roles`, `npm run verify:iam`, `npm run verify:kms`,
     and one real page load that reads the database.
  4. **Only then** deactivate the old key — deactivate first, delete later. A deactivated key can be
     reactivated in one click; a deleted one cannot.
- **Do not skip step 4's ordering under time pressure.** Deleting the old key before confirming the
  new one is the move that turns a routine rotation into an outage with no fast way back.
- ⚠️ This IAM user is the subject of `verify:iam`'s least-privilege wall. After rotating, re-run it
  — a new key on a policy somebody widened while they were in there is exactly the drift that check
  exists to catch.

## §6 — the rest

`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `OPENAI_API_KEY` follow the ordinary shape: create the
new value at the provider, set it in Vercel, redeploy, confirm, revoke the old one.

- **`RESEND_API_KEY` fails loudly** — all mail stops, and `delivery-webhook-monitor.yml` notices.
- **`RESEND_WEBHOOK_SECRET` fails quietly**, in the same shape as §4: delivery events stop being
  accepted, every address falls back to `unknown` on `/circle`, and the screen reads as "no news"
  rather than "we cannot see". The webhook monitor is the thing that catches it.
- **`OPENAI_API_KEY` degrades** rather than failing: intake analysis stops, the vault is untouched.

## §7 — `DSQL_PASSWORD` · the one that should not exist

**Not a password.** It holds a short-lived IAM auth token, and it is a manual override: when it is
absent, the code mints its own token from the ambient AWS credentials
(`db/migrations/migrate.ts` gained that behaviour on 2026-08-15, before which it refused to start
against the cluster the app uses).

- **It should be empty in production and empty in `.env.local`.** A value here is a *stale token*
  within the hour and a confusing failure afterwards — connections start being refused for a reason
  that looks nothing like an expired credential.
- **"Rotating" it means clearing it**, and then rotating the AWS keys per §5, which is where the
  real credential lives.
- ⚠️ **If you find a value in it, that is the finding**, not a chore. Somebody worked around an auth
  failure by pasting a token instead of fixing the identity, and §5 is the thing that actually
  needed attention.

## What is NOT rotatable, and must never be treated as though it were

- **`KMS_KEY_ID`** is not a secret; it names the CMK. **Pointing it at a different key does not
  rotate anything — it orphans every existing vault**, because a data key wrapped by one CMK cannot
  be unwrapped by another. See `docs/kms-region-proposal.md` for the only safe shape of a key
  change, and `npm run verify:kms` for the check that watches the current one.
- **AWS-managed rotation of the CMK itself** is a different thing and is safe: AWS retains the old
  key material, so previously-wrapped data keys keep decrypting. `ROTATION_INTENDED` in
  `lib/ops/kms-wall.ts` records what this repo expects, and changing it is a decision with a commit.
- **`users.totp_secret`** is per-user, not an operator secret. Rotating an owner's authenticator is
  re-enrolment, done by the owner, and `/privacy` now discloses that we store it readably.

## After any rotation

1. Redeploy. An environment variable set and not deployed has changed nothing.
2. Run the walls that cover what you touched — `verify:roles`, `verify:iam`, `verify:kms`.
3. Run `npm run verify:live` if you touched §1 or §2. Those are authentication paths and the unit
   suite cannot see them.
4. **Write the date in the table above.** The whole point of the last column is that somebody
   eventually gets to answer "how old is this?" with something other than a shrug.
