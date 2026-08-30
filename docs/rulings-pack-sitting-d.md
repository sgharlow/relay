# The rulings pack — Sitting D, ready to run

**Drafted 2026-08-29 (ROADMAP Sprint 0, row 0.8).** Its whole purpose is that Sitting D costs Steve
*minutes rather than re-derivation*: every question below carries the measurement that makes it
answerable, a recommended default, and what happens if it is parked.

> **How this is delivered.** As batched `AskUserQuestion` calls, ≤4 per call, recommended default
> first, **D-1 before D-2**. Claude records every ruling in `PROJECT.yaml` the same session and
> executes them in blocking order over the following week.
>
> **"Park with a revisit date" is always a legitimate answer. Silence is not** — a question that is
> asked and not answered leaves the same gap as one never asked, plus the belief that it was
> handled.

> ⚠️ **Numbers here were derived on 2026-08-29 and are stamped with the command that produced
> them.** Re-run the command rather than trusting the figure; several of these moved during the day
> they were written.

---

## Changes since ROADMAP revision 4 wrote this list

Recorded so the sitting does not spend its first ten minutes on items that closed.

| Item | Was | Now |
|---|---|---|
| **B30** | on D-1 — "parser fix or a disposition" | ✅ **CLOSED 2026-08-29**, PR #25. Fix B merged, mutation-proven three ways. **Comes off D-1.** Fix A is not foreclosed: recording a disposition on `g1-caregiver-wtp` remains available and is no longer urgent |
| **B10** | "which filter rule trashes the alarm mail" | 🔴 **THE CORRECTION WAS ITSELF WRONG — re-measured 2026-08-30, the ORIGINAL question stands.** See the block below this table |
| **D21** | precondition unmet | ✅ precondition **met** 2026-08-29 — `relay-ro-policy` measured, carries no `kms:` action at all |
| **B27 / B31** | on the nod list | ✅ both **executed** 2026-08-29 |
| **D20** | "28 dangling rows" | still 28, and now **twice confirmed as residue** — newest orphan 2026-08-14, and 15 disposable accounts created/closed on 08-29 added zero |

### 🔴 B10 re-measured, 2026-08-30 — the correction above was wrong, and the way it was wrong is the lesson

**The alarm of record is in the bin, unread, and today's is in there with it.**

Measured read-only through the Gmail connector, `from:notifications@github.com
to:relay@noreply.github.com in:trash`:

| what | count |
|---|---|
| relay-addressed GitHub threads **in Trash** | **43** |
| of those, carrying the `relay-alarm` label | **6** — every one `UNREAD` **and** `STARRED` |
| the newest | **Cadence watch, 2026-08-30 14:31Z** — the monitoring-collapse alarm (B11) |
| others in Trash | Production canary · Scheduler heartbeat monitor · Delivery webhook monitor · KMS wall watch · CI (the T1 PR run) |

`relay-alarm` holds 21 messages, 12 unread. Six of them are in Trash. Gmail purges
Trash after 30 days.

**WHY THE 08-29 MEASUREMENT SAID THE OPPOSITE, AND WHY IT WAS NOT CARELESS.** It
watched three **deliberately dispatched** red runs and timed how long they took
to arrive: 23–37 seconds, inbox, labelled, starred. Every one of those
observations is true. What it measured was DELIVERY — and delivery was never the
problem. What happens to the mail *after* it lands is a different question, and a
stopwatch pointed at arrival cannot see it. The one alarm currently NOT in Trash
is `Reminder ladder monitor` at 06:14Z on 08-30 — which was itself a
`workflow_dispatch`, the same trigger type as the three that "disproved" B10.

⚠️ **So the pattern that matters is not delivery-vs-non-delivery. It is that the
alarms which fire UNATTENDED are the ones in the bin.** Every scheduled monitor
in the list above is a job whose entire purpose is to shout when nobody is
watching, and its shout is being filed where nobody is watching.

**WHAT IS STILL NOT KNOWN, and is the actual D-1 question.** The mechanism. These
messages carry `relay-alarm` and a star — filter actions — *and* `TRASH`. A
filter that labels, stars and then trashes is self-defeating; a human bulk-clearing
a mailbox would not usually leave starred mail unread. This connector is
**read-only at the OAuth scope** (verified: `untrash_thread` returns
`Insufficient scope`), and it cannot enumerate filters at all. Gmail → Settings →
Filters and Blocked Addresses is the only place the answer lives, and it is
Steve's browser.

**The generalisable lesson, and it is the third instance this week.** A finding is
disproved by measuring the thing it claims, not something adjacent to it. B10
claimed "the alarm mail ends up in Trash"; the disproof measured "the alarm mail
arrives quickly". Both can be true at once, and both are.


---

# D-1 — ✅ RULED 2026-08-30 · eight of ten answered

