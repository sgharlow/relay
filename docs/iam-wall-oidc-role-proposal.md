# Proposal: schedule the IAM wall — `relay-iam-wall-ci`

**Status: DRAFTED, NOT BUILT.** Nothing in this document has been executed. A new IAM role is
infrastructure, so it needs Steve's ruling before it exists — this is P1.5 of the ROADMAP's plan
(revision 5, §2.5), whose whole instruction is *"prepare, do not execute … so Sitting D can rule on
it in one line."*

**The one line to rule on** is at the bottom. Everything above it exists so the ruling is informed
rather than trusting.

---

## 1. What is unwatched, and what that costs

`npm run verify:iam` asks the question `verify:roles` structurally cannot: not *what may this
principal do once connected*, but *can it obtain an admin connection at all*. The 2026-08-16
least-privilege cutover closed that arc in two halves and **only the database half is scheduled.**

The sprint that shipped the cutover recorded the gap in its own report rather than closing it:

> the IAM half is not automated — re-adding `dsql:DbConnectAdmin` would go unnoticed by
> `verify:roles`.

One `aws iam create-policy-version` puts it back. It appears in no diff, no test run and no build,
and the application keeps working — so nothing is observably different until the day it matters.
That is the decorative-guard shape this repository keeps catching, and `kms-wall.yml`'s header
records the same finding about `verify:kms`, three days after a register entry had listed it among
the monitors that "ran throughout". It ran when a person typed it on one laptop.

`verify:iam` is in exactly that state today: **written, proven live, and scheduled by nothing.**

## 2. Why it cannot simply be added to an existing workflow

The script is declared `--env-file=.env.admin` — a gitignored file on one laptop. Its own header
says why that is deliberate: *"being a sysadmin is something you choose by naming the file."* CI has
no such file and must never be given one.

`kms-wall.yml` already solved this exact problem for the KMS half and is the working template. It
holds **no stored secret**: it mints a short-lived GitHub OIDC token and exchanges it for
`relay-kms-wall-ci`. That role has been assumed on a schedule since 2026-08-24 and has been proven
both green and red. The pattern is not theoretical here; it is running.

## 3. The exact permissions, derived from the calls the script makes

