# Pointing production at `relay_app`

**Status: phases 0–3 done, phase 4 outstanding. The cutover itself is one environment variable and has not been made.**

Until it is, every request served by relaystandby.com runs against Aurora DSQL as `admin`, with
authority to `CREATE`, `ALTER` and `DROP` every table in the product. Nothing in the application
wants that — it reads and writes rows, and migrations are deliberately a sysadmin act. The rights
are simply there, unused, waiting for an injection bug or a leaked key to make them matter.

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
   failure in the Vercel logs, then exercise a real read and a real write:
   - open `/vault` on a signed-in account (read)
   - submit the form at `/caregivers/interest` (write to the measurement table — the privilege that
     differs from `relay_dev`, so it is the one worth exercising deliberately)
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