> **This section is a RECORD, not a set of questions.** The sitting ran on
> 2026-08-30, thirteen days before the 2026-09-12 date it was scheduled for —
> Steve asked for it early. Every ruling is recorded in
> `PROJECT.yaml → ratified.sitting-d1-2026-08-30`, which is authoritative; the
> answers below are a rendering of it.
>
> | # | Item | Ruling |
> |---|---|---|
> | 1 | **A1.3** | ✅ **§1a BINDS.** Op-ed in third person. The unratified 08-17 relaxation is struck |
> | 2 | **E4.1** | ✅ **Keep Initiate-only**, and say so in `/terms` — done 2026-08-30 |
> | 3 | **A0.dm / E4.4** | ✅ **Guard built** — `lib/ops/revisit-dates.test.ts` |
> | 4 | **D14** | ✅ **Leave it and say so.** Nothing to build |
> | 5 | **B15.4** | ✅ **Rungs ratified; self-naming refused at creation** — done 2026-08-30 |
> | 6 | **D20** | ✅ **Purged** 2026-08-30 — 28 counted, 28 deleted, 0 remaining |
> | 7 | **D25** | ✅ **Retired** 2026-08-30 — see `docs/retired-surface.md` |
> | 8 | **D3.3** | ✅ **MOOT, struck** — A0 happened 2026-08-29 |
> | 9 | **B11.2 / B12** | ⏳ **NOT ASKED.** The pack says not before 2026-09-02 |
> | 10 | **B10′** | ✅ **Answered by measurement**, not by ruling — the filter was read |
>
> ⚠️ **Item 10's answer inverted its own premise.** The question assumed a filter
> was trashing the alarm mail. The filter was read in Steve's browser on
> 2026-08-30: it stars, labels and marks important, and has **no delete action**.
> Seven alarms were restored from Trash the same session. What trashes them is
> not a rule, so "remove the rule" was never the remedy — see
> `deferred.the-alarm-of-record-delivers-to-trash`.


Ten items. **A1.3 goes first because it heads Sprint 2's critical path** — nothing in the demand
lane can be drafted until it is answered.

### Batch 1 — the two with hard dates behind them

**1. A1.3 — does §1a (third person) bind the editorial piece?**
The register says yes; the 2026-08-17 sprint report relaxed it **unratified**, so two documents
disagree and the op-ed cannot be finished until one wins.
*Default:* **yes, it binds** (the register is authoritative; the relaxation was never ratified).
*If parked:* Sprint 2's critical path does not start. This is the single highest-leverage answer in
the pack.

**2. E4.1 — are releases billing-gated on all four ARMED→PENDING paths, or only Initiate?**
`assertCanRelease` guards **1 of 4** today (Initiate only — not the missed-check-in sweep, not
owner consent to an access request, not silence on a challenge). `/terms` and guide §2.7 are silent
on paths 2–4, and one of them must be edited in the flip commit either way.
*Default:* none offered — this is a product decision, and both answers are defensible.
*Must precede* the first paywall revisit (from **2026-10-01**).

### Batch 2 — mechanisms that are currently silent

**3. A0.dm / E4.4 — make `revisit:` dates actually fire.**
Evidence, fresh: the beta-cohort `revisit: 2026-08-23` **lapsed unremarked** and was recorded six
days late (A3.7, 2026-08-29). It is the third deferral of that item and the first one nobody made —
the previous two were decisions, this was a date that passed. Nothing reads `revisit:`.
*Default:* **a guard reads `revisit:`** and fails when one is past with nothing recorded — same
shape as `gates.test.ts`. Also covers the 2026-10-01 paywall revisit, which is the next one at risk.
*Alternative:* promote A0 to a `gates:` entry (narrower — fixes one date, not the mechanism).

**4. D14 — the signup ceiling.**
`verify:live` performs exactly 10 signups into a 10/hour/IP limiter, so it runs at 100% of its own
ceiling; `verify:journeys` needs 5 more, which is why the chains must be an hour apart or have the
dev server restarted between them. Confirmed again on 2026-08-29 when both were run.
*Default:* **A — leave it and say so** (it is documented in CLAUDE.md, `verify-journeys-freshness.ts`
and the register; the cost is one restart).
*Alternatives:* B exempt reserved domains from the limiter (widens a real guard for test
convenience) · C = D4, a separate test cluster (infrastructure, has a cost).

**5. B15.4 — ratify the reminder rungs, and rule on owner self-naming.**
Three numbers were **chosen and documented, never measured**: rungs at 75% and 90% of the interval,
and the 12-hour cooling-off. Separately, an owner can name **themselves** as their own recipient or
verifier — `isEligibleVerifier` already refuses to count an owner toward quorum, so the runtime hole
is closed; what is open is that the row can still be created and the roster reads as fuller than it
is.
*Default:* ratify the three numbers as-chosen (they are reasonable and nothing contradicts them),
and **refuse the self-naming row** at creation.