`verify-iam.ts` states its own surface: *"Five IAM read calls per principal and nothing else."* It
creates no policy, no version and no key.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadThePoliciesOnTheAuditedPrincipals",
      "Effect": "Allow",
      "Action": [
        "iam:ListAttachedUserPolicies",
        "iam:ListUserPolicies",
        "iam:GetUserPolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:GetRolePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why `Resource: "*"` and not a list of ARNs**, stated because it is the weakest line in this
document and hiding it would be worse than defending it. `iam:GetPolicy` and `iam:GetPolicyVersion`
take a *policy* ARN, not a principal ARN, and the whole point of the check is to discover which
policies are attached — including one attached by mistake, which by definition has an ARN nobody
listed in advance. Scoping to today's policy ARNs would make the check blind to exactly the event
it exists to detect: a new policy appearing on `relay-runtime`.

The mitigation is that every action above is a **read of policy documents**. None can create,
modify, attach, detach or assume anything. The worst an attacker with this role learns is the shape
of this account's IAM — which is real, and is the thing to weigh in the ruling.

**Deliberately NOT included:** the four group calls (`ListGroupsForUser`,
`ListAttachedGroupPolicies`, `ListGroupPolicies`, `GetGroupPolicy`). The script's header records
group-attached policies as a known open blind spot, left open on purpose rather than written blind,
and notes that *"none of the three principals is in any group today."* Granting permissions for a
code path that does not exist would be granting on speculation. If the group half is ever built, the
policy gains those four actions in the same change.

## 4. The trust policy — copied from the one that works, and pinned the same way

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

⚠️ **The `sub` pin is the security control, not a formality.** `sgharlow/relay` is a PUBLIC
repository. Without pinning to the `master` ref, any fork's pull request could assume this role.
`relay-kms-wall-ci` is pinned identically and `kms-wall.yml`'s header says so in the same words. The
OIDC provider already exists in account `461293170793` — it was created for that role — so this
proposal adds a role, not a provider.

## 5. 🔴 The recursion, which is the part most likely to be missed

`verify-iam.ts` states the rule that makes this necessary:

> **A principal absent from that list is audited by nothing**, so adding an IAM user to this account
> means adding a contract in the same change.

So creating `relay-iam-wall-ci` and stopping there would create a principal the IAM wall does not
watch — *using the IAM wall as the reason for creating it.* The build therefore includes a fifth
entry in `lib/ops/iam-wall.ts → CONTRACTS`, modelled on `KMS_WALL_CI_CONTRACT`:

| field | value |
|---|---|
| `kind` | `role` |
| `user` | `relay-iam-wall-ci` |
| `requires` | the eight read actions in §3 — losing one silently narrows the audit |
| `forbids` | any `iam:` action that writes; `dsql:*`; `kms:*` |
| `requiresConsequence` | *"The IAM wall cannot read the policies it audits, so it reports a clean account because it saw nothing."* |

The `requires` half matters more than it looks. `KMS_WALL_CI_CONTRACT` carries the same idea and
spells out why: losing a read *"turns that proof into a daily green that means nothing."*

## 6. What the workflow looks like

Structurally identical to `kms-wall.yml`, which means it inherits four properties already argued
for there: `permissions: id-token: write` mints the token and writes nothing to the repository;
`npm ci --omit=dev` installs the runtime dependency only; the script is invoked directly rather than
through `npm run verify:iam`, because that script name carries `--env-file=.env.admin`; and an
`if: failure()` step prints the diagnosis rather than leaving a bare red.

Two things it must carry that are specific to it:

- **The 60-day auto-disable account.** `lib/ops/alarm-of-record.test.ts` now derives its scheduled
  set from any workflow with a `cron:` line, so a new scheduled workflow that omits the phrase
  *"after 60 days"* fails the suite by name. That is a feature: the trap is met on the way in.
- **A `workflow_dispatch` input that can make it go red.** Both the canary and the scheduler monitor
  shipped carrying a comment claiming they could be proven on demand when their target was
  hard-coded and they could only ever pass; both were corrected on 2026-08-28/29. A `principal`
  input pointed at a name that does not exist proves the alarm fires.

**Cadence: daily.** Not derived from a deletion window the way the KMS wall's is — an IAM widening
is instant and has no waiting period — but from the same reasoning the cadence measurement
supports: the daily tier is the reliable one on this repo (`cadence-watch.yml` records every daily
workflow delivering 100% on the days the sub-hourly tier collapsed to 2–4 runs). A daily check
bounds the exposure of an unnoticed widening to one day. Anything faster buys hours against a risk
measured in days and joins the tier that does not run.

## 7. Cost, and what could go wrong

- **Money: none.** IAM read calls are free; a GitHub Actions minute a day on a public repo is free.
- **Blast radius if the role is compromised:** read-only visibility into this account's IAM policy
  documents. No write, no assume, no data.
- **The honest risk:** it is one more scheduled workflow inside the thing it watches — the same trap
  every alarm here shares (`deferred.the-alarms-live-inside-the-thing-they-watch`, B12). It does not
  make that worse, and it does not close it.
- **What it does NOT close**, so the ruling is not read as buying more than it does: resource
  scoping, permission boundaries and group-attached policies remain outside what `verify:iam` sees.
  All three are recorded in the script's header. Scheduling the check does not widen it.

---

## The ruling

> **Create `relay-iam-wall-ci` (OIDC, master-ref-pinned, the eight IAM read actions in §3) and
> schedule `verify:iam` daily — yes / no.**

**If yes**, Claude builds it in one change: the role and its two policies, the fifth `CONTRACTS`
entry, `.github/workflows/iam-wall.yml`, and a proof-of-red by dispatching it at a principal that
does not exist. It is the `kms-wall.yml` pattern with the actions swapped.

**If no**, the honest alternative is not "run it by hand" — that is the state being reported. It is
a dated cadence with an owner, so that *"nobody ran the IAM check"* is itself detectable. The
mechanism already exists in this repo: a stamp file plus a freshness dead-man, the shape
`verify-live-freshness.test.ts` uses. Say so and Claude builds that instead.
