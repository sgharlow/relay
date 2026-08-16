# Pointing production at `relay_app`

> ## ✅ DONE — 2026-08-16, approved by Steve. All five phases complete.
>
> `DSQL_ROLE=relay_app` is set in Vercel (Production scope only), the app has been redeployed and
> observed serving as that role, and `dsql:DbConnectAdmin` has been removed from
> `relay-runtime-policy` (now at **v2**; **v1 is retained** and is the rollback).
>
> **relaystandby.com can no longer obtain database admin.** Not by configuration — by permission.
> Even with `DSQL_ROLE` unset, the runtime credential can only mint a `dsql:DbConnect` token, and
> such a token cannot authenticate as `admin` however the client asks.
>
> The rest of this document is kept as the record of what was done and why, and as the procedure if
> the roles are ever rebuilt. Read "How it was proven" before trusting any of it again.

**What was true until 2026-08-16:** every request served by relaystandby.com ran against Aurora DSQL
as `admin`, with authority to `CREATE`, `ALTER` and `DROP` every table in the product. Nothing in the
application wants that — it reads and writes rows, and migrations are deliberately a sysadmin act.
The rights were simply there, unused, waiting for an injection bug or a leaked key to make them
matter.

## How it was proven

**A 200 from a database-reading endpoint proves nothing about WHICH role connected** — `admin` would
have answered identically, so a green page after the cutover would have been exactly the kind of
signal this project keeps being caught by. The decisive test was privilege, not availability:

| Step | Result |
|---|---|
| Baseline probe of `/api/health/delivery-webhook` | 200 |
| `REVOKE SELECT ON email_delivery_events FROM relay_app` — that role **only** | production went **500** |
| `GRANT` restored | back to 200 within seconds |

Production broke when a privilege was taken from `relay_app` alone. It could only have broken if it
was connecting as `relay_app`. (The one 500 immediately after the restore was a warm connection
holding the revoked state; it cleared on its own.)

**Then the function, not just the connection.** `verify:stepup` was run twice against
`https://relaystandby.com` — once after the cutover and again after the IAM strip — **17/17 both
times**: signup (INSERT), export (SELECT), step-up elevation and server-side revocation (UPDATE),
recovery-code issue (INSERT), account closure (DELETE). Row counts unchanged afterwards.

**And the sysadmin path still works**, which is what makes the strip safe: migrations run from
`.env.admin` as `autospecai`, a different principal. Confirmed after the strip —
`current_user=admin`, `CREATE=true`. `relay_dev` on the same check: `CREATE=false`.

## ⚠️ The half `verify:roles` does not watch

`npm run verify:roles` re-measures the **database** side — grants, DDL, and the IAM-to-role
bindings recorded in `sys.iam_pg_role_mappings`. It does **not** check the **IAM policies**, and
those are the other half of the wall: re-adding `dsql:DbConnectAdmin` to `relay-runtime-policy`
would silently restore the latent admin capability that phase 4 removed, and nothing in this
repository would notice.

It was left as a command rather than a script deliberately. The DB side needed automating because
grants change routinely as migrations land; an IAM policy changes only when a person decides to
change it, and `scripts/aws-sig.mjs` — the repo's way of calling AWS around Norton's TLS
interception — imports `@smithy/signature-v4` and `@aws-crypto/sha256-js`, which are **transitive
dependencies of `@aws-sdk/*` and are not declared in `package.json`**. Building a gate on undeclared
deps trades one silent failure for another.

So: run this after any change to either runtime principal. Both must print `dsql:DbConnect` and
nothing more.

```bash
export AWS_CA_BUNDLE="$HOME/.aws-certs/win-root-ca-<current>.pem"   # Norton rotates these
for u in relay-runtime relay-dev; do
  arn="arn:aws:iam::461293170793:policy/${u}-policy"
  v=$(aws iam get-policy --profile autospecai --policy-arn "$arn" --query 'Policy.DefaultVersionId' --output text)
  echo "== $u =="
  aws iam get-policy-version --profile autospecai --policy-arn "$arn" --version-id "$v" \
    --query 'PolicyVersion.Document.Statement[?starts_with(Sid, `Dsql`)].Action' --output json
done
```

Verified 2026-08-16: `relay-runtime` → `["dsql:DbConnect"]` (v2), `relay-dev` → `["dsql:DbConnect"]`.

## Rollback

| To undo | Do this |
|---|---|
| The IAM strip | Set `relay-runtime-policy` back to **v1** (retained, not deleted) |
| The role cutover | Remove `DSQL_ROLE` from Vercel Production and redeploy |

Neither requires touching the database. The roles can sit unused indefinitely.

## Why it is one variable

`lib/db/connection.ts` decides who to be:

```ts
export function dsqlIdentity(): { user: string; admin: boolean } {
  const role = process.env.DSQL_ROLE?.trim();
  if (!role || role === 'admin') return { user: 'admin', admin: true };
  return { user: role, admin: false };
}
```