### Batch 3 — data and surface

**6. D20 — the 28 dangling rows.**
Purge, or accept as a standing NOTICE. Twice-confirmed residue: `verifier_codes` 17,
`break_glass_codes` 10, `recipient_codes` 1 — **newest 2026-08-14**, left by hand-written
`DELETE FROM users` during the 08-08..14 fixture cleanup. On 2026-08-29, 15 disposable accounts were
created and closed and added **zero**, so both cascades work. `auth_challenges` was a fourth table
and **has emptied itself** — those rows expired, exactly as the register predicted.
*Default:* **purge** (Claude drafts the statements, Steve says GO, Claude runs them).
*Note:* it is a destructive production write with no undo, on rows nobody can reach. Risk of leaving
them is low; the argument for purging is that a permanently-red `verify:orphans` is a check that
stops being read.
Derive: `npm run verify:orphans`.

**7. D25 — FR9 `/api/demo/simulate`.**
Retire, or re-seed a demo account. `scripts/demo-run.ts` was bannered HISTORICAL on 2026-08-29
(B37): it needs a demo-owner session cookie that cannot be minted since `TOTP_SECRET` was retired.
*Default:* **retire**, recording the reason and replacement in `docs/retired-surface.md`.

**~~8. D3.3 fallback — if A0 has not happened by the restore drill.~~** ✅ **STRUCK 2026-08-30 — MOOT.**
A0 happened on 2026-08-29: the owner's vault holds a real item with real ciphertext and a wrapped
KMS key, so criterion 3 is satisfied by the real thing and the disposable-item fallback is
unnecessary. Struck with its date and reason rather than left to be re-read at a later sitting —
which is what would have happened, because a resolved question and an open one look identical in a
list.

### Batch 4 — the two that depend on a measurement not yet taken