Unset means admin, and it is unset in production. Setting `DSQL_ROLE=relay_app` makes the app mint
`getDbConnectAuthToken()` instead of `getDbConnectAdminAuthToken()` — and **a token minted with
`dsql:DbConnect` cannot authenticate as `admin` even if the client asks for it.** That is what makes
this a wall rather than a policy.

## What is already true

Verify any of this yourself with `npm run verify:roles` (read-only, both regions).

| | `relay_app` | `relay_dev` |
|---|---|---|
| IAM principal | `user/relay-runtime` — the one production already uses | `user/relay-dev` |
| DML on the 25 declared tables | full | full |
| `caregiver_leads` | **writable** | **read-only** |
| DDL | none | none |
| Future tables | covered by `ALTER DEFAULT PRIVILEGES` | covered |

`caregiver_leads` is the one deliberate difference and the reason the split has two roles rather than
one. A lead captured by the live site from a stranger **is** the G1 measurement; a lead submitted
from a laptop — and `.env.local` points at production — is the opposite of the thing being measured.

## What `verify:live` proved, 2026-08-16

The three live walks were run against production **as `relay_dev`** — the least-privilege identity —
and all passed: **50 assertions, 17 + 14 + 19, zero privilege failures.**

That matters for this cutover more than for an ordinary release. `has_table_privilege` says what the
catalogue believes; these walks say what the *application* actually needs, exercised through the real
HTTP surface: signup, TOTP, step-up elevation and revocation, account export, recovery-code issue,
account closure, standby claiming, two owners firing emergencies, the contact picker, and the owner
UI at 390px. Not one of them hit a `permission denied`.

**`relay_app` holds strictly more privilege than `relay_dev`** — identical on all 25 tables, plus
write on `caregiver_leads`. So a walk that passes under the tighter role is strong evidence the
looser one is sufficient. It is not proof of the handshake (see step 4), but it removes the other
question: whether the grants are *enough* to run the product. They are.

Row counts before and after were identical (`users=1`, everything else 0), so the walks left nothing
behind — worth checking, because an early run of the multi-owner walk once left four accounts.

## The cutover

1. **Before.** Run `npm run verify:roles` and `npm run verify:schema`. Both must be green in both
   regions.
2. **Set** `DSQL_ROLE=relay_app` in Vercel, Production scope only.
3. **Redeploy.** The variable is read at request time, but a redeploy makes the change observable
   and dated.
4. **⚠️ CHECK THIS FIRST, because it is the one thing that could not be proven in advance.** Nobody
   has connected to the cluster *as* `relay_app`. The role exists, its grants are exact, and its IAM
   binding is confirmed in `sys.iam_pg_role_mappings` — but the credential that authenticates as it
   lives in Vercel and deliberately not on any laptop, so the handshake itself is untested. The first
   authenticated request after the cutover is the proof. Watch for `permission denied` or an auth
   failure in the Vercel logs, then exercise a real read and a real write.

   🔴 **DO NOT submit `/caregivers/interest` to test the write.** An earlier draft of this step said
   to, because it writes the one table whose privilege differs from `relay_dev`. That is exactly why
   it must not be used: a submission from production is indistinguishable from a real one, so the
   test would write a fabricated row into `caregiver_leads` — the G1 measurement, whose entire worth
   is that it is arms-length. The wall this whole document builds exists to make that impossible
   from a laptop; doing it deliberately from production defeats the purpose.

   Use `E2E_BASE=https://relaystandby.com npm run verify:stepup` instead. It exercises INSERT,
   SELECT, UPDATE and DELETE through the deployed app on a disposable account, on a reserved domain
   that sends no mail, and deletes it again — which is what was actually run.
5. **Rollback** is removing the variable and redeploying. Nothing has to be undone in the database;
   the role can sit unused indefinitely.

## Phase 4 — and why the cutover is not finished without it

While `relay-runtime-policy` still grants `dsql:DbConnectAdmin`, an operator who unsets `DSQL_ROLE`
is silently a superuser again, and so is anyone holding that key. Phase 4 removes it:

```json
"Action": ["dsql:DbConnect"]
```

on `arn:aws:iam::461293170793:policy/relay-runtime-policy` — the `DsqlConnect` statement, dropping
`dsql:DbConnectAdmin`, keeping both cluster ARNs. Do it only **after** the app has been observed
serving normally as `relay_app`, because it removes the fallback.

⚠️ Migrations are unaffected: they run from `.env.admin`, which authenticates as `autospecai` — a
different principal that keeps its admin rights. This was proven independently before phase 2, and
it is the reason stripping `relay-runtime` does not lock anybody out of the schema.

## Keeping it true

A `GRANT` leaves no trace in this repository. `db/migrations/*.sql` records what was intended when
each file ran; it cannot tell you what is true now, and anyone with admin can widen a role in one
statement that shows up in no diff, test run or build.

`npm run verify:roles` is the check that re-measures it — both regions, read-only, exit 1 on any
deviation. Run it after every migration and on both sides of this cutover. It has been proven to
fail in both directions: granting `relay_dev` INSERT on `caregiver_leads` and revoking `UPDATE` on
`vault_items` from `relay_app` each produced a red run in both regions.