**9. B11.2 / B12 — the monitor cadence, after the 2026-09-02 re-measure.**
Do not answer before 09-02. What is already known: delivery is **35.7%** of the nominal schedule over
the canary's whole life (684 scheduled runs against 1,914; median gap 31 min against a 15-minute
cron; max 697 min), and it collapsed further to **2 runs on 08-27 and 3 on 08-28**, coincident with
the account's Actions minutes hitting 100% (reset 09-01).
*If cadence recovers:* a payment method / plan on the GitHub account (money — Steve's), or accept the
monthly collapse.
*If it does not:* rule the off-GitHub heartbeat (Route 53 / CloudWatch Synthetics → SNS, 5-gate;
default build in Sitting H), **or** the B12.i interim only, with a revisit.
Derive:
```bash
gh api "repos/sgharlow/relay/actions/workflows/production-canary.yml/runs?per_page=100" \
  --paginate --jq '.workflow_runs[] | select(.event=="schedule") | .created_at' \
  | cut -dT -f1 | sort | uniq -c
```

**10. B10′ — the question B10 became.**
The old question ("which rule trashes the alarm mail") **has no answer, because nothing is being
trashed.** Delivery is proven: canary run `33237399208` → mail +37 s, scheduler-monitor
`33237979699` → +23 s, delivery-webhook-monitor `33237980971` → +23 s, all INBOX, all labelled
`relay-alarm`, all starred.
The real question is **why it works**, and nobody can say: the filter has never been read. Something
changed between 2026-08-25 (archived, unstarred) and 2026-08-29 (inbox, starred) and nothing records
what. A fix nobody can name can be undone by the same unrecorded hand.
*Default:* **connect the Claude browser extension** (Sitting E, ~2 min) so the `relay-alarm` filter
can be read read-only; no ruling needed beyond that.

---

# D-2 — before 2026-10-01 · ⏱️ ~60 min · the rest

Grouped so each batch is one call. None is dated; all are decisions that are currently silent.

### Batch 5 — money, small and recurring

| # | Item | Default |
|---|---|---|
| 11 | **B17** DR copy-job absence alarm (~$0.10/mo) | **yes**, executed in Sitting H |
| 12 | **B36** AWS Budget ≈ 2× fixed monthly cost → SNS (5-gate) | **yes**, Sitting H |
| 13 | **B19** CMK auto-rotation (~$24/yr) | enable, **or** record "stay off, deliberately" — the finding worth alarming on is nobody having decided |
| 14 | **B29** AWS Backup read-only OIDC role so `backup-status.mjs` can be scheduled | **yes**, Sitting H |

### Batch 6 — secrets and identity

**15. B18.0 — a secret-rotation cadence, or "none until first customer" with a revisit.**
All 26 production keys have `createdAt == updatedAt`; **nothing has ever been rotated.**
**16. B18.1 — the `autospecai` admin key.** Created 2025-06-29, **426 days old** as of 2026-08-29,
still Active. Derive: `aws iam list-access-keys --user-name autospecai`.
*Default:* rotate it (two-keys-valid overlap; Claude executes on request, no secret in chat).
**17. B20** — bring `infra/iam-policy.json` to the live v2 shape; does runtime keep `kms:DescribeKey`?
**18. D21** — place `.env.ro` in the Claude Code cloud env, or keep tracking. ✅ Precondition met:
`relay-ro-policy` measured 2026-08-29, carries **no `kms:` action at all**, which is the entire
reason the credential may sit somewhere less trusted than the laptop. Placement is Steve's.

### Batch 7 — product surface and policy

| # | Item | Default |
|---|---|---|
| 19 | **B22** `executor` role: refuse at the API, or amend Req 3.1 | refuse at the API |
| 20 | **B25** bulk session revocation: build, defer with a trigger, or accept "rotate `NEXTAUTH_SECRET`" | — |
| 21 | **B26** Q6 owner-branch `/api/kms/unwrap` under step-up? Q16 seed phrases in scope? | — |
| 22 | **B38** do Cloudflare (mail forwarding) and Google (Gmail) belong on `/privacy`? | **yes** |
| 23 | **E7** sales tax / Stripe Tax: register, threshold, or "accepted until first revenue" + revisit | accepted + revisit (revisit lands in Sprint 8) |

### Batch 8 — retention, ownership, and the un-ruled planks

**24. B21.3 — `csp_reports` retention.** Now has data: **43 reports in 26 distinct violations** on
2026-08-29 (`npm run verify:csp`), of which **2 are ENFORCED** — both `vercel.live`'s Toolbar, which
injects only for logged-in Vercel team members, so not a customer-facing defect. The table never
prunes and has a public unauthenticated writer (20/min/IP).
*Default:* prune by `ts` after **30 days**.
**25. G4** — mobile: assign a trigger, or strike it from §2-G.
**26. B41 / B42** — who watches `hello@` when you are unreachable; Reply-To `hello@` vs `relay@`.
**27. F-l** — the abandon-after-seed nurture branch: give it a §2-F unlock, or strike it.
**28. D23 / D26 / G9 / G10 / G11** — state what the 2026-10-21 review reviews; migration ledger
"accepted-not-planned"; dispositions on the un-ruled Build Spec planks (§18, §19 incl. DPA/SOC 2,
§20–22, §23/24 + `business`/`travel` selectable), Req 13.6, the two design decisions.

---

## Prepared and waiting: the C1.0 DNS change

Row 0.8 also asks for this to be **ready to execute on request**, under `/safe-execute`. It is not a
ruling — it is a change to a working system, so it carries the 5-gate shape.

**The problem, measured 2026-08-29:** `_dmarc.relaystandby.com` is exactly `v=DMARC1; p=none` —
**no `rua=`**, so no aggregate report can arrive from any receiver. Corroborated independently by the
mailbox: the newest of ten reports is **2026-08-17**, and nothing has arrived in the twelve days
since, on a domain that had been receiving them daily from both Google and Microsoft.

| Gate | Answer |
|---|---|
| Documented problem | Yes — the feed is dead; both DNS and mailbox agree |
| Rollback < 10 min | Yes — restore the single TXT record to its current exact value |
| Snapshot before | The current record value, captured verbatim below |
| Tested in isolation | DoH read before and after; no other record touched |
| Steve requested | **Not yet — this is prepared, not proposed** |

**Snapshot (verbatim, 2026-08-29):** `_dmarc.relaystandby.com  TXT  "v=DMARC1; p=none"`

**The change:** add a `rua=` tag pointing at `dmarc@relaystandby.com`, leaving `p=none` alone.
Stepping up to `quarantine` is a *separate, later* decision that must not ride along — doing it
before reports accumulate is taking the step blind, which is what the deliverability doc has said
all along.

**Proof, before and after:**
```bash
node -e 'fetch("https://cloudflare-dns.com/dns-query?name=_dmarc.relaystandby.com&type=TXT",{headers:{accept:"application/dns-json"}}).then(r=>r.json()).then(d=>console.log((d.Answer||[]).map(x=>x.data).join(" ")))'
```
Then wait for one report cycle (~24 h) and confirm arrival with a read-only Gmail search:
`from:(dmarcreport@microsoft.com OR noreply-dmarc-support@google.com) to:dmarc@relaystandby.com`
— the newest date is the health of the feed.

⚠️ **The filter is not the fix, and the order matters.** `docs/outlook-sender-support-submission.md`
Step 0 and `go-live-checklist-steve.md` 10.1 both put the Gmail filter first. A filter protects a
stream that has stopped. The DNS record comes first; everything else in that lane is downstream
of it.
