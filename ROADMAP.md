# Relay — Production Roadmap

**Revision 6 — 2026-08-30.** An IN-PLACE revision, as §8 asks. Four sprints executed in one day
and **six claims in this file are now false**. They are corrected where they stand; this header is
the index of what moved, so a reader of revision 5 knows what not to trust.

| What this file said | What is true on 2026-08-30 |
|---|---|
| Sprint 1 row 1.2: **"untrash the three reports in Trash"**, hard expiry ~09-14 | 🔴 **NON-TASK.** Twelve DMARC threads exist and **none is in Trash**. §0.0 row 7 got this right on 08-29 and this table was never updated to match — the same drift, in the same document, one section apart. **Struck.** |
| §0.5: quorum unsatisfiable **"until Ben accepts"** | 🔴 **WRONG, and worse.** There is no invitation. April and Ben have `standby_state = NULL` and `audit_log` holds **zero** invitation actions, ever. Adding a person on `/circle` writes a roster row and nothing else. Nobody was waiting on Ben; Ben does not know. |
| §0.0 row 1: B10's premise **"false — delivery works"** | 🔴 **The disproof measured the wrong thing.** It timed three *dispatched* runs arriving in 23–37 s. 43 relay threads were in Trash, six carrying `relay-alarm`, all unread — including that day's Cadence-watch alarm. **The alarms that fire unattended are the ones in the bin.** Seven restored 08-30; the filter was read and has **no delete action**. |
| §2-C: `_dmarc` carries no `rua=` | ✅ **FIXED 2026-08-30.** Now `v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1`, confirmed from two independent resolvers. `wired`, not yet `live-proven` — it closes when a report arrives. |
| §2-D / D20: 28 dangling rows | ✅ **PURGED 2026-08-30** on Steve's GO. 28 counted, 28 deleted, 0 remaining. `verify:orphans` **exits 0 for the first time**. |
| §2 has **no testing lane** | ✅ **Added and shipped** — see §2-T below. |

**Sprint 1 ran on 2026-08-30**, thirteen days early, at Steve's request. Eight of the ten D-1
rulings are recorded in `PROJECT.yaml → ratified.sitting-d1-2026-08-30`; item 9 was not asked (not
before 09-02) and item 10 was answered by measurement. Five have been executed since.

> ### §2-T — the testing lane, shipped 2026-08-30
>
> Revision 5's §2 inventory ran A through H with **no testing section**, so the largest engineering
> gap in the repository was not on the plan at all. It is now closed:
>
> - **T1** — the request layer executes under test. `src/app/api/**` went **66.15% → 86.81%**
>   statements and **26 → 0** handlers at 0%, with a per-layer floor (`npm run check:route-coverage`)
>   so it cannot regress behind `lib/`'s mass. PR #34.
> - **T2** — `/api/health/orphans` + a daily monitor, closing the half of D4 this file called
>   *"a smaller and more useful thing than the cluster"* — with no cluster and no credential. The
>   browser walks also stopped depending on one laptop's `__shared-tools` path. PR #35.
> - **T3** — browser-walk screen coverage is now **derived (5/17)** rather than remembered, and the
>   `/triggers` quorum screen is walked and live-proven. PR #36.
>
> ⚠️ **D4 was already ruled** — 2026-08-20, defer the test cluster until the first paying customer.
> This file's §2-D describes it as an open decision because it reads `blocked_on:` and stops, forty
> lines above the `ruled:` block. Corrected here rather than in place, because the entry itself is
> chronological and worth keeping that way.

**Revision 5 — 2026-08-29.** An IN-PLACE revision of revision 4, not a rewrite: §8 asks that a
closing sprint be struck "with a date and a commit, in place", and most of revision 4's body is
still accurate. What changed is concentrated in §0.0 (which of revision 4's own claims survived
being looked at), §0.5 (the gap to production, restated), §3 (Sprint 0 closed) and §4 (four dated
rows were wrong). Read those four; the rest of revision 4 stands.

**Revision 4 — 2026-08-27.** Written from a nine-lane read-only sweep of the repository, the
register, every planning document, the CI estate, the memory files and the live system, taken on
2026-08-27 (HEAD `618095c`, working tree clean at sweep time, production deploy
`dpl_4L8sD6jmxoAr27ppFLQAYx648qGv` at the same commit). **This revision lands via a PR** — `master`
is protected — and is not the record until merged. Dates are local (UTC−7); timestamps written with
a `Z` are UTC (2026-08-28T02:50Z is the evening of 08-27 local). Revision 3 (2026-08-20) planned; this revision re-measures, corrects what
revision 3 got wrong, inventories everything that remains, re-sequences it by dependency and
impact, and carries — for the first time in one place — **the single checklist of every manual step
that cannot be automated** (§6).

> **Authority.** Every checkable number, threshold, date, owner and ruling lives in `PROJECT.yaml`.
> This file is a *plan*, not a record. Where the two disagree, `PROJECT.yaml` is right and this file
> has a defect. Measurements quoted here carry their date and the command that produced them, so a
> reader re-runs rather than trusts. **Nothing in this file is a ruling** — items marked *decision*
> are Steve's to make and are listed so they can be made, not so they can be assumed.

> **State of the project, 2026-08-27.** Relay is **resumed, not parked**
> (`ratified.relay-resumed-2026-08-21` supersedes `ratified.relay-parked-60-days-2026-08-22`; the
> park stood ~2h37m by `git log` — the two entries' `date:` fields mix time bases, trust the commits
> `0a8575d` → `d710b06`). **report-bridge's 2026-09-12 GO-LIVE keeps precedence for Steve's
> attention** (ruled 2026-08-24): Claude-court and custodial work proceeds now; every Steve-hands item
> queues to **2026-09-12**, the first day that ruling stops applying. This roadmap is built around
> that date.

---

## 0.0 The question revision 4 left — which "proven" claims had been SEEN?

Revision 4 closed §8 by instructing its successor: *"The next revision should open by asking which
of its own 'proven' claims have been **seen**."* This is that answer. Nine claims were tested
against live evidence on 2026-08-29. **Six did not survive.**

| # | The claim, as recorded | How it was "proven" | What was SEEN, 2026-08-29 | Verdict |
|---|---|---|---|---|
| 1 | The alarm of record delivers to Gmail **Trash** (B10) | one mailbox read, 08-27 | three deliberate red runs reached the **INBOX** in 23–37 s, labelled and starred; `in:trash` returns nothing on any domain; the cited evidence mail carries no TRASH label | 🔴 **premise false** |
| 2 | The monitors collapsed because of **Actions minutes** or a GitHub incident (B11) | two coincident events | every **daily** workflow delivered 100% on precisely the days the sub-hourly ones fell to ~3% | 🔴 **both causes disproven** — and the planned response was to spend money |
| 3 | The canary is **proven red** | exit code 1 in a unit test | it had never been red in 688 runs; forced red for the first time on 08-29. The other two monitors **could not be forced red at all** | 🔴 true of an exit code, not of an alarm |
| 4 | A broken deploy is caught **within a quarter of an hour** | the cron expression | 35.7% delivery over the canary's life; median gap 31 min, max 697 min; **~5 runs/day right now** | 🔴 **false by an order of magnitude** |
| 5 | `verify:kms` is **NOT IN CI** | the script header | it has run daily via GitHub OIDC since 2026-08-24 | 🔴 false in the expensive direction: it said the safety net did not exist |
| 6 | **D10** (the journey sweep) is **closed** | the walks were built | nothing scheduled or aged them; the chain could have been dead from the day after and the register would still have read closed | 🔴 closed on construction, not on a run |
| 7 | Three DMARC reports sit in Trash, expiring mid-September | a memory read | **nothing is in Trash.** The feed is dead at the DNS record instead — `_dmarc` carries no `rua=`, and the newest of ten reports is 2026-08-17 | 🔴 **wrong problem entirely** |
| 8 | Extending `verify:funnel` to assert the collector returns **2xx** would prove the demand instrument is alive (A7.0's own prescription) | reasoning | the collector answers **200 to everything** while the query API refuses the project outright | 🔴 the prescribed check would pass on an instrument that collects nothing readable |
| 9 | The **dead-man's switch** works | unit tests calling `runHeartbeatSweep` directly | ARMED → PENDING observed for the first time, driven by production's own cron at 2026-08-29T21:00:08Z, both transitions in the hash-chained audit log | ✅ **now genuinely seen** |

**The generalisable lesson, sharpened.** Revision 4 wrote: *a monitor is proven when its failure has
been seen by a human, not when its process has been seen to exit 1.* Row 7 extends it — **a finding
is proven when the thing it describes has been looked at, not when it was written down carefully.**
Rows 1, 2 and 7 were all recorded with dates, evidence citations and confident prose, and all three
were about a state of the world that had already changed or never existed.

---

## 0.5 The gap to production, restated against §1

§1 defines production as three things. Measured 2026-08-29, here is the distance to each.

### ~~🔴 The frame that reorders everything: the custodial obligation is currently owed to NOBODY~~ — ✅ **RESOLVED 2026-08-29**

The one live, paying, non-demo owner holds **0 vault items, 0 recipients, 0 verifiers, 0 access
rules and 0 `release_state` rows** (`relay_ro`, 2026-08-29). Every guarantee this document tracks —
envelope encryption, the release state machine, verifier quorum, the dead-man's switch, the audit
chain — is presently doing nothing for the only person relying on the product.

> ✅ **A0 WAS DONE THE SAME DAY THIS WAS WRITTEN, and this section is kept as the argument that
> moved it rather than deleted as stale.** `verify:dogfood` reads READY: 1 vault item with real
> ciphertext and a wrapped KMS key, April as recipient, Ben as verifier, one reversible access rule
> under `emergency`, and an ARMED `release_state`. The custodial machinery is no longer protecting
> an empty box.
>
> 🔴 **But the plan still cannot COMPLETE a release.** `countEligibleVerifiers` returns **M = 0**
> against **N = 1**. 🔴 **CORRECTED 2026-08-30: not because Ben has not accepted — because Ben was
never asked.** `standby_state` is NULL for both people and `audit_log` holds zero invitation
actions, ever; adding somebody on `/circle` writes a roster row and sends nothing. A trigger
> firing today would reach GRACE and stop there for good. Nothing leaks — GRACE is where verifiers
> are asked, not where access opens — but "the vault is set up" and "the plan would work" are two
> different claims, and only the first is now true.

That is not an argument for doing less custodial work; the obligation binds from the first
stranger's first credential and the stranger is what the demand lane exists to produce. It is an
argument about **A0's priority**. A0 has been carried as "the thing that unblocks the cohort". It is
larger than that: **A0 is what makes every other guarantee in this file non-vacuous.** Until the
owner's own vault is real, the entire custodial programme is a set of promises about an empty box,
and the restore drill, the reminder ladder and the release machinery are all being verified against
fixtures because there is nothing else to verify them against.

### 1. `dogfooded` → `customer-used` — gate `g1-arms-length-demand`, due 2026-12-31

**Distance: one Steve sitting, then a fortnight of sends.** Unchanged in four revisions, and the
reason is unchanged: A0 blocks it, A0 is ~20 minutes, and A0 has not happened.

| blocker | state 2026-08-29 | owner |
|---|---|---|
| ~~A0 the owner's vault~~ | ✅ **DONE** — `verify:dogfood` READY, all six green. ⚠️ quorum still unsatisfiable (M=0 vs N=1) — **and 2026-08-30 found why: no invitation was ever sent.** `readStandbyState(null)` renders an uncontacted person as `invited`, so the roster read as if they had been asked | steve, **closed** |
| A1 op-ed → caregiver.com | unsent; §1a third-person ruling still owed (D-1 item 1) | steve |
| A3 beta cohort | `.relay-cohort.json` untouched since 08-18 18:17, still untracked; no codes file; **third deferral lapsed unrecorded** | steve |
| A7.0 the instrument | 🔴 collects nothing readable — see below | steve (one toggle) |

### 2. `customer-used` → `revenue-proven`

**Distance: two rulings and a key, all dated.** E4.1 (are releases billing-gated on all four
ARMED→PENDING paths, or only Initiate?) must precede the 2026-10-01 paywall revisit; E4.2 is that
revisit; `verify:stripe` is live-proven but **unschedulable** until a restricted read-only key
exists, and its only other read path — the paired Stripe CLI — **expires 2026-10-07**, after which
the billing contract has no read path at all.

### 3. The custodial obligation — the four clauses, scored

> *"the front door holds, the key material cannot be lost, a failure is noticed by a machine before
> a customer, and what the product says about itself is true."*

**"The front door holds" — substantially true, with one asymmetry.** `verify:live` (5 walks) and
`verify:journeys` (3 walks) both ran green against production on 08-29 and both now carry freshness
dead-mans. The IAM wall read the real account (B16). Secret scanning and push protection are on, 0
alerts on a repo public since June.
🔴 **The asymmetry: `verify:kms` runs daily in CI; `verify:iam` runs when somebody remembers.** An
`aws iam create-policy-version` putting `dsql:DbConnectAdmin` back is exactly what that check
exists to catch, and it would be invisible until a human ran it. The obstacle used to be that CI
had no AWS credentials — `kms-wall.yml` disproved that on 08-24 by reaching AWS from a runner with
**no stored secret**, via OIDC. The precedent now exists and the wall is still unwatched.

**"The key material cannot be lost" — the watching is real, the recovery is untested.**
`verify:kms` is daily, live-proven, and has been seen to fail three ways. But
**`gates.d3-restore-drill` has never run** (due 2026-11-08, a ceiling), so "the data is gone" is the
one runbook in this repo that has never been exercised — and its criterion 3 is itself blocked on
A0. The single-region CMK limitation (B3) remains knowingly accepted.

**"A failure is noticed by a machine before a customer" — 🔴 THIS IS THE LARGEST OBLIGED GAP.**
Production has **no effective synthetic monitoring**. The canary delivers ~5 scheduled runs a day
against a designed 96; the detection window for a broken deploy is 5–6 hours, not the quarter-hour
the cron asks for. `cadence-watch.yml` (2026-08-29) now *reports* this daily — but reporting is not
repair, and the repair is no longer optional-shaped: the money option was the plan and it is
disproven, so **B12 (an off-GitHub heartbeat) is now the only remaining fix rather than one of
two.** Secondary: `date-guards` has never been seen red, blocked structurally by the pre-push hook.

**"What the product says about itself is true" — much repaired, three holes left.**
Fifteen false or stale statements were corrected on 08-29 (the canary's cadence claims, seven
credential headers sending operators to the write identity, `verify-kms`'s "NOT IN CI", the DMARC
lane's order of work, B10's premise, A7.0's prescription). What remains:
- 🔴 **A7.0** — the site looks instrumented and collects nothing readable. On placement day this
  presents as an empty dashboard beside a site that appears to be reporting correctly, and the
  number cannot be re-collected. Hard precondition of Sprint 5.
- 🔴 **E1′** — the lapse notice is `wired`, not `live-proven`; `/terms` and the paywall decision
  both rest on it.
- 🟡 **README's "verifier deny/abstain" rung** overstates what is proven: B15.2 and B15.3 remain
  unexercised.

### 🔴 The reminder ladder — never fired, and UNREACHABLE for the only owner

The check-in reminder ladder (J5-R4) has **never fired for anyone**: `owner_checkin_reminder_first`
and `owner_checkin_reminder_final` have **zero rows in `audit_log`, ever**. The live paying owner
was last active 2026-08-10 on a 30-day interval, so:

| when | what | derived from |
|---|---|---|
| **2026-09-01 16:32Z** | the **75% rung** fires — first reminder this product has ever sent | `last_active_at + 0.75 × 30d` |
| 2026-09-06 04:32Z | the 90% rung | `× 0.90` |
| 2026-09-09 04:32Z | the owner goes overdue; the sweep selects them and **transitions nothing**, because they hold 0 `release_state` rows | `heartbeat.ts` inner query |

`sweepCheckinReminders()` is called by the cron and **never throws, by design** ("belt and braces").
So its failure mode is a 200, a healthy `scheduler_runs` ledger, and a customer who is never
reminded. That is B15.1's unexercised half, and it is walkable with a disposable owner — the same
pattern that proved the sweep on 08-29.

> 🔴 **CORRECTED WITHIN THE HOUR, 2026-08-29 — THE 09-01 FIRING WILL NOT HAPPEN, and the reason
> makes the vacuity finding above complete.**
>
> `CANDIDATE_SQL` in `lib/release/checkin-reminder.ts` does not read every owner in the timing
> window. It requires, as its last clause, that the owner hold an **armed `release_state` of a
> user-selectable type**. The live owner holds none. Measured, not reasoned — the real query, run
> read-only against production:
>
> - reminder candidates right now: **0**
> - the same query with the armed-release clause removed: **1** (the live owner)
>
> So the owner is in the 50–100% window exactly as computed, and is **not a candidate**. No
> reminder fires on 09-01, 09-06, or at all.
>
> ⚠️ **This is the second overstatement in this area in one session, and both had the same shape:
> arithmetic done correctly on a gate that was never checked.** The first said the sweep would arm
> their triggers on 09-09 (it iterates an empty set). The second said the ladder would fire on
> 09-01 (they are not a candidate). §0.0's own lesson — *a finding is proven when the thing it
> describes has been looked at, not when it was written down carefully* — was written in this file
> and then broken twice in the same file, by the same author, within the hour. The rule is easy to
> state and evidently hard to keep.
>
> **What the correction leaves is stronger, not weaker.** The live paying owner receives NOTHING
> from any part of the custodial machinery: no reminder (not a candidate), no sweep transition (no
> armed rows), no release, no verifier notice. The product is completely inert for its only user,
> and every one of those traces to A0.
>
> ✅ **AND IT MAKES A0 SELF-PROVING.** The owner is already at ~79% of a 30-day interval, past the
> 75% rung. The moment A0 configures a trigger, they become a candidate **while already past the
> first rung** — so the first check-in reminder this product has ever sent fires on the next hourly
> cron, to a real address, unprompted. A0 is therefore not only the thing that makes the guarantees
> non-vacuous; it is the cheapest live proof of the reminder ladder available, and it costs one
> email to Steve's own inbox.

⚠️ **A correction to an earlier reading of this, recorded rather than quietly fixed.** It was first
stated that on ~09-09 the sweep would "arm their triggers, unattended, at night, for real". That is
**wrong**: the owner has no `release_state` rows at all, so the sweep finds them overdue, iterates
an empty set and does nothing. The true finding is smaller in blast radius and sharper in meaning —
nothing fires because there is nothing configured, which is the vacuity described at the top of
this section.

---

## 0. What this revision measured, and what it changed

### 0.1 The measurement revision 3 asked for first

Revision 3 closed with an instruction to itself: *open the next revision by measuring §2-A's
movement, because if the demand lane is unchanged again, no amount of re-sequencing below it is the
reason.* Measured 2026-08-27:

| demand-lane item | state 2026-08-20 | state 2026-08-27 | evidence |
|---|---|---|---|
| A0 owner's vault | empty, 5 pieces missing | **empty, the same 5 pieces** | `npm run verify:dogfood` (relay_ro) |
| A1 op-ed → caregiver.com | voice pass "planned 2026-08-19" | **unsent; rows 1–2 still ⏳** | `docs/oped-angle-3-draft.md` send checklist; no commit since 2026-08-18 |
| A2 The Caregiver Space | not started | **not started** | same |
| A3 beta cohort | one person, no codes file | **one recipient, no verifier, no `.relay-cohort-codes.json`** | `ls .relay-cohort*.json` |
| A6 G3 outreach → meetings | ratified 08-20, no send | **no send, no meeting, no log** | `docs/g3-partner-dossier.md` untouched since `5122150` |
| `caregiver_leads` | 0 | **0**, window not started | `npm run flight:snapshot` |
| Phase 0 claim conversion N | 0 since 2026-08-12 | **0** | `.relay-cohort-codes.json` absent |

**Zero movement, for the third revision running.** Every row above is Steve's court, every row was
outranked by report-bridge by an explicit ruling on 2026-08-24, and the ruling expires on
2026-09-12. That is the whole shape of this revision: the engineering lane is nearly spent, and the
plan below is organised around making **2026-09-12 → 2026-10-01** the fortnight in which the demand
lane finally fires, with everything Claude can do beforehand done beforehand.

### 0.2 What closed between revisions (2026-08-20 → 2026-08-27)

Derive, never trust: `npx tsx -e "const y=require('yaml');const f=require('fs');const p=y.parse(f.readFileSync('PROJECT.yaml','utf8'));const d=p.deferred??[];console.log(d.length+' total, '+d.filter(x=>!x.resolved&&!x.closed).length+' open')"` → **32 total, 9 open** on 2026-08-27.

- **D10** journey sweep — closed by *building* the J3/J6/J9 walks (`npm run verify:journeys` — the three walks print their own counts; run it an hour apart from `verify:live`) plus `/circle` cover in `e2e-ui`. The walks found **D13** (approve unreachable before the
  first rule — **fixed, ruled option C, live-proven 33/33**) and **D14** (the chain runs at 100% of its
  own signup limit — *ruling still owed*).
- **D15** `verify:kms` could not run its own declared command — fixed same day; and the KMS wall
  watch is **now really scheduled** (`.github/workflows/kms-wall.yml`, daily, GitHub OIDC → role
  `relay-kms-wall-ci`, no stored secret, proven green *and* red 2026-08-24, PR #13). Two ratified
  entries had credited it as running while nothing ran it (PR #15 is the correction).
- **D11** every secret's age — closed; every cell of `docs/secret-rotation-runbook.md` carries a date.
- **`gates.d3-restore-drill`** — **ratified** 2026-08-21 (due 2026-11-08 as a ceiling). The drill has
  *not* run.
- **`gates.g3-b2b2c-pilot-loi`** — **ratified as amended** 2026-08-20 (wealth manager dropped;
  Homethrive → Wellthy, NAC in parallel; due 2026-11-30; kill on *meetings*).
- **Editorial thresholds** — ratified 2026-08-20 (pass ≥6% @ N≥50 · kill <2% @ N≥150 · floor 50).
- **E1′** — the live Stripe endpoint was found **unsubscribed** to `invoice.payment_failed` and fixed
  2026-08-21; the notice + dedupe are live-proven by direct call; the *webhook leg* is still unproven
  and the prescribed `stripe trigger` method is proven incapable of proving it.
- **`verify:live`** re-stamped 2026-08-25 at `ce776ef`; `verify:orphans` clean of accounts.
- **Sprint 1's calendar lapsed 2026-08-24 by ruling**, recorded (PR #16), revisit 2026-09-12.
- Branch protection on `master`, the read-only identity `relay_ro` (`.env.ro`), and the
  three-file env split — all shipped 2026-08-21.

### 0.3 Revision-3 defects corrected here (the register wins on every one)

Listed so the next reader does not inherit them from an older copy:

1. Banner: *"the KMS wall watch … ran throughout"* the park — **false**; nothing scheduled it until
   2026-08-24 (`ratified.relay-resumed-2026-08-21.corrected`).
2. `verify:live` dead-man "~2026-09-03 / ~2026-09-04" — **~2026-09-08** (newest stamp
   2026-08-25T03:05Z + 14 days). Derive: `tail -1 docs/verify-live-runs.jsonl`.
3. §2-E E1 *"deduped on the Stripe **event** id"* — the dedupe key is the **INVOICE id**, and the
   difference is the whole test (retries carry a new event id for the same invoice).
4. C1 DMARC *"filter + untrash before ~2026-09-10, 2 minutes"* — the 08-11..13 batch **was** rescued
   on 2026-08-15; the **filter was never created**, so three newer reports (08-15, 08-16, 08-17 —
   the last is the A/B-test evidence) are in Trash **now** with a real expiry **~2026-09-14..16**.
   And, found 2026-08-27: **`_dmarc.relaystandby.com` no longer carries `rua=`** — no new report can
   arrive at all (see C1.0).
5. §0/§1 *"`ladder: dogfooded` is a claim about 2026-06-27"* — `ladder_evidence.as_of` is
   **2026-08-08** (the all-ten-journeys walk); 2026-06-27 is the separate H0 dogfood.
6. Sprint 3 row 3.4 *"the d3 gate needs ratifying"* — ratified 2026-08-21. B4 *"still to do: fold
   into D3"* — folded, as criterion 2. E3 *"owner-reminder ladder gated with F-d"* — the ladder
   **shipped** 2026-08-21 (`lib/release/checkin-reminder.ts`, `wired`, not live-proven).
7. §0 *"g3 is still PROPOSED, ratify_by 09-01 the nearest obligation"* — ratified 08-20; Sprint 2's
   09-01 calendar anchor was therefore **spent** before revision 3 was a day old, and 2.4–2.9 carried
   no date at all. §1 *"one ratified exception"* — there are two (`journey-safety-subset-2026-08-21`).
8. Sprint 3 *"Claude's court, no dependencies … done when the drill has run and E1 is live-proven"* —
   3.4 and 3.6 are Steve's, and the drill's gate is due 2026-11-08, not 2026-09-05.
9. §2-B/§2-C closure dates read 2026-08-19 where the register's `closed.date` is 2026-08-20.
10. Sprint 1 cites `__project-docs/relay-vault-checklist-SPRINT-1.md` — a file **outside the repo**
    whose banner still says PARKED. Corrected in the same pass as this revision.

### 0.4 New findings, 2026-08-27 — none of these was in revision 3

Each is entered in §2 with an ID; the ones that need a register entry are flagged 📝.

- 🔴 **The alarm of record delivers to Gmail TRASH.** Every `[sgharlow/relay] Run failed` mail since
  2026-08-08 — including the 2026-08-25 KMS-wall red-proof and the 2026-08-08 scheduler red-proof —
  sits in Trash, about half unread — derive: Gmail `subject:"[sgharlow/relay] Run failed" in:trash`
  (≈20 threads, oldest 2026-08-08). Exit 1 was proven; *delivery to a watched inbox* was not. (B10 📝)
- 🔴 **The scheduled monitors are collapsing.** Canary runs per UTC day 45→2 over 08-18..08-27
  against 96 designed; scheduler-monitor 30→3 against 48 (derive:
  `gh api repos/sgharlow/relay/actions/workflows/<wf>.yml/runs?created=<day> --jq .total_count`). GitHub is not queueing them — it is not
  creating them. Coincident: the account's 2,000 Actions minutes hit 100% at 2026-08-28T02:50Z (reset
  2026-09-01). Nothing in the repo could have said so. (B11 📝)
- 🔴 **`_dmarc.relaystandby.com` = `v=DMARC1; p=none`** with **no `rua=`** (two independent
  resolvers, 2026-08-27). Every doc records `rua=mailto:dmarc@…`; no record of the change exists.
  Until restored, C1's step-up prerequisite cannot be met and the Outlook submission's "we read your
  aggregate reports" sentence is false. (C1.0 📝)
- ⚠️ **Latent CI red on 2026-10-03:** `gates.g1-caregiver-wtp` is superseded but carries
  `due: 2026-10-02` with no `met:`/`declined:`; `lib/ops/gates.test.ts` has no notion of
  `superseded_by:` and will report it overdue — turning `date-guards` **and** the required `verify`
  check red. (B30)
- ⚠️ **Nothing turns red on 2026-09-12** (A0's revisit) or **2026-10-01** (the paywall revisit): no
  guard reads a `revisit:`. (A0-dm, E4.4)
- ⚠️ `production-canary` has **never been proven red** (685 runs, 0 failures; its `base_url`
  dispatch input post-dates its only dispatch); `delivery-webhook-monitor` and `date-guards` have no
  way to be forced red at all. (B13)
- ⚠️ `verify:journeys` has **no freshness dead-man** — D10 was closed by building walks that nothing
  schedules or ages. (B14)
- ⚠️ `npm run verify:iam` has **never read the real `relay-ro-policy`** — the "no `kms:*`" property
  that makes `.env.ro` placeable anywhere is a claim about the checker. (B16)
- ⚠️ **Nothing in production has ever been rotated**; no cadence exists; the `autospecai` admin key
  is 424 days old. (B18)
- ⚠️ The DR vault's copy jobs have **no absence alarm** (only failures alert). (B17)
- ⚠️ Four Steve rulings exist only in prose, on no checklist and in no register entry: the paywall
  flip gates **1 of 4** release paths; FR9 `/api/demo/simulate` is unreachable dead surface; the
  three chosen-not-measured numbers (75%/90% rungs, 12h cooling-off) and owner self-naming. (E4.2,
  D25, B15.4)
- ⚠️ Stripe CLI session keys (the only non-dashboard read path into the shared account) **expire
  2026-10-07** — six days after the paywall revisit. (E1.8)
- ⚠️ Repository security settings on a PUBLIC repo are all off (secret scanning, push protection,
  Dependabot alerts); CI runs no `npm audit`, so the advisory that would reopen D12 has no feed. (B27)
- ⚠️ **The G1 instrument may have no sink.** The Vercel API answers `web_analytics_not_enabled` for
  the relay project on both the `events` and `visits` datasets, while the edge serves
  `/_vercel/insights/script.js` and `verify:funnel` asserts only that `window.vaq` was filled — never
  that the collector accepted the event. No document records Web Analytics being enabled or a number
  ever read from the dashboard. Resolve before any placement (A7.0). The same API *does* expose custom
  events by `src`, so the flight-log's two "human" cells are Claude's once collection is confirmed.
- ⚠️ The live paying owner's **recovery codes were never regenerated** — verified read-only under
  `relay_ro`: 8 codes, all created 2026-08-09T01:36Z, none since, none used (B33).
- ℹ️ 12 local + 4 origin branches are fully merged (0 ahead; a fifth origin name is a stale tracking
  ref — `git fetch --prune`) — the "unknown unmerged work" question is closed. `executor` is hidden in
  the UI but still accepted by `POST /api/recipients`. Vercel runs Node 24 while CI tests on 22.
  `.env.dsql` holds cluster endpoints/ARNs only (no credentials; documented in CLAUDE.md) — nothing to
  do. `/api/health` is 404 by design (the health surface is `/api/health/scheduler` and
  `/api/health/delivery-webhook`).

---

## 1. What "production" means for this project

Unchanged in substance from revisions 2 and 3, restated because every sequencing decision below
descends from it.

Relay is already **deployed, live, taking live-mode payments**, walked end to end against
production, backed up daily with a proven absence alarm, and guarded by a release gate in two proven
halves (`npm run gate` in CI; the five-walk `verify:live` chain with a 14-day freshness dead-man).
So "moving into production" is **not a deployment problem**. It is:

1. **`dogfooded` → `customer-used`** — one arms-length person uses Relay. Gate
   `g1-arms-length-demand` (owner steve, target 1, due 2026-12-31, kill: zero → park D2C; B2B2C-only
   or archive). Precondition, still unmet: the owner's own vault must be real (A0).
2. **`customer-used` → `revenue-proven`** — arms-length money moves. Chain (as amended 2026-08-16):
   **G1 ∥ G3 → G4 billing MVP → G5 audited crypto**; G4/G5 enter `PROJECT.yaml` once G1 passes.
3. **The custodial obligation** — from the first stranger's first real credential, Relay owes a
   standard that has nothing to do with demand: the front door holds, the key material cannot be
   lost, a failure is noticed by a machine before a customer, and what the product says about itself
   is true. Revision 3 called this "substantially discharged". Revision 4's sweep found the *alarm
   path* — the thing that makes "noticed by a machine" true — has a hole at the last hop (§0.4). That
   is obliged work and it leads Sprint 0.

### The test that separates barred work from obliged work

> **Barred (horizontal build):** adds a capability the product does not have, in the hope somebody
> wants it. Justified by a *forecast*.
>
> **Obliged (custodial integrity):** makes an *existing* capability or promise actually true and safe
> for the people already using it. Justified by a *property of the live system*; would still be
> justified if no new user ever arrived.
>
> **Decorative:** a guard that exists, is declared, and is connected to nothing that would fail if it
> were violated. Worse than absent, because it is counted as protection in the review that should
> catch its absence. Converting decorative → real is obliged.

Two recorded exceptions to the demand gate exist and both are **spent**:
`ratified.build-standby-before-g1` (sprints A–E shipped 2026-08-14; Sprint F is post-G1) and
`ratified.journey-safety-subset-2026-08-21` (custodial false-positives only; shipped). Nothing in §2-F
or §2-G may start before its named event. Starting early is the defect, not a head start.

**Precedence, restated so it is applied and not re-argued:** until 2026-09-12 Steve's hands go to
report-bridge. Sprint 0 is therefore everything that needs *no* Steve action, and Sprint 1 is the
smallest possible set of Steve actions — sized in minutes — for the day the ruling lifts.

---

## 2. Remaining-work inventory — the complete set

Everything known to remain on 2026-08-27, before sequencing. **Court:** who must act — `steve`
(his hands, his credentials, his money, or his ruling), `claude`, `co-pilot` (Claude drives, Steve
approves each irreversible or outward-facing step), `vendor`. **Manual** = cannot be automated by
Claude *at all*; a `co-pilot` row is automatable except for the named approval. IDs carried from
revision 3 keep their letters (A4/A5 closed, A6 outreach, A7 placement-day tail, A8 the gate — so
`gates.g3…ratified.decision`'s "closes ROADMAP A5 together with A4" stays true); new IDs are marked
**NEW** and never reuse a rev-3 letter. 📝 = needs a `PROJECT.yaml → deferred`
entry (it has none today). Every deadline names its basis; a row with `—` has no dated obligation
and must not be given one by a later editor without a record.

### A. Demand evidence — the critical path (unchanged in six sprints; the whole point of this plan)

| ID | Item | Court | Manual? | Blocks / unlocks | Deadline (basis) | Source of record |
|---|---|---|---|---|---|---|
| **A0** | **The owner's vault is empty.** Six screens, ~20 min: `/vault/new` ×2 (a real login with secret + 2FA seed + recovery codes; a document/instruction item), **Needs a code?** answered, `/circle` one recipient **and** one verifier, `/rules` one rule, `/triggers` saved. **Never Initiate. Never `reset-demo.ts`.** | steve | yes — real credentials and real people | Unlocks A3 (`invite:cohort --commit` structurally refuses), the present-tense ladder, D3 criterion 3, B5's live proof, F-a's first measurement | **2026-09-12** (`deferred.the-owners-vault-is-empty.sprint_1_calendar_lapsed.revisit` = the report-bridge GO-LIVE date) | `deferred → the-owners-vault-is-empty`; `docs/vault-checklist-sprint-1.md` (moved into the repo by this revision) |
| A0.t | Claude's tail: 1.3 release config + readiness banner true — via a minted owner session (`scripts/mint-owner-session.ts`) **with Steve's explicit permission**, or Claude-in-Chrome in his session; `verify:dogfood` READY; `verify:orphans`; re-derive §0.1 | co-pilot | permission only | after A0 | 2026-09-12 (same) | ROADMAP rev 3 Sprint 1 rows 1.3/1.5 |
| **A0.dm** NEW 📝 | **Nothing turns red on 2026-09-12** (or on 2026-10-01): no guard reads a `revisit:`. Decide: promote A0 to a dated `gates:` entry (which `gates.test.ts` reads for free — but promotes it past report-bridge), or teach a guard to read `revisit:` on deferred/ratified entries | steve (ruling) → claude (build, S) | ruling | E4.4 shares the mechanism | — | `deferred.the-owners-vault-is-empty.…this_is_a_note_and_not_a_dead_man` |
| ~~A4~~ · ~~A5~~ | ~~Ratify g3 · drop `wealth manager`~~ — ✅ **closed 2026-08-20** (ratified as amended; `gates.g3-b2b2c-pilot-loi.ratified` says "this closes ROADMAP A5 together with A4" — those letters are kept for exactly that sentence) | — | — | — | — | register |
| **A1** | **Op-ed → caregiver.com.** A1.1 voice pass · A1.2 cover email disclosing the commercial interest · A1.3 **ruling: does §1a third-person bind editorial?** (register says yes; the 08-17 sprint report relaxed it unratified) · A1.4 compliance re-measure after the rewrite (words 500–1500, 0 product mentions, no estate/death/medical vocabulary, no employer reference) · A1.5 `.docx` derived by pandoc, written **outside the repo**, contact block from gitignored `.relay-submitter.json` · A1.6 route re-check **on the day** (moved twice in three days) · A1.7 **send** with attachment to the address in the dossier, from Steve's own mailbox · A1.8 on acceptance: sign the release; confirm the byline link is `relaystandby.com/caregivers?src=ed-caregiver-com` | A1.1/A1.2/A1.7/A1.8-sign: **steve**; A1.3: steve ruling; A1.4/A1.5/A1.6/A1.8-link: claude | yes — human authorship and human-send by design (AI-generated pitches blacklist the sending address at AARP-class outlets) | Unlocks Sprint 5 (placement) and the only instrument that moves G1 | **target: the first sitting after 2026-09-12; ceiling ~2026-09-20** (derived in §3 Sprint 2 from G1's lead-time arithmetic: send D → acceptance D+2..4 wk → publication D+4..10 wk; a later send means `gates.g1-arms-length-demand` needs a `moved:` block, not silence — Steve to confirm, as with G1's own date) | `docs/oped-angle-3-draft.md` send checklist; `docs/g1-outlet-dossier.md`; `ratified.g1-editorial-over-paid.constraints_carried` |
| **A2** | **The Caregiver Space** — no pitches: the finished piece *is* the submission. A2.1 adapt the piece to their journalistic standard + end-of-post bio (tagged link `?src=ed-thecaregiverspace`) + a rights-cleared image (Claude preps bio/link/candidate image) · A2.2 route re-check (author-guidelines page; `/write-for-us/` 404s) · A2.3 submit via their site contact form (Claude may prefill; Steve presses submit) | steve (A2.1 voice, A2.3 send); claude (prep, A2.2) | yes — human-send | second placement candidate | same send-by as A1 | `docs/g1-outlet-dossier.md §The Caregiver Space` |
| **A3** | **Beta cohort** (deferred three times; N=0 since 2026-08-12; two shipped security decisions rest on the number). A3.1 roster — both types, both arms, ~10–20 people (today: one recipient, no verifier) · A3.2 Claude: dry run now (never gated; creates nothing) + write the **duplicate-email trap** into the handoff (people named in `/circle` during A0 must NOT be in `.relay-cohort.json` — `invite:cohort` breaks the loop on the first duplicate; use `scripts/phase0-invite.ts` for them) · A3.3 `--commit` with a minted/exported owner cookie on Steve's GO (writes real invitations) · A3.4 owner-arm sends out of band · A3.5 the four-word verification calls · A3.6 `scripts/phase0-report.ts` read against the pre-recorded ~50% floor · A3.7 record the third deferral on `ratified.beta-cohort-deferred-four-days` (its 2026-08-23 revisit lapsed with no pointer); a **fourth** deferral needs its own revisit date | A3.1/A3.4/A3.5: **steve** (A3.4/A3.5 manual **by design** — automating them breaks what they protect); A3.3: co-pilot; A3.2/A3.6/A3.7: claude | yes | Phase 0 claim conversion; verifiers reaching `confirmed`; the first arms-length *person* candidates | 2026-09-12 (inherits A0) | `ratified.beta-cohort-deferred*`; `docs/beta-cohort-handoff.md`; `docs/first-invitations.md`; `scripts/invite-cohort.ts` |
| **A7** | **Placement day** (event: an outlet publishes). **A7.0 — Sprint 0, before anything else:** establish whether Vercel Web Analytics is *collecting* for the relay project (the API says `web_analytics_not_enabled`; the edge serves the script): one `get_web_analytics` count after a known `src=qa` visit, or the project's Analytics tab via Claude-in-Chrome, recorded in `docs/g1-flight-log.md` with its command; if it is off, enabling it is a dashboard toggle (Sitting E) and a **hard precondition of Sprint 5**; extend `verify:funnel` to assert the collector accepts the event (a 2xx on the `/_vercel/insights/event` POST), not only that `window.vaq` was filled · A7.1 the `ed-<outlet>` slug moves from `PLANNED_EDITORIAL_SRCS` into `GATE_LANES` **in the commit that records the placement**, updating the two tests that pin the list empty (`content.test.ts:219, :437`) · A7.2 fill the flight log's **Window start** row (while it reads "fill", `flight:snapshot` enforces an empty `caregiver_leads` and would exit 1 on the first real lead) and rewrite its ad-era window table **now** · A7.3 day-of `npm run verify:funnel` + `npm run flight:snapshot` · A7.4 daily snapshot rows + known-offsets discipline; the two analytics cells come from the Vercel MCP (`dataset: events`, `by: eventName`, filter `eventData/src`) once A7.0 confirms collection | claude | no | N leaving zero for the first time | event | `src/app/caregivers/content.ts:273`; `docs/g1-flight-log.md`; `lib/g1/flight-snapshot.ts windowStarted()`; `ratified.g1-n-is-an-allow-list` |
| **A6** | **G3 partner outreach → MEETINGS** (Homethrive → Wellthy; NAC Innovation Collaborative in parallel; kill measured on meetings). A6.1 re-check each route on the day + confirm the Homethrive × Bright Horizons claim from Homethrive's own newsroom before citing it · A6.2 draft the three first contacts (first sentence says what is wanted; no estate; nothing via the day job; NAC asked about eligibility/fees/CARE2030) · A6.3 **send** under Steve's identity · A6.4 create the outreach/meeting log the gate calls for but names no file for (`docs/g3-outreach-log.md`, path recorded on the gate) · A6.5 diligence answer pack: g2 brief Q1/Q3/Q11 ("no opinion exists; this pilot would fund it"), Q4/Q5/Q7 as accepted residual risk, subprocessor list, single-Region CMK ruling + reversal path, SOC 2/DPA posture (G9) · A6.6 verdict on the gate's date | A6.3/A6.6: **steve**; rest: claude | yes (send; verdict) | Sprint 7 opens only when a meeting advances toward a pilot | **2026-11-30** (`gates.g3-b2b2c-pilot-loi.due`); revisit at every `/daily-priority` from 2026-09-01 | `gates.g3-b2b2c-pilot-loi`; `docs/g3-partner-dossier.md` (§Sources flag at :208) |
| **A8** | **The G1 gate itself**: ONE arms-length person who pays, or writes that they would, at a seen price. Steve rules what counts when a candidate appears (not himself, not a friend, not a free beta user, not a verbal "sounds useful"). On pass: Claude re-stamps `ladder` + `ladder_evidence`, sets `market.wtp_evidence` and **adds** `market.demand_signal` (the field does not exist today — H), drafts G4/G5 gate blocks | steve (ruling); claude (record) | yes | ladder → `customer-used`; Sprint 8 | **2026-12-31** (`gates.g1-arms-length-demand.due`; revisit from 2026-10-01) | `gates.g1-arms-length-demand` |
| A9 NEW | AARP The Magazine — second-round pitch only after a first byline exists (plain-text email, links to samples; AI-generated → address blacklisted permanently; Senior Planet **is** AARP). **Sprint 5, not before** — a byline cannot exist inside Sprint 2's window | steve | yes | — | event: after A1/A2 publish | `docs/g1-outlet-dossier.md §AARP` |
| A10 NEW | LinkedIn H0-win post — drafted; status unverified (memory only). Earned, not paid; employer-anonymity rule applies | steve | yes | — | — | `MEMORY.md` 8-05 rulings |
| A11 NEW | Devpost prize delivery ($2,000 + $2,000 AWS credits): if nothing has arrived by ~2026-10-08 (claim completed 2026-08-09 + 60 days), chase `prizes@devpost.com` | steve | yes | the credits are what keeps the infra free | ~2026-10-08 (memory `project_h0_hackathon_orbis_relay`) | memory only — not in the repo |

### B. Custodial integrity — the live system's own standard

Revision 3's B1–B4, B6–B9 stay closed (`closed.date` 2026-08-20 in the register). What follows is
the 2026-08-27 sweep: the alarm path first, because a custodian whose alarms go to Trash has no
alarms.

| ID | Item | Court | Manual? | Blocks / unlocks | Deadline (basis) | Source |
|---|---|---|---|---|---|---|
| **B10** NEW 📝 | 🔴 **The alarm of record delivers to Gmail TRASH.** Every `[sgharlow/relay] Run failed` mail since 2026-08-08 (≈20 threads incl. both red-proofs, about half unread) is in Trash. **B10.d (Sprint 0):** Claude reads Gmail Settings → Filters / Blocked addresses via Claude-in-Chrome (read-only) and names the rule. **B10:** Steve (or Claude in his session, on his say-so) removes it. B10.t: Claude then **re-proves delivery** — `gh workflow run kms-wall.yml -f key_id=<bogus>` (read-only KMS calls) and a read-only Gmail search for INBOX labels | steve (rule); claude (re-prove) | yes — Gmail connector is read-only at its OAuth scope; no filter API at any scope | Every scheduled alarm; B4's and the canary's "proven red" become true | the 2026-08-25 evidence mail purges ~2026-09-24 (Gmail 30-day Trash) | Gmail: `[sgharlow/relay] Run failed: KMS wall watch - master (ce776ef)`, 2026-08-25, labels TRASH+UNREAD; `kms-wall.yml:59-60` (its own bar: "exits 1 **and** the notification reaches a watched inbox") |
| **B11** NEW 📝 | 🔴 **The scheduled monitors are collapsing** — canary 45→2 runs/day, scheduler-monitor 30→3 (08-18..08-27) vs 96/48 designed; `created_at == run_started_at`, so GitHub is not queueing them, it is not creating them. Coincident: the account's 2,000 Actions minutes 100% used 2026-08-28 (reset 2026-09-01; private repos consume them, relay is public/free); a GitHub Actions incident 08-26/27. B11.1 Claude re-measures per-day counts on **2026-09-02**; B11.2 if cadence recovers → the payment-method/plan decision is Steve's (money); if not → B12 is the only fix. The scheduler dead-man (2.5h threshold) was sampled 3× on 08-27 | claude (measure); steve (money) | B11.2 only | truthful cadence claims; the case for B12 | re-measure 2026-09-02 (GitHub billing-reset mail) | `gh api …/runs?created=<day>`; GitHub billing mail "You have used 100% of included Actions minutes", 2026-08-28T02:50Z |
| **B12** NEW 📝 | **Off-GitHub heartbeat for the alarms** (Route 53 health check or CloudWatch Synthetics → SNS NotifyMe — the one path proven to reach a human). GitHub also auto-disables public-repo schedules after 60 quiet days (**~2026-10-24** from the 2026-08-25 push; every `verify:live` stamp commit resets it). Proposed in three places, taken in none. B12.i interim, no AWS change: a Windows Task Scheduler job (beside `devsync-sync`) counting `gh api …/runs?created=<today>` per workflow and alarming on 0 in 24h **via SNS NotifyMe (the proven path) — never via GitHub mail, which B10 shows goes to Trash** | steve (infra + cost, 5-gate); claude (interim + build) | ruling | alarms that outlive a park, a quiet autumn, or load-shedding | ~2026-10-24 derived; not a repo field | `lib/ops/alarm-of-record.test.ts:128` ("THIS TEST DOES NOT FIX IT"); `date-guards.yml` header |
| **B13** NEW | **Proof-of-red owed:** `production-canary` never red in 685 runs (its `base_url` input post-dates its only dispatch) — dispatch it at a dead host; `delivery-webhook-monitor` and `scheduler-monitor` have no dispatch input (add `health_url`, PR); `date-guards` never red as a workflow — dispatch on a throwaway branch planting a past-due gate. Fix the canary header's "~1,200 runs / quarter of an hour" claims with the derivation command | claude | no | three of five alarms proven red, not just green (the inbox half needs B10) | — | `production-canary.yml:49-66`; `gh api …/runs` totals |
| **B14** NEW 📝 | `verify:journeys` (J3/J6/J9; each walk prints its own count) has **no freshness dead-man** — D10 was closed by building walks nothing schedules or ages. Add a stamp line + freshness assertion; keep the chain separate (signup ceiling) | claude | no | the 08-21 walks stop being decorative | — | `package.json:21-22`; `deferred.the-journey-sweep-is-stale.closed` |
| **B15** | **Shipped-but-unproven guards and the rulings under them.** B15.1 live-prove the J5-R4 owner-reminder ladder (cron-only; failure mode = 200 + healthy ledger + no reminder) with a disposable short-interval owner across hourly ticks, **and let the interval elapse so the sweep's ARMED→PENDING transition is observed once for a real (disposable) owner** — it never has been · B15.2 verifier **deny/abstain/halt** never exercised on production (README overstates it at `live-proven`) — add a walk · B15.3 J6 step 4c owner-silence escalation never walked (~2h across a cron tick) · **B15.4 ratify the three chosen-not-measured numbers** (rungs 75%/90%; 12h cooling-off) **and rule on owner self-naming** (row creation not refused; roster reads fuller than it is) · B15.5 `lib/release/verifier-context.ts` filters on the never-written action `checkin_reminder_sent`, so the verify screen's "We tried to reach them" row can never render — two-line fix · B15.6 the PR #8 step-up error-classification fix stays `built` — needs a fault injected | B15.4: **steve**; rest: claude (B15.1–3 write disposable production rows and spend signups — tell Steve first) | B15.4 | J5-R4 false-PENDING protection proven; README truthful | — | `ratified.journey-safety-subset-2026-08-21.awaiting_ratification`; `lib/release/checkin-reminder.ts:102-120`; memory PR #14 note |
| **B16** ✅ **CLOSED 2026-08-29** | ~~**The IAM wall has never read the real account.**~~ It has now — four principals, read-only, exit 0; all six sub-items closed and the D21 precondition met. Detail in the Sprint 0.2 progress note. Original filing kept as the evidence record:  B16.1 `npm run verify:iam` with `.env.admin` (five read calls per principal; needs in-session authorisation, not Steve's hands) · B16.2 pin `relay-dev`'s KMS action list in `LAPTOP_CONTRACT` from the output · B16.3 close the two written blind spots (group-attached policies; Resource scoping) · B16.4 extend `iam-wall` to **roles** so the public-repo OIDC role `relay-kms-wall-ci` is audited (must hold the three KMS reads only; never Decrypt/GenerateDataKey; trust pinned to `refs/heads/master`) · B16.5 inventory the H0-era `relay-backend-dsql` role (template grants `DbConnectAdmin`; deletion = Steve) · B16.6 `RUNTIME_CONTRACT` does not *require* `kms:GenerateDataKey`/`Decrypt` — a stripped KMS grant passes; read the live policy unfiltered once and pin it | claude (B16.5 delete: steve) | no | the load-bearing "`.env.ro` holds no `kms:*`" claim becomes measured — **precondition of D21** | — | `deferred.the-read-only-identity-is-not-in-the-cloud.the_no_kms_claim_is_BUILT_not_live_proven`; `scripts/verify-iam.ts` header; `lib/ops/iam-wall.ts` |
| **B17** NEW 📝 | **DR vault copy jobs have no absence alarm** (`relay-backup-absent` watches primary BACKUP completions only; a dropped copy action raises no `COPY_JOB_FAILED`). Decide → add `AWS/Backup NumberOfCopyJobsCompleted` alarm to NotifyMe, `TreatMissingData breaching`, forced to ALARM once; re-read the live `relay-backup-absent` definition (never done). Bundle into the D3 admin session | steve (decision, ~$0.10/mo, 5-gate); claude (build) | ruling + admin session | cross-Region backup coverage matches the runbook's claim | — | `docs/backup-restore-runbook.md §Still open` |
| **B18** NEW 📝 | **Secret rotation: no cadence, nothing ever rotated** (all 26 production keys `createdAt == updatedAt`; six app secrets + the `relay-runtime` key 2026-06-24; `autospecai` admin key 2025-06-29, **424 days**). B18.0 ratify a cadence **or** record "none until first customer" · B18.1 rotate the `autospecai` admin key (two-keys-valid overlap; Claude executes on request; no secret in chat) · B18.2 `relay-runtime` key pair in Vercel (IAM half by CLI, Vercel half by `vercel env`, redeploy = PR, re-run the three walls) · B18.3 the six app secrets each in its own window (NEXTAUTH = global sign-out; JWT secrets only when no release is open; `RESEND_API_KEY`'s provider half is Steve's dashboard; **`STRIPE_*` excluded — shared account, never rolled per project**) · B18.4 confirm `DSQL_PASSWORD` is EMPTY in Vercel and `.env.local` (`vercel env ls production`, names only) · B18.5 remove the inert retired `TOTP_SECRET` from Vercel Production (`vercel env rm`, with a nod) | steve (B18.0; dashboards); co-pilot (B18.1–3); claude (B18.4–5) | ruling; credential-touching → 5-gate | the estate's oldest, most powerful credential stops being 14 months old | — (do not invent one) | `docs/secret-rotation-runbook.md` table + §1–§7; `deferred.every-secrets-age-is-unknown.closed` |
| **B19** NEW | **CMK auto-rotation** — `ROTATION_INTENDED = false` records the as-provisioned state; nobody has decided. Enable (`aws kms enable-key-rotation` + flip the pin in the same commit + `verify:kms` green; ~$24/yr; symmetric rotation is backwards-compatible) or record "stay off, deliberately" | steve | ruling (infra change) | the finding `kms-wall.ts` alarms on is "nobody decided" | — | `lib/ops/kms-wall.ts` ROTATION_INTENDED comment |
| **B20** NEW 📝 | **`infra/iam-policy.json` template still grants `dsql:DbConnectAdmin` and `kms:DescribeKey`** — re-applying it silently undoes the 2026-08-16 cutover; its Sid does not start with `Dsql`, so the cutover doc's Sid-filtered audit prints `[]`. Rule: bring the template to the live v2 shape (and decide whether runtime keeps DescribeKey); Claude edits + README | steve (ruling); claude (edit) | ruling | a re-provision cannot re-open the wall | — | `infra/README.md`; `docs/aws-setup.md §6` |
| **B21** | **CSP tail (D9 closed with an open downstream).** B21.1 make `scripts/verify-csp.ts` an npm script on `.env.ro` (one SELECT) · B21.2 read `csp_reports` for WHICH directives/sources once a real traffic window exists, confirming delivery in a real browser first (an empty table has two meanings) · B21.3 retention/pruning ruling (the table never prunes; public unauthenticated writer, 20/min/IP) · B21.4 the nonce + Node-runtime middleware decision (a request-path change to a working system, 5-gate) → build; `security-headers.test.ts` refuses removing `unsafe-inline` without nonces in the same change | claude (1, 2, build); steve (3, 4) | rulings | removing `unsafe-inline`/`unsafe-eval` from the **enforced** `script-src` | event: real traffic | `deferred.the-csp-report-sink-…closed.still_open_downstream`; `scripts/verify-csp.ts` |
| B22 NEW | **`executor` role is hidden in the UI but accepted by the API** (`VALID_ROLES` includes it; `POST /api/recipients` and `/api/people` accept it) — the exact dropdown-only pattern the estate ruling rejected. Refuse it at the trust boundary (keep the enum for existing rows; pin by test) or record that the role is acceptable and amend Req 3.1 | steve (one-line ruling); claude (build, S) | ruling | truthful trust boundary | — | `lib/people/recipients.ts:55-56`; `src/app/(owner)/circle/PeopleSections.tsx:72` |
| B23 NEW | Standby architecture §3.7 **rule 10** (cap standby relationships per user — no `MAX_STANDBY` exists) and **rule 4** (cross-owner confidentiality — no enumeration of a contact's other circles) — "cheap now, expensive to retrofit"; custodial the moment a stranger claims | claude | no | Sprint 6 | event: first stranger | `docs/standby-architecture.md §3.7, §7 Risk 4` |
| B24 NEW | **Incident runbook step 0 has no operator tool**: nothing scripts `verifyAuditChain()` per owner or captures the evidence bundle (Vercel logs ~24h retention, chain, `scheduler_runs`, `email_send_attempts`). Build it read-only under `.env.ro`; same script doubles as the pre-release chain check | claude | no | the runbook is executable at 3am | — | `docs/security-incident-runbook.md Step 0`; `lib/audit/chain.ts` |
| B25 NEW | **No bulk session revocation** (`bumpSessionEpoch` is per user; global sign-out = rotate `NEXTAUTH_SECRET` = global outage that also breaks step-up/WebAuthn/recovery tokens). The runbook says it "deserves its own decision" | steve | ruling (blast radius) | containment without an outage | — | `deferred.no-incident-or-breach-runbook.closed.there_is_no_bulk_session_revocation` |
| B26 NEW | Secret-types design **Q6**: the owner branch of `/api/kms/unwrap` is outside `step-up-guard`'s scope while TOTP seeds (which outlive a session) are stored — classify under step-up or record a decision not to; **Q16** (seed phrases in scope given the estate disclaimer) is a second unruled question | steve (ruling); claude (build) | ruling | the guard's own criterion is met by a seed | — | `docs/secret-types-design.md §6 Q6, §7` |
| B27 NEW | **Repo security settings all off on a PUBLIC repo**: secret scanning, push protection, validity checks, Dependabot alerts (the feed D12's reopen trigger depends on); CI runs no `npm audit`. Enable alerts + scanning (free; `gh api -X PATCH …security_and_analysis…`, `-X PUT …/vulnerability-alerts`) — **alerts only**, no version-update PRs (majors are barred) | claude (with a nod) | nod | structural secret hygiene; an advisory feed | — | `gh api repos/sgharlow/relay --jq .security_and_analysis` |
| B28 NEW | Owner-mode accessibility is audited by nothing scheduled (`a11y.yml` runs `A11Y_SCOPE=public`; the default owner `demo@relay.test` no longer exists). Standing pre-release cadence: `disposable-owner.ts create` → `a11y-audit.mjs` with `A11Y_OWNER_EMAIL` → `close` → `verify:orphans` (counts against the signup limit) | claude | no | CC8's 36-page coverage stays true | before each release that touches owner-mode UI | `a11y.yml:16-20,69`; `scripts/a11y-audit.mjs:120-132` |
| B29 NEW | `scripts/backup-status.mjs` — the only instrument that reads **both** vaults — is hand-run only (last recorded 2026-08-20). Decide a schedule: an AWS Backup read-only OIDC role (the `kms-wall` pattern, no stored secret) is the shape | steve (IAM role); co-pilot (runs) | admin session | a dated answer to "how stale is the newest recovery point" before any infra change | — | `scripts/backup-status.mjs:13-32` |
| **B30** NEW | ⚠️ **Latent CI red from 2026-10-03:** superseded gate `g1-caregiver-wtp` carries `due: 2026-10-02` with no `met:`/`declined:`; `gates.test.ts` has no `superseded_by:` handling and would fail `date-guards` **and** the required `verify` check. Fix A: Steve records a disposition on the ratified record (with `residual_risk` + `revisit`); Fix B (recommended): Claude teaches the parser that `superseded_by:` stops the clock; also point the block's "revisit from 2026-09-01" at `g1-arms-length-demand` so `/daily-priority` stops re-raising a retired instrument. Never silently move the date | steve (which fix); claude (build) | ruling | green CI past 2026-10-03; merges | **2026-10-02** (`gates.g1-caregiver-wtp.due` + the overdue rule) | `lib/ops/gates.test.ts:82-135` |
| B31 NEW | Sibling-account alarm noise on the shared inbox: `learningai365-ec2-daily` fires FAILED nightly against a deleted instance via SNS — trains the reader to ignore SNS, the one alarm path that reaches a human | steve (nod — another product's footprint); claude disables the plan via the Node signer | nod | signal-to-noise on the only working alarm channel | — | SNS mail `learningai365-production-alerts` FAILED / RESOURCE_NOT_FOUND, nightly since 2026-08-25 |
| B32 NEW | Vercel runs **Node 24.x**; CI, a11y and `engines` test on **22**; `@types/node` is ^20. No documented problem. Align CI to 24 by PR only as a deliberate change; never touch the Vercel setting | claude (watch) | no | tested runtime = shipped runtime | — | `vercel project inspect`; `ci.yml:53-55` |
| B33 NEW | Recovery codes for the live paying owner account were lost at creation — **verified NOT regenerated** (2026-08-27, `relay_ro`: `recovery_codes` holds 8 rows for the one subscriber, all created 2026-08-09T01:36Z, none used, none newer). Regenerate from `/account` (step-up/TOTP — Steve's); Claude turns the check into a read-only NOTICE so it never needs a human again | steve (regenerate); claude (check) | yes | — | — | `SELECT count(*), min(created_at), max(created_at), count(used_at) FROM recovery_codes` under `.env.ro`; memory `project-relay-beta-readiness-2026-08-08` |
| B34 NEW | Before the first invitations/notifications reach strangers: read **Resend → Suppressions** in the dashboard (one hard bounce mutes a recipient indefinitely while `emails.send` returns 200; the API key is send-only) | steve | yes — dashboard-only | Sprint 6 | event: first stranger | memory; `docs/email-dns-runbook.md §3` |
| B35 NEW 📝 | **Domain renewal clock**: `relaystandby.com` registered 2026-08-08 at Cloudflare, **expires 2027-08-08** (RDAP); auto-renew state and card recorded nowhere. A lapsed domain takes down the site, all mail (`send.`, `hello@`, `dmarc@`) and every link in a family's saved invitation. Confirm auto-renew ON (the on-disk Cloudflare token has **no Registrar scope** — 403 on 2026-08-27 — so this is the dashboard or a re-scoped token); Claude records registrar/expiry in `PROJECT.yaml` + a yearly RDAP read | steve (confirm; co-pilot via Claude-in-Chrome); claude (record) | dashboard | the front door, structurally | 2027-08-08 (registry) | RDAP `rdap.org/domain/relaystandby.com` |
| B36 NEW 📝 | **No AWS Budget/spend alarm** on acct `461293170793` — a DPU burst from abuse on the nine memory-limited public endpoints, or a forgotten scratch cluster after D3, has no alert. Draft: monthly budget ≈ 2× the unit-economics fixed cost → SNS NotifyMe. Bundle into the D3 admin session | steve (5-gate, admin); claude (draft) | admin session | a cost-side dead-man on the proven SNS path | — | `docs/unit-economics.md`; `gates.d3-restore-drill` criterion 4 |
| B37 NEW | `scripts/go-live.sh` (H0, no banner) would **seed `demo@relay.test` into production and `vercel env add --force` over live secrets**; `scripts/demo-run.ts` drives FR9 with a demo cookie that cannot exist; `env-example.test.ts:85` still cites `go-live.sh`. Banner both HISTORICAL — DO NOT RUN (git keeps them); retire `demo-run.ts` with D25 | claude | no | one fewer production write path reachable by following in-repo instructions | — | `scripts/go-live.sh:96-123` |
| B38 NEW 📝 | **`/privacy` "Who else is involved" omits Cloudflare** (Email Routing forwards every `hello@`/`relay@` message = support content; DNS/registrar) **and Google** (Gmail, where that mail and the DMARC reports are read). `subprocessors-are-listed.test.ts` derives from `package.json` and structurally cannot see infra-only processors. Ruling: does a mail forwarder count? Then edit + extend the test with an infra allowlist | steve (one line); claude (edit + test) | ruling | truthful copy; one fewer G3 diligence surprise | — | `src/app/privacy/page.tsx:103-114` |
| B39 NEW | **Public artifacts that still sell estate:** `DEVPOST-PASTE-READY.txt` (tracked, 5 mentions), `demo-out/x-thread.md` (3; posted? unrecorded), `demo-out/youtube-metadata.md` (the demo video is PUBLIC at `youtu.be/FU3azKJOesY` and **linked from `README.md:19`**), `demo-out/narration-script.md`, `demo-out/teleprompter.html`, `docs/blog-post.md`. Claude banners the six files; Steve decides YouTube description edit vs unlist and confirms whether the X thread exists | claude (banners); steve (accounts) | accounts | copy that agrees with `/terms` | — | `grep -c -i estate` 2026-08-27; `journeys.J10 withdrawn` |
| B40 NEW | Resend plan contradiction: deliverability doc says the shared account is **Transactional Pro (monthly, renews on the 15th)**; `unit-economics.md` prices Resend at **$0**. The plan, amount and renewal day are readable now (Gmail: monthly receipts from `invoicing.resend.com` on the 15th of 05..08; the 2026-08-08 renewal notice) — Claude writes them into the doc with the search as derivation; the only Steve line is **which product carries the line** in its unit economics | claude (facts); steve (attribution, one line) | one line | a unit-economics page a partner can be shown | — | `docs/deliverability-options-3-and-5.md:260`; `docs/unit-economics.md:22,92` |
| B41 NEW | **Support inbox watcher** — "within one business day" is promised on three surfaces; `hello@` forwards via Cloudflare catch-all to Steve's personal Gmail, read by one person with no absence cover. C6's `ends_when` ("who watches the inbox") was never answered in its closure. Record the operational answer and the fallback | steve | ruling | the promise on `/about` is operated, not just stated | — | `deferred.support-has-an-address-and-no-commitment` (closed, open tail) |
| B42 NEW | Reply-To/From mismatch (`hello@` vs `relay@`) flagged as a mild spam signal, left unmade on purpose — decide, or record as accepted (automatable via `vercel env` once ruled; treat as policy-gated) | steve | ruling | — | — | `docs/email-dns-runbook.md §2`; `lib/notify/email.ts resolveReplyTo` |
| B5 | **KMS `EncryptionContext` (tenant separation at the key, not the app).** Design + rollout docs written (the code is deliberately unbuilt); migration 037 **applied both regions** (the docs still say "authored, not applied" — H). B5.0 Steve lifts the gate (reopens on a customer, a partner's diligence, or **any** change on the wrap/unwrap path) · B5.1 phase B code: read `kms_context_era`, still wrap without context, name `KeyId` on Decrypt — a no-op deploy that makes phase C reversible · B5.2 S4-4 live proof (needs one REAL pre-change row → A0) · B5.3 phase C: flip the wrap-with-context flag in Vercel — **point of no return is the first row written with a context; rollback after C is flag-off, never a code revert**. Must not share a quarter with a multi-Region CMK (B3 Option B) | steve (B5.0, B5.3 approval); claude (B5.1–2) | ruling; flag flip | cross-tenant unwrap refused **by KMS** | event: Sprint 6 | `deferred.tenant-separation-at-the-kms-boundary-is-not-cryptographic.ruled`; `docs/encryption-context-{design,rollout}.md` |
| B3 (closed, tail) | Single-Region CMK accepted (Option A). Reopens on the first arms-length customer, a partner's diligence, or a Region wobble — 5-step non-negotiable order in the proposal; separate quarter from B5 | steve | 5-gate request | — | event | `docs/kms-region-proposal.md` |

### C. Trust, identity and communications

| ID | Item | Court | Manual? | Blocks / unlocks | Deadline (basis) | Source |
|---|---|---|---|---|---|---|
| **C1.0** NEW 📝 | 🔴 **`_dmarc.relaystandby.com` carries no `rua=`** (live: `v=DMARC1; p=none`; every doc records `rua=mailto:dmarc@relaystandby.com; fo=1`; no record of the removal). Likeliest cause: the runbook's own §1 advice to stop forwarding Google reports through Cloudflare (258 bounced forwards). Ask whether it was deliberate; decide the target — a DMARC processor (Postmark digest / dmarcian / URIports) per the runbook — and restore. Claude drafts the record, the pre-change snapshot (the three TXT values read 2026-08-27), the rollback line and the DoH check | steve (DNS on working mail, 5-gate + decision); claude (draft + execute on request — the on-disk Cloudflare token is zone-scoped and reads the record today) | ruling | **C1.1 protects nothing new and C3 cannot start until this is done**; C1.2 is independent (the three reports already exist and purge regardless); the Outlook draft's "we read your aggregate reports" is false until then | — | DoH `cloudflare-dns.com` + `dns.google` 2026-08-27; `docs/email-dns-runbook.md §1 (:111-135)` |
| **C1.1** | Create the Gmail **never-trash filter** for `dmarcreport@microsoft.com` / `noreply-dmarc-support@google.com` — the cause half, **never done** (rec 1 is unticked; rec 2, the 08-15 rescue + read, is the ✅) | steve; co-pilot via Claude-in-Chrome in his signed-in session | the connector is read-only at its OAuth scope and filter creation has no API at any scope (the AUTOMATE path — re-consent the connector with modify scope — would make untrash/label Claude-runnable but not filters; recorded, not taken); with a connected browser session Claude can drive the Gmail settings page while Steve watches | protects future reports (which need C1.0 to exist) | with C1.2 | `docs/deliverability-options-3-and-5.md §Recommended, in order`; memory `feedback-half-a-fix-recurs-silently` |
| **C1.2** | **Untrash the three reports in Trash now** — Google/relaystandby 08-15, Microsoft/report-bridge 08-16, Microsoft/relaystandby 08-17 (the 08-15→16 window = the A/B-test evidence the doc said to watch for) | steve | yes | C1.3 | **~2026-09-14** (earliest arrival 2026-08-15 + Gmail's 30-day Trash purge — **not** the ~09-10 every doc cites, which is the batch already rescued) | memory 2026-08-24 Gmail read |
| C1.3 | Read the rescued 08-17 Microsoft report: do the A/B IPs `54.240.48.188` / `54.240.11.161` appear pass/pass, disposition none? (try reading the trashed thread read-only first) | claude | no | closes the A/B-test question | after C1.2 | `docs/deliverability-options-3-and-5.md §📌` |
| C1.4 | Correct the DMARC item everywhere it is written wrong (rev 3 C1/§4; `go-live-checklist-steve.md §10.1`; `outlook-sender-support-submission.md` step 0; the deliverability doc's date) — corrected in this file for the roadmap; the other three are Sprint 0.7 | claude | no | — | — | this revision §0.3 |
| **C2.1** | Outlook sender support, step 1: open the **Resend ticket** (drafted verbatim; no record it was ever sent) — **after** Claude strips the draft's two false sentences (reports received; quarantine being prepared) | steve | yes — vendor human-send from the account holder | step 3 | — | `docs/outlook-sender-support-submission.md §Step 1` |
| **C2.2** | Step 3: submit the **Microsoft sender-support form** (signed-in Microsoft web flow; Claude-in-Chrome may prefill as co-pilot; Steve presses submit). Record outcomes in the deliverability doc, not the ⛔ RETIRED ad-creatives doc the "done" section points at | steve | yes | Outlook deliverability of release/verifier mail | — | same doc §Step 3 |
| C2.3 | After any Microsoft reply: re-test to a FRESH outlook.com mailbox and read the SCL from headers (never from Resend's "Delivered"); no reply in ~2 weeks → record and stop. Never click "It's not junk" on evidence | claude / vendor | no | — | — | same doc §What done looks like |
| **C3** | DMARC step-up `p=none→quarantine`, `~all→-all` — only after C1.0 restores reporting **and** a fortnight-plus of reports confirms every legitimate source aligns. Claude drafts record + snapshot + rollback + DoH proof; Steve requests | steve (5-gate) | ruling | — | after C1.0 + 2 weeks | `docs/deliverability-options-3-and-5.md` rec 3 |
| C4 | **SMS / A2P 10DLC — parked** (2026-08-15); route settled **Sole Proprietor** (no entity, no EIN; brand ~$4 + ~$15 vetting; OTP on a real mobile with a lifetime three-use limit; 2–4 week lead). Resumes at Sprint 7 only. The A2P doc's "Standard, LLC" lines are stale (H) | steve | yes — identity, money, carrier process | SMS channel (standby rung 5) | event: Sprint 7 | `ratified.relay-operator-is-an-individual.consequences.sms_10dlc`; `docs/a2p-registration-prep.md` |
| C5 | Stripe merchant name (`Relay/ReportBridge/LearningAI365`, shared personal account) — re-decide only if a real customer remarks (the register carries two revisit triggers for one decision — reconcile, H). Also: the shared default portal config has null terms/privacy URLs — not relay's alone to set | steve | yes | — | — | `ratified.stripe-merchant-name`; `ratified.relay-operator-is-an-individual.consequences.stripe` |
| C6 NEW | report-bridge's synthetic monitor hard-bounces NXDOMAIN addresses on the **shared** Resend account — "the strongest surviving explanation for Relay's Outlook junk-filing"; state unknown since 2026-08-15 | steve (another product) | yes | Outlook hypothesis narrows | — | `docs/sprint-reports/2026-08-15-sprint-4-telemetry.md` |

### D. Operational verification, cadence and rulings owed

| ID | Item | Court | Manual? | Blocks / unlocks | Deadline (basis) | Source |
|---|---|---|---|---|---|---|
| **D1** | `verify:live` freshness dead-man — run the five-walk chain from the main checkout (10 production signups; `.env.local` + a dev server on a **free port** with `E2E_BASE`; `TZ=UTC` for date tests; one chain per hour per instance; exactly one node on the port), then `verify:orphans`, commit the stamp. Recurs every 14 days; a pause needs `STALE_AFTER_DAYS` raised in the same commit | claude | no | `date-guards` green (note: the guard that fires it is itself running late — B11) | **~2026-09-08** (`tail -1 docs/verify-live-runs.jsonl` = 2026-08-25T03:05Z + `STALE_AFTER_DAYS` 14) | `lib/ops/verify-live-freshness.ts:41` |
| D2 | `verify:orphans` after every walk day / interrupted fixture run (standing) | claude | no | — | standing | CLAUDE.md |
| **D3** | **Restore drill** (gate ratified; the drill has NOT run; the 2026-08-08 run no longer counts — it never unwrapped an item). D3.0 Steve authorises the scratch-cluster spend and holds the admin session · D3.1 `node scripts/backup-now.mjs` → restore to a **scratch** cluster (runbook steps 1–5; the AWS CLI is Norton-blocked here — use the Node signer) · D3.2 `npm run verify:kms` (READY; daily-green in CI since 08-25) · D3.3 **one REAL item** through the product's own reveal path against the scratch endpoint — `DSQL_PRIMARY_ENDPOINT` overridden in a **throwaway env file, never `.env.local`** (blocked on A0: a backup taken today carries nothing to unwrap; or Steve rules a disposable pre-backup item counts) · D3.4 record the **observed** RTO, delete the scratch cluster, confirm both prod clusters ACTIVE with deletion protection, record `met:` on the gate. Same admin session: B17, B36, B18.1, B29 (~~B16.5~~ — closed by measurement 2026-08-29, the role is absent) | co-pilot | spend + admin session | a *recovery* proven, not a restore; `gates.test.ts` turns red on 2026-11-09 with nothing recorded | **2026-11-08** (`gates.d3-restore-drill.due` — a ceiling, not a target) | `gates.d3-restore-drill`; `docs/backup-restore-runbook.md` |
| D4 | Separate test environment (cluster **+ own CMK + IAM principal + env file**) so `verify:live` can leave production — **ruled deferred until the first paying customer**; stand-ins: `verify:orphans` + the 14-day dead-man + a person running the chain | steve | 5-gate spend | swallows D14 | event: G1 met | `deferred.verify-live-cannot-enter-ci.ruled` |
| D5 | Competitor-price re-verification (Everplans $99.99, Trustworthy Silver $120, GoodTrust $39 renewing, Everplans-via-VSP $27) + add Proton emergency access deliberately (`COMPETITORS.md` has 0 mentions) | claude | no | a price anchor a partner can be shown | **2026-10-17** (60 days from 2026-08-18, `market.competitors_doc`) | `docs/COMPETITORS.md` header |
| D12 | Major-version currency (next-auth v4, React 18 under Next 16; majors available: react 19, eslint 10, typescript 7, tailwind 4, openai 7; 0 advisories) — **watch, not work**; barred absent a documented problem. B27 supplies the missing advisory feed | claude | no | — | — | `deferred.the-auth-and-react-lines-are-a-major-version-behind` |
| **D14** | **Ruling owed: the live chain runs at 100% of `/api/auth/signup`'s 10/h/IP limit.** A leave-and-say-so (what shipped: two chains an hour apart) · B exempt reserved domains (a bypass in an abuse control keyed on caller input) · C the test cluster (D4). **Never raise `LIMIT`.** Every new walk (B15) tightens this | steve | ruling | new live assertions without mid-run 429s | — | `deferred.the-live-chain-sits-at-its-own-signup-limit` |
| D16 NEW | Delete 16 fully-merged branches (12 local; 4 on origin: `auto/2026-08-22-continuation`, `docs/b4-…`, `ops/kms-wall-watch`, `ops/verify-live-stamp-…`; `docs/sprint-1-calendar-…` is a stale tracking ref — `git fetch --prune`) — all 0 ahead; no worktrees; empty stash | claude (mention, don't ask) | no | no phantom "unmerged work" | — | `git branch -a --no-merged master` = ∅ |
| D17 NEW | `.claude/sprint-state.json` is stale (branch `sprint/2026-08-20-5`; "rev 3 uncommitted"; owes runs that have run) — rewrite it. (`docs/backlog.md` — queue exhausted, boxes ticked against a renamed runbook — was bannered `SUPERSEDED BY ROADMAP.md §3` in this revision) | claude | no | the next `/sprint` lands on §3 | — | both files, read 2026-08-27 |
| D18 NEW | `docs/unit-economics.md` still says the Vercel plan is unverified — it is **`pro`** (Vercel API `list_teams`, read 2026-08-27 local); write the derivation, and reconcile the Resend cost (B40) | claude | no | — | — | `mcp list_teams`; `docs/unit-economics.md:22,33,92` |
| D19 NEW | `scripts/check-subscription.ts` ("did that payment register?") is in no chain and scheduled by nothing — give it an occasion (after any real checkout; standing cadence) | claude | no | — | — | `docs/user-journeys.md:189-198` |
| **D20** | **Ruling owed: 28 dangling rows** (`verifier_codes` 17, `break_glass_codes` 10, `recipient_codes` 1; all historical residue of a hand-written `DELETE FROM users` 08-08..14; both cascades now work). Purge (Claude drafts a scoped DELETE, executes under `.env.admin` on GO, re-census) **or** rule them acceptable and demote the census to NOTICE. **Never** widen the ignore list without a ruling | steve (ruling); co-pilot (purge) | destructive production write | `verify:orphans` exits 0 | — | `deferred.rows-outlived-the-accounts-that-owned-them`; `npm run verify:orphans` 2026-08-27 |
| **D21** | Place `.env.ro` (`relay_ro`: SELECT-only, **no KMS**, reads PII) in the Claude Code cloud environment / CI **and observe one of the five verifications running there** ("wired is not enough"). Prefer the no-stored-secret shape if one exists for DSQL (the `kms-wall` OIDC pattern). Precondition: B16.1 | steve (placement); claude (observed run) | credential placement | unattended agents verify schema/dogfood/orphans/funnel/roles | — | `deferred.the-read-only-identity-is-not-in-the-cloud` |
| D22 NEW | `/api/health` is 404 **by design** (the health surface is `/api/health/scheduler` and `/api/health/delivery-webhook`; a bare 200 is the signal `canary.ts` argues is worthless). Record the intentional absence in CLAUDE.md and point the portfolio live-probe / `/verify` convention at the scheduler route — no new route | claude | no | — | — | `lib/ops/canary.ts:18-21` |
| D23 NEW | `ratified.relay-resumed-2026-08-21.review_on: 2026-10-21` — carried from the park entry; what it reviews is unstated. State it (precedence? runway?) or remove with a record. Also fix the two entries' time-base date contradiction with a note, not a silent edit | steve (what); claude (record) | one line | — | 2026-10-21 (`review_on`) | `ratified.relay-resumed-2026-08-21` |
| **D25** NEW 📝 | **Ruling owed: FR9 `/api/demo/simulate`** — exercisable by no account (0 demo-flagged users; only one `totp_secret` in the cluster) though code-reachable (`TriggersPageClient.tsx:261` posts to it from a `SimulatePanel` shown when `isDemo`), with a real CAS write path behind it. Retire the route + its `route.test.ts` + the `SimulatePanel`/`isDemo` plumbing + `scripts/demo-run.ts` + the CLAUDE.md:101 reset-demo instruction + the `resolve-totp-secret.ts:23` comment (so `fetch-routes-exist.test.ts` stays green), or re-seed a demo account (a production write). **Never confuse re-seeding with A0** | steve (ruling); claude (either) | ruling | honest FR9 build state | — | `ratified.demo-accounts-never-sweep.corrected` |
| D26 NEW | Migration ledger in the database (which migration reached which cluster) — filed 2026-08-15, never registered; `verify:schema`'s manifest is the stand-in. No documented problem → record as accepted-not-planned | steve (watch) | 5-gate | — | — | `docs/sprint-reports/2026-08-15-sprint.md §5 D4` |
| D27 NEW | Unfiled debt carried five sprints: `email_send_attempts` retention (one row per message forever); scrollable-regions raw-CSS guard coverage. File or record as accepted | claude | no | — | — | `docs/sprint-reports/2026-08-15-sprint-4-telemetry.md` |
| D28 NEW | Record the done-but-unrecorded: the 70 report-bridge rows purged from `email_delivery_events` (47 events, 0 orphans live); `.relay-dev-key.json` moved to 1Password (Steve confirms in one line); Vercel plan verified | claude (Steve: one line) | — | — | — | live `/api/health/delivery-webhook`; sprint reports 08-15 |

### E. Billing and subscription lifecycle

| ID | Item | Court | Manual? | Blocks / unlocks | Deadline (basis) | Source |
|---|---|---|---|---|---|---|
| **E1.1** | **E1′ precondition build:** a structural build marker in the webhook **response body** (`{received:true, build:<sha>}`), so the next attempt can prove which build answers — nine spliced deliveries reached `sendOnce` with n=0 and wrote nothing, "not a state the source can produce"; the dev server was proven to serve stale modules | claude | no | an interpretable proof attempt | before E1.2 | `deferred.the-lapse-notice-is-wired-not-live-proven.attempted_2.what_is_still_unexplained` |
| **E1.2** | **Route 3 — `wired + route-proven`:** a real captured `invoice.payment_failed` payload spliced with the LIVE subscription id, signed with the `stripe listen` secret, POSTed at a **local production build** (`next build && next start` on a free port — never `next dev`); confirm exactly one audit row (+ `undelivered` unless `DEV_MAIL_ALLOWLIST` names a controlled mailbox), re-POST, confirm silence. Writes one fabricated-invoice row to the owner's hash-chained log → Steve's OK. Cannot be POSTed at `relaystandby.com` without Steve revealing the live endpoint secret (Vercel-sensitive; in no local env file) | co-pilot | approval (+ DETAIL for the live secret) | honest label for the paywall decision | before the first paywall revisit (from 2026-10-01 — `ratified.beta-free-release.revisit` is a cadence, not a decision date; E1′ is its stated precondition) | `docs/e1-stripe-lapse-proof.md §5 route 3, §6` |
| **E1.3** | **Route 2 — the only schedulable route to `live-proven`:** a test-mode subscription created through relay's **own** checkout on a **disposable reserved-domain owner** (so `upsertSubscription` cannot overwrite Steve's live sub id), the renewal failed via a Stripe **test clock**, dashboard re-delivery of the same event, then `deleteAccount()` closes the owner (the sanctioned closer — the "destructive cleanup" becomes a cascade on a throwaway). Needs `DEV_MAIL_ALLOWLIST` for the inbox half (reserved TLDs are refused regardless) | co-pilot | approval | E1′ → `live-proven` | before the first paywall revisit (from 2026-10-01) | `docs/e1-stripe-lapse-proof.md §5 option 2` |
| E1.4 | Route 1 — a real live renewal failure proves everything and is not schedulable: the only subscription renews **2027-08-09** | steve | yes | — | — | `stripe subscriptions list --live` 2026-08-27 |
| **E1.5** | Stripe dashboard reads that no API exposes: **#3** Settings → Emails "Successful payments" receipts ON? (the product sends no receipt; this is the only one a customer gets) · **#4** webhook endpoint-failure notifications ON, to which address? (the handler returns 500 on purpose to force retries — this is the only monitor of a broken `STRIPE_WEBHOOK_SECRET`). Read, don't change — shared account | steve | yes — account-level dashboard settings | — | — | `docs/stripe-setup.md`; `docs/secret-rotation-runbook.md §4` |
| E1.6 | Reads #1 (endpoint carries all four events incl. `invoice.payment_failed`) and #2 (default portal cancels **at period end** → `/terms` "cancel … to stop the next one" is true) were answered **read-only via the Stripe CLI on 2026-08-27** — record both in `docs/stripe-setup.md` and close its 🔴/🟡 sections (rev 3 and the go-live checklist wrongly said "no CLI answers these") | claude | no | — | — | `stripe webhook_endpoints retrieve … --live`; `stripe billing_portal configurations list --live` (`bpc_1Tu3WlGs40KMmT4X7RYjcEXF`) |
| E1.7 | Guard the handler-event-list ↔ endpoint-event-list contract (a class, not an incident: the gap existed 08-20→08-21 and was found by hand) and the shared portal default (another product's operator can change it and falsify `/terms`): a read-only `verify:stripe` check comparing `enabled_events` + portal mode against the `case` list in `route.ts` and `lib/offer.ts`. Scheduling it needs a **restricted read-only Stripe key** (Steve mints) | claude (script); steve (key) | key minting | decorative → real | — | `docs/stripe-setup.md §a class, not an incident` |
| E1.8 NEW | **Stripe CLI session keys (live + test) expire 2026-10-07** — the only non-dashboard read path; re-pairing (`stripe login`) is Steve's browser. Six days after the paywall revisit | steve | yes | E1.2/E1.3/E1.7 lose their read/trigger path | **2026-10-07** (`~/.config/stripe/config.toml`) | config read 2026-08-27 (values not printed) |
| E1.9 | Re-state E1′'s `ends_when` in the register honestly (it still prescribes the `stripe trigger` method proven not to work) with the three routes and two labels; record the result in `deferred.a-failed-renewal-tells-the-owner-nothing` when done | claude | no | — | — | register text |
| E3 | Renewal receipt in-product (J5 "renewal as a value receipt") — gated: first **arms-length** subscription approaching renewal. Zero-cost half = E1.5 #3 | claude | no | — | event | rev 3 §2-F F-d |
| **E4.1** NEW 📝 | **Ruling owed BEFORE 2026-10-01: are releases billing-gated at all?** `assertCanRelease` guards **1 of 4** ARMED→PENDING paths (Initiate only; not the missed-check-in sweep, owner consent to an access request, or silence on a challenge). "Only the manual path" vs "all four" — recorded either way; `/terms` and guide §2.7 are silent on paths 2–4 and one must be edited in the flip commit. Exists only in a docs/ file today | steve | ruling | an honest flip | **2026-10-01** | `docs/paywall-flip-changeset.md §The flip does NOT paywall releases` |
| **E4.2** | **Paywall decision at the first revisit (from 2026-10-01)**: flip `TIER_LIMITS.free.canRelease` → false, or extend the beta with a **new dated** `revisit` (leaving it undated is the one illegitimate outcome). **The register's precondition is E1′ `live-proven`** (`ratified.relay-resumed-2026-08-21`); this plan proposes that `route-proven` (E1.2) is enough for the *decision* — a relaxation for Steve to ratify with the flip, never assumed. Flipping over an unproven lapse notice turns an expired card into a silently blocked release | steve | ruling | beta ends honestly | **2026-10-01** (`ratified.beta-free-release.revisit` — a re-raise cadence; this plan proposes deciding at the first one, Steve to confirm) | register |
| E4.3 | Execute the pre-written change-set in ONE commit: flag + comment, un-skip `entitlements.test.ts:227`, guide §2.7 + `node scripts/guide-pdf.mjs`, `/terms` + `/account` copy ("releases unavailable on free"), a test naming all four paths, fold the recipient(4)/verifier(4) caps into the same revisit; then `gate` + `verify:live` | claude | no | — | after E4.2 | `docs/paywall-flip-changeset.md` |
| E4.4 | Make the 2026-10-01 revisit **fire** — same mechanism as A0.dm | claude (after A0.dm) | no | — | — | `lib/ops/gates.test.ts:475` asserts presence only |
| E5 NEW | **Decision: does any billing check join an automated chain?** Five money-path rows are built-but-not-live-proven since the two webhook reworks (event-order independence; subscription id on either API shape; `customer.subscription.updated/deleted`; `deleteAccount` cancel-first at Stripe; E1). Every automated proof = a real charge on a shared account | steve | ruling (spend + blast radius) | — | — | `docs/user-journeys.md §The money path is in NO sweep` |
| E6 | Refunds are issued **by hand** in the Stripe dashboard (30-day money-back on every charge incl. renewals) — standing, by design | steve | yes | — | when a customer asks | `ratified.refund-stance` |
| E7 NEW 📝 | **Sales-tax / Stripe Tax posture is unruled** — $119/yr charged to US consumers by a sole proprietor; no doc mentions tax. Claude reads `stripe tax settings retrieve --live` first; Steve rules (register for Stripe Tax / collect nothing until a threshold / "accepted until first revenue" with a revisit). Shared account — never enable without the other products' say | steve (ruling); claude (read) | ruling | an honest G4 draft | before G4 | `grep -i 'stripe tax'` = 0 hits |

### F. Product work — gated on demand evidence (all known, scoped, deliberately unbuilt; **do not start**)

| ID | Item | Unlocks when | Source |
|---|---|---|---|
| F-a | Remaining requirable factors (sms, email, passkey, hardware_key, security_questions) — **HELD on a number**: resumes when a non-zero count of owners has answered the authenticator-code question in production (`verify:factors` reports it); D3's closing did not deliver the answer | first real declaration answers (needs A0 + strangers) | `deferred.requirable-factors-beyond-the-authenticator-code.held` |
| F-b | Field-level vault-item editing (single-item ciphertext endpoint) + the `/api/kms/unwrap` owner-branch step-up decision **in the same change** (B26) | first real owner maintains a vault over time | `ratified.no-single-item-ciphertext-endpoint-yet` |
| F-c | J8 completion slice: single-next-action card, ephemeral reveal (nothing expires the rendered value), shared per-step progress | a real recipient's observed need | `docs/user-journeys.md` J8 rows 4–6 |
| F-d | Renewal receipt (= E3), quarterly continuity review (carries J7-R13 verifier response-rate), life-event prompts. (The reminder **ladder** shipped 2026-08-21 — B15.1 proves it) | first arms-length subscription approaching renewal | rev 3 F-d |
| F-e | J2: by-exception review screen, top-three gap framing, two item-level continuity-ready conditions, document + email ingestion lanes | demand evidence | `docs/user-journeys.md` J2 rows 1/6/8/9 |
| F-f | J3 monthly delegate digest (new outbound mail → `ratified.outbound-mail-bounds`) | demand evidence | J3 row 8 |
| F-g | Secret-types Phase 2: QR scanning of `otpauth://` (Q11 structural upload guard); AI inference of `factors_required` (Q7: never downgrade an explicit answer) | F-a evidence + demand | `docs/secret-types-design.md §5` |
| F-h | Standby Sprint F / Phase 4: Standby Card, [A5] owner one-page plan, wallet pass, circle visibility (default off), SMS channel (rung 5 — also C4), annual re-confirm cadence (Risk 5) | **post-G1** by ratified plan | `docs/standby-sprint-plan.md §2 Sprint F` |
| F-i | KYC at claim — vendor needed (Persona / Onfido / Stripe Identity class); vendor selection + contract are Steve's | a partner's diligence or a real user demands it | rev 3 F-i |
| F-j | = E4 (the paywall flip) | 2026-10-01 revisit | — |
| F-k NEW | J5-R3 per-trigger-type check-in cadence (one interval per owner today; every armed type on the same clock; needs a migration) — missing from rev 3 §2-F | demand evidence | `docs/user-journeys.md` J5 row 2, "genuinely open" #2 |
| F-l NEW | J1 behavioral qualifier ("managing someone else's affairs?") + latent-tier email capture; **ruling**: give the abandon-after-seed nurture branch a §2-F unlock or strike it (new outbound capability) | demand evidence (build); Steve (ruling) | J1-R2; Part VIII #7 |
| F-m NEW | J4 proposed N-of-M defaults per trigger type (today: bare number input, `?? 1`) | demand evidence | J4 row 6 |
| F-n NEW | J6 refinements: evidence attachment (`evidence_ref` column exists, never written, no control), owner challenge on channels beyond email (→ C4), time-remaining on the recipient's status | demand evidence | J6 rows 2/3/5 |
| F-o NEW | Owner preview of the recipient's view ("before a real handover, not before beta") | demand evidence | sprint-6 vault-wiring report §8 |
| F-p NEW | `/audit` renders `RELEASE_NOTICE_UNDELIVERED_ACTION` as a raw action string (cosmetic) | a real owner reads `/audit` | 2026-08-16 sprint §6 |
| F-q NEW | Rate-limit stance Option B: durable counters on `/api/caregivers/interest` and `/api/auth/signup` **only** (audit_log-metered, no migration); Option C (shared store) stays closed | first arms-length person / first placement / observed abuse | `docs/rate-limit-stance-2026-08-20.md` |

### G. Commercial hardening and the un-ruled Build Spec planks

| ID | Item | Trigger | Court |
|---|---|---|---|
| G1 | B2B2C / white-label tenancy (§22) — **only against a signed pilot's actual requirements**; B5 precedes any second tenant | `gates.g3` met | claude |
| G2 | Third-party security audit + pen test + NextAuth session-hardening review (§20) — "G5, once G4 exists"; "one audit is worth more than a decade of the figures" | Sprint 8 | steve (vendor, money) |
| G3 | Zero-knowledge productionization — threshold crypto, HSM-backed custody, recovery quorums (§20); B5 is the structural prerequisite | post-G3 scale | claude |
| G4 | **Mobile (§23) survives in rev 3 §2-G with no trigger** — under §1 that makes it unschedulable; assign one (partner pull / first N recipients on mobile) or strike | ruling | steve |
| G5 | Provider handoff integrations + ingestion tiers 2–4 (§21); per-jurisdiction residency (§22) | partner pull | claude |
| G6 | **Entity and insurance re-decision** (no entity, no EIN today; E&O / cyber cover) — funded from the opportunity, not ahead of it | arms-length money or a partner's diligence | steve |
| G7 | Counsel re-engagement — g2's revisit triggers (a) first regulated-partner conversation, (b) first estate inbound, (c) G1 passing — plus the **delegate-model question** Part VIII #3 says did not go away with G2 | any trigger | steve (money) |
| G8 | On G1 pass: draft G4 (billing MVP) and G5 (audited crypto) as `gates:` entries; promote the ladder | G1 met | co-pilot |
| G9 NEW | **Un-ruled spec planks** the Build Spec banner names: §18 incapacity verification (is N-of-M human verifiers the decided end state?); §19 compliance programmes (SOC 2, GDPR/CCPA, **a DPA template** — the first two questions a regulated G3 partner asks; plus **E7 tax**, which §19 never named); §20 legible trust (bug bounty, whitepaper); §21 open standard; §22 ops (SLOs, a **failover drill** — the H0 failover has never been re-exercised); §23/§24 editions — and `business` / `travel` remain **user-selectable trigger types during a caregiver-only demand test** | each a disposition (rule out / defer with trigger) | steve |
| G10 NEW | Req 13.6 owner-facing plan preview/annotation — not built, not retired, not ruled | ruling | steve |
| G11 NEW | Design decisions with no owner ruling: recovery and release quorums sharing one social graph (Part VI); owner-challenge window per trigger type (2h emergency is a proposal) | Claude drafts options; Steve rules | steve |

### H. Documents and the register — the drift found on 2026-08-27

Every item here is Claude's, effort S, and belongs to Sprint 0. The ones marked 📝 create the
missing `PROJECT.yaml → deferred` entries; a finding recorded only in this file is one session from
being lost (§8).

- 📝 Register entries to add (owner + `ends_when`): C1.0, C1, C2, C3 (DMARC/Outlook — in no register
  entry at all); B10; B11/B12; B14; B17; B18 (cadence); B20; B35; B36; B38; E4.1; E7; D25; B15.4;
  A0.dm/E4.4 (one entry, two dates); G6 (entity + insurance — triggers: arms-length money or a
  partner's diligence; `ratified.relay-operator-is-an-individual` carries no revisit for it); and
  `market.demand_signal: none` — the field the portfolio rule requires does not exist in
  `PROJECT.yaml` (the four hits are prose in comments); A8 *adds* it on pass.
- Register corrections: `every-secrets-age-is-unknown.note` says `@aws-sdk/client-iam` is not a
  dependency (it is a devDependency); `relay-resumed.corrected.not_fixed_here` and
  `relay-parked.corrected` say scheduling `verify:kms` needs a stored secret (superseded by the OIDC
  watch — add pointers, do not edit ratified text); the park/resume `date:` time-base note (D23);
  `beta-cohort-deferred.also_deferred_same_session` lists three done items as deferred; `g1-caregiver-wtp.instrument_retired` still calls the threshold re-derivation an open task (ratified 08-20 — add a pointer); reconcile the two merchant-name revisit triggers; E1.9.
  **Pointers the renumbering in this revision broke (notes beside ratified text, never edits to it):**
  `the-owners-vault-is-empty.sprint_1_calendar_lapsed.revisit_basis` names the out-of-repo checklist →
  `docs/vault-checklist-sprint-1.md`; `:71` "ROADMAP.md sprint 1 items 1.1-1.3" → "§2 A0 / §6 Sitting
  A"; `:3154` "sprint 2 item 2.6" → "§2 A3.7"; `:2022`/`:2993` "ROADMAP.md §7 states the rule" → §8.
  **Three more register defects:** `rows-outlived….ends_when` still says "The 38 rows" (its own note
  bans a count — "the rows the census reports"); `unit-economics-are-unmodelled.closed` still calls
  the Vercel plan unverified (it is `pro`, API read 2026-08-27); `journey-safety-subset.ladder` says
  "NOTHING here is live-proven" while `e2e-request.ts` walks the 12h cooling-off and `e2e-ui.ts`
  covers `/circle` — only the reminder ladder and owner self-naming remain unproven.
- **Supersession banners — applied in this change:** `docs/go-live-checklist-steve.md` and
  `docs/steve-actions-2026-08-21.md` → `SUPERSEDED BY ROADMAP.md §6 (2026-08-27)`; `docs/backlog.md`
  → `SUPERSEDED BY ROADMAP.md §3`; `__project-docs/relay-manual-actions-checklist-2026-08-21.md` →
  §6; `__project-docs/relay-vault-checklist-SPRINT-1.md` (PARKED banner) → its in-repo copy
  `docs/vault-checklist-sprint-1.md`. **Owed (Sprint 0.7):** `docs/h0-disposition-plan.md` (two
  invariants now false); `docs/g4-billing-design.md` (its two gates were overtaken);
  `docs/product-readiness-assessment-2026-08-16.md` (items 1–2 ruled; only the editor kit remains).
- Stale-description fixes: `docs/stripe-setup.md` (E1.6); `docs/a2p-registration-prep.md` ("Standard,
  LLC" ×3 → Sole Proprietor); `docs/encryption-context-{design,rollout}.md` + `backlog.md` ("037 not
  applied" → applied); `docs/g1-editorial-lane.md` (thresholds "await ratification"; Next Avenue row);
  `docs/oped-angle-3-draft.md` rows 8–9 (satisfied by the 08-20 ratification and the 08-14/18 proofs) and the lapsed 08-19 date; `docs/g1-flight-log.md`
  window table (A7.2) and the resolved 08-16 offset row; `docs/beta-cohort-handoff.md` (revisit 08-23;
  the dedupe trap); `docs/g3-partner-dossier.md` (outreach log); `docs/user-journeys.md:478-496` (J6
  deny/approve were walked); `README.md` "verifier deny/abstain" rung; `docs/standby-sprint-plan.md`
  (three "deferred" items are built; "Sprint 5 item 5.2" does not exist); `docs/implementation-plan-4-sprints.md`
  line 554 (CC9 live); `docs/use-cases.html:154,481`; `docs/security-remediation-plan.md §B` (the
  500 is fixed); `docs/retired-surface.md` (`KNOWN_UNREACHABLE` is empty); `docs/least-privilege-cutover.md`
  (self-contradiction on the IAM half); `scripts/verify-kms.ts` / `verify-iam.ts` headers ("NOT IN
  CI"); `scripts/{verify-schema,verify-roles,flight-snapshot}.ts` + `lib/g1/flight-snapshot.ts` headers
  (`.env.local`/`relay_dev` → `.env.ro`/`relay_ro`); `lib/release/verifier-context.ts` (B15.5);
  `.env.example:38-39` (production is on `relay_app`) and `:236,:274` (scripts that do not exist);
  `.kiro/specs/…/requirements.md` 5.3, 7.3, 11.5/17.4, 3.1 (truth defects vs the build);
  `infra/README.md` + `docs/SUBMISSION-RUNBOOK.md:123` (the inert Deny is credited as the ZK boundary);
  `production-canary.yml` header (B13); CLAUDE.md:101 (reset-demo instruction → D25) and the
  `/api/health` note (D22); `docs/outlook-sender-support-submission.md` step 0 and
  `docs/deliverability-options-3-and-5.md` step 1 + date (C1.4); `docs/g1-launch-checklist.md` step
  2 (the `exp/security-remediation` branch is gone); `docs/standby-sprint-plan.md §23` ("thirteen
  further findings … unaddressed" — reconcile or strike); `docs/user-journeys.md` Part VIII low-end-
  phone row (CC8 closed on a simulated check — say so); `scripts/verify-dogfood.ts:70` ("sprint 1
  items 1.1-1.3" → "§2 A0 / §6 Sitting A"); `lib/ops/verify-live-freshness.ts:38` ("next fires
  ~2026-09-04" — a worked example that reads as a date).
- Memory hygiene (outside the repo) — **done 2026-08-27, between the sweep and this revision**: the
  superseded park memory deleted (the resumed memory had said so already); the 08-24 memory's
  "8 open / 5 Steve's" corrected to 9 / 6 in place; its dangling `e1-stripe-finding` link replaced
  with the register path.

---

## 2.5 THE PLAN — what to do next, and in what order (revision 5, 2026-08-29)

Sprint 0 is **closed**: every row is done or explicitly not taken (§3). So this is not a re-plan of
Sprint 0; it is the sequencing of what §0.5 found still standing between here and production.

**The ordering principle, restated because it decides every row below:** obliged work is justified
by a property of the live system and would still be justified if no new user arrived; barred work is
justified by a forecast. Everything in P0–P2 is obliged. Nothing in §2-F or §2-G may start.

---

### ~~P0 — now · the reminder ladder, and the A0 that makes it reachable~~ — ✅ **CLOSED 2026-08-30**

**P0.1 — Walk the check-in reminder ladder (B15.1's unexercised half).** ✅ **Closed, and not the
way this row specified.** The walk was built and run on 08-29 (`verify:reminder`) and it established
that *the method written below cannot work*: `sweepCheckinReminders` writes its audit row ONLY on
successful delivery, and `email.ts` refuses reserved TLDs unconditionally, so a disposable owner
satisfies neither side and there is no row to assert. The *Done when* clause below was therefore
unsatisfiable as written. What the walk proves instead is the PRECONDITIONS, and it says so loudly
rather than leaving a red check against a blameless product.

> *The superseded method, kept because the correction is the finding:* a disposable owner,
> `last_active_at` backdated to ~80% of a short interval, wait for production's own hourly cron and
> assert `owner_checkin_reminder_first`. *Done when:* an `owner_checkin_reminder_*` audit row exists
> that a cron wrote.

**P0.1′ — the observer, which is what that walk actually asked for.** ✅ **Built and live-proven
2026-08-30, green and red, writing nothing.** The 08-29 commit named the real deliverable — *"the
thing worth building before then is something that NOTICES whether it fired, because the failure is
silent by design and nobody will be watching at 15:49 on a Monday."* That is now
`/api/health/reminders` + `.github/workflows/reminder-ladder-monitor.yml` (daily, the tier
`cadence-watch` measured at 100%) + `npm run check:ladder`. It asks the OUTCOME question — is any
owner past a rung with nothing in the audit log — by calling `dueRung` rather than restating 75%/90%,
and it declares the rung windows it structurally cannot report on instead of returning a bare
"healthy". ⚠️ **Do not quote the firing date from this file** — it moves every time the owner signs
in. `npm run check:ladder` prints it.

**P0.2 — A0, with Steve co-piloting.** ✅ **CLOSED 2026-08-29** — `verify:dogfood` reads READY, six
checks green, every write Steve's own. See §0.5.

---

### P1 — before 2026-09-12 (precedence lifts) · Claude's court — **four of five closed 2026-08-30**

**P1.1 — B11.1, the re-measure, on or after 09-02.** ⏳ **DATE-BLOCKED, not skipped.** Today is
2026-08-30; the row's own precondition is three days out. Narrow question: does the
frequency-selective pattern persist past the reset? Command in
`deferred.the-scheduled-monitors-are-collapsing`. Whatever it shows, **B12 is the fix** — record the
answer either way.

**P1.2 — B15.2 and B15.3.** ✅ **BOTH LIVE-PROVEN 2026-08-30.**
- **B15.2** — `npm run verify:decision`, 27/27. Abstain, deny, and the J7-R7 halt, none of which had
  run outside a unit test. The discriminating assertion is that an abstention on a 2-of-2 leaves the
  release OPEN — fold abstain into the denial count, which is the simplification a refactor reaches
  for, and that same abstention halts it. Also proves an unconfirmed verifier's denial is
  `not_counted` **with the quorum ledger left untouched**, which is the load-bearing half.
  `README.md`'s "verifier deny/abstain" rung is now true.
- **B15.3** — `npm run verify:escalation`, 22/22 on the derive-on-read half. Walks **both** paths
  that fire the lapse, not only the cron this row names: `standby-resolve.ts` swallows its
  escalation error so rung 0 still renders, which makes that path's failure mode completely silent.
  The assertion that matters is `received_confirmations === 0` after escalation — a lapse is the
  ABSENCE of a signal, and if that ever reads 1, silence has been promoted to consent.
  ✅ **The cron half landed too, 22/22**: at **2026-08-30T06:00:59Z** production's own hourly
  Vercel cron ticked and escalated the request with nothing local calling it. Both paths that can
  fire this transition have now been watched, on the same day, by the same script.

**P1.3 — B15.5**, the `verifier-context.ts` action fix. ✅ **BUILT 2026-08-30 — and it was not the
two-line fix this file called it.** The known half was the dead action name. The half nobody had
looked at: the read was keyed on `entity_id = <release id>` while the ladder writes against the
OWNER with no `entityId` at all, so correcting the name alone would have left the row exactly as
unreachable **and would have looked like a fix**. ⚠️ The pre-existing test passed throughout,
because a mocked `query` answers with its fixture whatever it was asked.

**P1.4 — D1 cadence.** ✅ **MEASURED 2026-08-30, and neither is due.** `verify:live` last stamped
2026-08-29T07:45:36Z (fires 2026-09-12 07:45Z), `verify:journeys` 2026-08-29T07:53:10Z (fires
2026-09-19 07:53Z). Both chains ran the day before this sprint. Re-running them now would spend the
10-signup hourly budget to reset a clock with thirteen days on it. ⚠️ **`verify:live` falls due on
the same day precedence lifts** — it belongs in the 09-12 block, not before it. The one changed path
a chain covers (`standDownTrigger`) was live-exercised twice on 08-30 by the two new walks, one of
which asserts the 404 that replaced its 500.

**P1.5 — Prepare, do not execute, the `verify:iam` OIDC role.** ✅ **DRAFTED 2026-08-30 —
`docs/iam-wall-oidc-role-proposal.md`.** Trust policy pinned to `repo:sgharlow/relay:ref:refs/heads/master`
(the control that keeps a fork's PR out of it, on a PUBLIC repo), the eight IAM read actions derived
from the five calls the script actually makes, and the `Resource: "*"` defended rather than hidden.
🔴 It also names the recursion this row did not: creating the role without a fifth `CONTRACTS` entry
makes a principal the IAM wall does not watch, *using the IAM wall as the reason for creating it*.
**Nothing has been executed.** One line to rule on, at the bottom of that file.

---

### P2 — 2026-09-12, the day precedence lifts · Steve's hands · sized in minutes

Order matters here and it is not the order the sittings were written in.

**~~P2.1 — Sitting A: A0, the owner's vault. ~20 minutes.~~** ✅ **DONE 2026-08-29, three weeks
early** — Steve co-piloted it the same evening this revision was written, so it never reached the
sitting it was scheduled into. §0.5 was updated; **this row was not, and said "do this first" for a
day after it was finished.** Recorded rather than silently deleted: it is the drift §8 exists to
prevent, in the one file that is supposed to be authoritative, found by re-reading the plan while
executing it.

⚠️ **The consequence is a reordering, not just a strike.** P2.1 was the row everything else on
2026-09-12 was sequenced behind. With it closed, **P2.3 (the rulings pack) is now first** and
**A1.3 goes first within it**, because it heads Sprint 2's critical path and nothing in the demand
lane can be drafted until it is answered. The sitting is also ~20 minutes shorter than §6 says.

**P2.2 — Sitting E: three toggles, ~10 minutes.** A7.0 Web Analytics (hard precondition of Sprint 5
— the instrument currently collects nothing readable); the restricted read-only Stripe key (before
the CLI expires 2026-10-07); connect the browser extension (so the `relay-alarm` filter can finally
be read, closing the "why does delivery work" question).

**P2.3 — Sitting D-1: the rulings pack, ~25 minutes.** Ready to run at
`docs/rulings-pack-sitting-d.md`, with B30 struck (closed 08-29) and B10's question rewritten.
**A1.3 goes first** — it heads Sprint 2's critical path and nothing in the demand lane can be
drafted until it is answered.

**P2.4 — B12, the off-GitHub heartbeat: the decision this analysis forces.** Previously one of two
options behind the 09-02 re-measure. The other option — money on the GitHub account — is disproven,
so this is now the only route to "a failure is noticed by a machine". 5-gate, Sitting H to build.

---

### P3 — 2026-09-12 → 2026-10-01 · the fortnight the whole plan exists for

Sprint 2 unchanged: the demand lane fires. A1 → A2 → A3 → A6, with A7.0 confirmed collecting first.
**This is the fourth revision to say the demand lane is the binding constraint.** The three before
it were right and it did not move, because the engineering lane needs nobody and the demand lane
needs Steve. P2.1 is deliberately placed before the rulings for that reason: a 20-minute action that
has slipped for a month does not slip because it is hard.

---

### P4 — dated, after 2026-10-01

E4.1 ruling → E4.2 paywall decision (10-01) · E1.8 Stripe CLI re-pair (10-07) · B30's date passes
harmlessly now (10-03, closed) · `gates.d3-restore-drill` (11-08, and its criterion 3 needs A0) ·
`gates.g3-b2b2c-pilot-loi` (11-30) · `gates.g1-arms-length-demand` (12-31).

---

### Explicitly NOT in this plan, and why

| item | why not |
|---|---|
| **B5** KMS encryption context | Steve ruled DEFER 2026-08-20; `reopens_when` conditions unmet |
| **D2** requirable factors | HELD — waits on evidence owners answer the first question |
| Auth/React major versions | barred by the portfolio Infrastructure Change Policy |
| Everything in **§2-F** and **§2-G** | barred until their named event; starting early is the defect |
| Purging the 28 dangling rows | Steve's, destructive, and twice confirmed as inert residue |

---

## 3. The sprints

Effort: **S** ≤ a day · **M** ≤ a week · **L** longer. Sprints 0–4 are **calendar-anchored** (each
date is derived from a `PROJECT.yaml` field or a live measurement, named inline); Sprints 5–8 are
**event-anchored** and **must not start early**. Ordering inside a sprint is by what blocks what.

**The shape:** Sprint 0 is everything Claude can do before Steve's hands are free; Sprint 1 is the
smallest set of Steve actions — measured in minutes — for the day the precedence ruling lifts;
Sprint 2 is the demand lane, fired in one fortnight; Sprints 3 and 4 are the two co-pilot sessions
with dated gates behind them. Nothing in Sprints 5–8 is scheduled by a date.

### Sprint 0 — Truthful alarms, truthful record *(calendar: now → 2026-09-12 · Claude's court · needs at most a nod or an in-session authorisation, never Steve's hands)*

> ✅ **SPRINT 0 IS CLOSED, 2026-08-29.** Rows 0.1–0.4 and 0.6–0.8 are done (PRs #17, #19–#28);
> **0.5 was offered and NOT taken** — the B15 ladder walks need production writes and hours of
> elapsed time, and Steve chose the two chains instead. B15.1's sweep half was subsequently proven
> anyway (§0.0 row 9); its ladder half is now **P0.1** and is dated, because it fires for a real
> customer on 2026-09-01.
>
> **What Sprint 0 was designed to do, it did:** spend the engineering lane down so that 09-12 has
> only the demand lane and one sitting left. **What it also did, unplanned:** disprove six of
> revision 4's own recorded claims (§0.0). That was not on the plan and is the more valuable half.
>
> ⚠️ **What it did NOT do: repair the largest gap.** The monitor collapse is now *measured, watched
> and correctly diagnosed* — and unfixed. `cadence-watch.yml` reports it daily; only B12 repairs it.
> Converting a silent defect into a reported one is real progress and is not the same as progress.

**Why first:** the custodial obligation's "noticed by a machine" clause is false today at its last
hop (B10, B11), several guards are decorative (B13, B14), the IAM wall has never read the account
(B16), and the record contradicts itself in ~40 places (H). All of it is obliged, none of it is
horizontal build, and all of it can be finished before 09-12 so that Sprint 1 asks Steve for
minutes, not hours.

| # | Item | Effort | Notes |
|---|---|---|---|
| 0.1 | **This revision**: rewrite `ROADMAP.md`; banner the four checklists; move the vault checklist into `docs/` — all drafted in this change, **landing via PR** (`master` is protected). Then, in the next commit: the 📝 register entries, the register corrections and pointer notes (H), and the three remaining banners | S | **DONE 2026-08-28.** The register commit landed: 16 📝 entries (each with `owner` + `ends_when`), the register corrections, the four broken pointers, and the three owed banners — see the Done-when note below |
| 0.2 | **B16.1–B16.6** | S | ✅ **DONE 2026-08-29** — all six closed against the real account, read-only. See the note below; **D21's precondition is met** |
| 0.3 | ✅ **DONE 2026-08-29** (PR #20). **B13** proof-of-red: dispatch the canary at a dead host; dispatch `date-guards` on a throwaway branch with a planted past-due gate; PR adding `health_url` inputs to the two monitors; fix the canary header. **B14** `verify:journeys` stamp + dead-man. **B10.d** read the Gmail filter / blocked-address rules via Claude-in-Chrome (read-only) and name the one that trashes GitHub mail. **A7.0** establish whether Web Analytics is collecting (one `get_web_analytics` read after a `src=qa` visit) and extend `verify:funnel` to assert the collector's 2xx | S | inbox half waits for B10 |
| 0.4 | ✅ **DONE 2026-08-29** (PR #21). **E1.1** build marker in the webhook response body; **E1.6** record Stripe reads #1/#2; **E1.9** re-state E1′'s `ends_when`; **E1.7** the `verify:stripe` contract script (scheduling waits for a key) | S | all credential-free except the CLI reads already taken |
| 0.5 | **B15.1/2/3/5/6** live proofs: J5-R4 ladder walk (disposable owner, short interval, hourly ticks); verifier deny/abstain/halt walk; J6 4c escalation walk; `verifier-context.ts` action fix; step-up fault injection. Schedule around the signup ceiling (D14): one chain per hour, `verify:live` first (D1) | M | write disposable production rows — tell Steve first; `verify:orphans` after each |
| 0.6 | 🟡 **PART DONE 2026-08-29** (PR #22 — D1 done; B11.1 waits for 09-02, B12.i open). **D1** `verify:live` + `verify:orphans` before **~2026-09-08**; **B11.1** re-measure monitor cadence on **2026-09-02**; **B12.i** the interim off-GitHub run-count alarm (Task Scheduler, read-only `gh api`) | S | the freshness stamp commit also resets the 60-day clock |
| 0.7 | **Hygiene**: D16 branches; D17 `sprint-state.json`; D18 unit-economics (pro; the Resend receipts read via the connector — B40's facts); B37 `go-live.sh`/`demo-run.ts` banners; B39 estate banners on six files; ~~the three owed supersession banners (H)~~ **DONE 2026-08-28**; B21.1 `verify:csp` npm script; B24 incident step-0 tool; D22 `/api/health` note; C1.4's three files; **C1.3** read the trashed 08-17 report via the connector (read works on Trash); **A3.7** record the third cohort deferral on `beta-cohort-deferred-four-days`; **B18.4** `DSQL_PASSWORD` empty check (`vercel env ls production`, names only); **D27** file-or-accept the two unfiled debts; **B33** turn the recovery-code check into a read-only NOTICE; **B27** enable secret scanning + Dependabot alerts and **B31** disable the sibling backup plan — both on an in-session nod; the H stale-description list; **B30 fix B** prepared as a PR (parser treats `superseded_by:` as a stopped clock — merge on Steve's nod, before 2026-10-03) | M | every edit is docs/tests/scripts/repo settings; no production write |
| 0.8 | ✅ **DONE 2026-08-29** — `docs/rulings-pack-sitting-d.md`. **The rulings pack**: draft the Sitting D list as a batched `AskUserQuestion` series (≤4–5 per call, recommended default first, D-1 before D-2), with candidate causes for B10 from B10.d, and the C1.0 DNS change under `/safe-execute` (snapshot, rollback, DoH proof) ready to execute on Steve's request | S | so Sitting D costs Steve minutes, not re-derivation |

> **Progress, 2026-08-29 — rows 0.3 and 0.4 closed, 0.6's D1 half closed. Three PRs (#20, #21,
> #22), all merged. Several findings, and three of them change this plan rather than executing it.**
>
> **B13 — three of four alarms proven red.** Canary run `33237399208` (first red in 688 runs),
> scheduler-monitor `33237979699`, delivery-webhook-monitor `33237980971` (first red in 14 runs;
> its four-condition diagnosis block printed for the first time ever). The two monitors could not
> be forced red at all before: both carried `workflow_dispatch: {}` with the comment *"so the
> alarm can be proven to work on demand"* while hard-coding `HEALTH_URL` — the canary's own false
> comment, copied. Each file now records which red it proved and which it did not: all three
> failed at DNS, so none exercised its body-reading branch, and for the delivery monitor that is
> the interesting gap, since `meaning` is the whole point of it.
>
> 🔴 **The canary's cadence claim was never counted, and the real number is not close.** The header
> said "~1,200 scheduled runs" and "caught within a quarter of an hour". Measured over its whole
> life: **684 scheduled runs against a nominal 1,914 — 35.7%**; median gap 31 min, p90 65, p99
> 211, **max 697 (11.6 h)**; only 30 of 683 gaps were the ≤16 min the cron asks for. "~1,200" was
> the nominal schedule written as if it were a count. The derivation command is now in the file.
>
> ⚠️ **`date-guards` cannot be proven red from this machine, and it is structural.**
> `~/.claude/hooks/pre-push-check.sh` runs the full suite on every push and refuses a red branch —
> and the planted past-due gate makes the suite red *by construction*, because the guard this
> workflow runs IS a test in that suite. Attempted, confirmed (`gates.test.ts` reported
> `d3-restore-drill — due 2026-01-15`), reverted. No timezone workaround: `gates.test.ts` uses
> `toISOString()`. **Steve ruled 2026-08-29: wait for it to fire naturally** — and the same sitting
> ruled to run both chains, which resets the clocks whose lapse would make it red. The natural red
> is now no earlier than **2026-09-12**. That proof is deferred, not scheduled.
>
> **B14 — closed, and closed structurally.** `verify:journeys` ends in `verify:stamp:journeys` →
> `docs/verify-journeys-runs.jsonl` → a dead-man at **21 days** (not 14; the chains cannot share an
> hour, and both bounds are asserted by test). `lib/ops/chain-dead-man.test.ts` fails when ANY
> multi-walk `verify:*` script lacks a stamp, a log and a dead-man, or when a stamp is not the
> final step — so a third chain cannot ship the way the second did. **Live-proven the same day**:
> the real chain run that evening wrote the first script-written stamp.
>
> 🔴 **A7.0 disproves the check this roadmap asked for.** Vercel's query API refuses the project
> (`web_analytics_not_enabled`) while the edge serves the collector and answers **200 OK** to both
> `/_vercel/insights/view` and `/_vercel/insights/event`. §2-A's A7.0 prescribed extending
> `verify:funnel` to assert the collector returns 2xx — **that check would pass today on a project
> that collects nothing readable.** A stricter version of an instrument that measures the wrong
> thing. The discriminating read is the QUERY side, which needs an API token and so does not
> belong in a browser walk as written. Recorded, not built; the toggle comes first (Sitting E).
>
> 🔴 **B10's premise is false, and delivery is proven.** All three deliberate red runs reached the
> **INBOX** — labelled `relay-alarm`, starred — in 23–37 seconds. The ~20 historical threads are
> **archived, not trashed** (`relay-alarm` + `IMPORTANT`, no `INBOX` label); the `relay-alarm`
> label holds exactly 23 messages, 14 unread, and "about half unread" is B10's own detail, so the
> same threads were being read — what was misread is that the distinguishing feature is the
> *absence* of INBOX. The specific mail B10 cites as TRASH+UNREAD carries no TRASH live, so
> `the_evidence_expires` and its 2026-09-24 purge date are moot. B10's `ends_when` asked for one
> fresh deliberate failure observed arriving with an INBOX label; it has three. **Still unknown:
> why it works** — the filter was never read (the browser extension is not connected).
>
> **E1.6 — both reads answered, and neither needed Steve.** The live endpoint carries all four
> events including `invoice.payment_failed`, matching the handler's four `case`s, so
> `lib/billing/lapse-notice.ts` is NOT dead code — open since 08-20. The default portal cancels
> **`at_period_end`**, so `/terms` is true as written and no copy change is owed.
> ⚠️ `docs/stripe-setup.md` had addressed the first to Steve as "one dashboard checkbox" since
> 08-21, on the grounds that it "cannot be read from this repo". True about the repo, false about
> the machine: a paired CLI answers it read-only in one command. **An item sat in someone else's
> court for eight days because the tool that answers it was not on the list of tools considered.**
>
> **E1.7 — `npm run verify:stripe`, live-proven, exit 0.** The rule that matters is the one that
> is not ours to break: the portal configuration is ACCOUNT-level on an account shared with three
> other products, so another operator can make `/terms` a false statement to Relay's paying
> customers in one click. Fixtures verbatim from the live objects; every rule planted
> and caught (`npx vitest --run lib/ops/stripe-wall.test.ts` prints the count); exit codes
> 0/1/2 all demonstrated live. NOT scheduled —
> `STRIPE_READONLY_KEY` is unminted and the CLI fallback expires 2026-10-07.
>
> **E1.9 was already done** in the 08-28 register commit — verified, not redone. What it could not
> have is now added: reachability is closed by measurement.
>
> **E1.1 — the build marker** is in the webhook response behind signature verification.
> `loadedAt`/`instance` are captured at MODULE LOAD, because a marker read from `process.env` per
> request prints the same string from a stale module as from a fresh one — and a stale module is
> the leading unproven explanation for the nine deliveries. Its own test found a defect inspection
> had not: `??` accepts an empty string, yielding `sha: ""`.
>
> **D1 — both chains run against production** on Steve's say-so. `verify:live` green and stamped
> (next ~09-12); `verify:journeys` green and stamped (next ~09-19). `verify:orphans` after each:
> **0 reserved-domain accounts** both times and the dangling total **28 before, 28 after** — 15
> disposable accounts created and closed, zero new dangling rows, second independent confirmation
> that both cascades work. And `deferred.dangling-rows-on-production`'s own prediction came true:
> `auth_challenges` is now absent from the sweep entirely, its ten orphans having expired on their
> own.
>
> **Three repo guards fired during this work**, each catching something already missed —
> `date-guards-are-scheduled` refused the new dated guard until it was scheduled;
> `env-example.test.ts` refused two new variables until documented;
> `secrets-have-a-rotation-procedure.test.ts` refused the Stripe key until the runbook gained §8.
> The structural checks in `lib/ops/` are doing what their headers claim.

> **Progress, 2026-08-29 — 0.2 closed. The IAM wall has now read the account.**
> B16.1 ran with in-session authorisation: four principals, read-only, exit 0. Everything
> below is pinned **from that output**, not from the docs — which is the whole reason the row
> insisted on the read happening first.
>
> - **B16.2** `relay-dev`'s KMS action list is `kms:GenerateDataKey, kms:Decrypt`, now
>   `requires:` rather than a note explaining why it could not be asserted. The note is gone
>   because the reason it gave — *"the ACTION LIST was never written down anywhere in this
>   repo"* — stopped being true.
> - **B16.6** `RUNTIME_CONTRACT` requires the same two. It required only `dsql:DbConnect`, and
>   the note beside it said the KMS grant was "legitimate and not forbidden here" — both true,
>   and together they meant **a policy stripped of KMS passed**. The site would have kept
>   serving pages while silently losing the ability to write or reveal a vault item.
> - **B16.3, both halves.** GROUPS are now collected (`ListGroupsForUser` →
>   `ListAttachedGroupPolicies`/`ListGroupPolicies`) — none of the principals is in a group,
>   and *an empty read that can see is a different thing from no read at all*. RESOURCE
>   scoping is now asserted, not merely printed: every live policy names its ARNs (the two
>   DSQL clusters, one CMK), so `Resource: "*"` is a finding. A widened grant keeps a
>   byte-identical action list, which is exactly why an actions-only verdict missed it.
> - **B16.4** `relay-kms-wall-ci` is audited — the third identity in this repo to have been
>   watched by nothing (after `relay_ro` at the DB layer and `relay-ro` at the IAM layer).
>   Roles are a different set of API calls, this file's recurring blind-spot shape. **Its
>   TRUST policy is audited separately from its permissions**, and that is the sharper half:
>   the permissions are three KMS metadata reads, while the trust policy is what stops every
>   pull request against a PUBLIC repo from assuming it. Live: `StringEquals` on
>   `repo:sgharlow/relay:ref:refs/heads/master`. A `StringLike` is a finding **even when its
>   value contains that string** — `ref:refs/heads/*` matches every branch, so the operator is
>   checked, not just the value.
> - **B16.5 closed by measurement:** `relay-backend-dsql` is **ABSENT**. The H0-era role whose
>   template granted `dsql:DbConnectAdmin` does not exist, so there is nothing for Steve to
>   delete and Sprint 4.2's B16.5 line can come off. The inventory pass never acts — absence
>   is printed as the good answer rather than raised as an error.
>
> ⚠️ **Three defects found in the instruments themselves while doing this, all fixed here.**
> (1) The resource rule fired on an Allow carrying neither `Action` nor `NotAction` — a
> statement that grants nothing cannot over-reach, and the "empty or odd document" case caught
> it. (2) Nine test fixtures planted violations with **no `Resource` at all**, a shape IAM
> rejects on an identity policy — they were testing the checker against documents the account
> cannot produce, and would have made the new rule look wrong. (3) `wall-coverage.test.ts`
> demands the two walls watch the same set; a KMS-metadata ROLE has no
> `sys.iam_pg_role_mappings` row, so it is excluded **by `kind`, with an assertion naming every
> excluded principal** — silently narrowing a set-equality guard is how the hole it was written
> for gets re-opened.
>
> Verified: `verify:iam` exit 0 against the live account · full suite **3841 passed / 1
> skipped** (326 files; was 3828) · `tsc --noEmit` clean · `eslint --max-warnings=0` clean ·
> both new rules mutation-tested (disabling the resource check fails 2 cases; accepting
> `StringLike` as a pin fails 1).
>
> 🔴 **STILL NOT SEEN, and this list is shorter than it was:** permission boundaries (they can
> only narrow, so ignoring them makes this stricter than reality — the safe direction), and
> service control policies. Both were unlisted before.

> **Progress, 2026-08-28 — 0.1 closed.** The register commit landed. Every 📝 item in §2-H now has
> a `deferred` entry carrying `owner` and `ends_when`: B10, B11, B12, B14, B15 (incl. B15.4), B17,
> B18, B20, B35, B36, B38, E4.1, E7, D25, A0.dm+E4.4 (one entry, two dates, one missing mechanism)
> and G6. C1.0/C1/C2/C3 are covered by the B10 entry's delivery half plus the deliverability
> findings already in the register. The corrections and the four renumber-broken pointers are
> applied, E1.9 re-states E1′'s `ends_when`, `market.demand_signal: none` exists as a field rather
> than as prose in four comments, and the three owed banners are on. **`ends_when` was the point:**
> the ROADMAP holds the detail, but an entry that does not say who can move it and what would make
> it stop existing is a note, not an obligation. Verified before landing: full suite 3828 passed /
> 1 skipped (unchanged), `tsc --noEmit` clean, `eslint --max-warnings=0` clean.
>
> ⚠️ **One defect found while doing this, NOT fixed here and not in §2-H's list:** the open entry
> `deferred.verify-live-cannot-enter-ci` (D4) carries neither `owner` nor `ends_when` — the exact
> gap this commit closed for sixteen others. It is left alone rather than filled in silently,
> because guessing an owner for someone else's open item is how a register acquires fiction.

**Done when:** a red run's failure path has executed for every scheduled workflow (inbox half
pending B10); `verify:iam` has read the real account and the pins are committed; `verify:journeys`
has a dead-man; the E1′ marker is deployed; the stale-description list is empty; every 📝 item has
a register entry; a `verify:live` stamp younger than 14 days exists at the sprint's close and the
commits since it touch no walked path (or the chain was re-run); Web Analytics collection is
confirmed, or its absence is on Sitting E as a precondition of Sprint 5.

### Sprint 1 — The 20 minutes and the 2 minutes *(calendar: 2026-09-12 → ~2026-09-14, the C1.2 purge — the sprint's only hard expiry · Steve ≈ 1 hour in one sitting, plus a second ~1-hour rulings sitting before 2026-10-01 · Claude tails)*

**Why here:** 2026-09-12 is the first day the report-bridge ruling stops applying
(`deferred.the-owners-vault-is-empty.sprint_1_calendar_lapsed.revisit`). Everything in this sprint
is a Steve action that unblocks something larger, sized so the whole sprint fits in one evening.

| # | Item | Steve's time | Deadline (basis) |
|---|---|---|---|
| 1.1 | **A0** — the six-screen vault walk (`docs/vault-checklist-sprint-1.md`). Real items, real people. Do `/rules` before anyone claims an invitation. Never Initiate. | ~20 min | 2026-09-12 (A0 revisit) |
| 1.2 | **The mailbox sitting** — ✅ **DONE 2026-08-30.** ~~C1.2 untrash the three reports~~ **STRUCK: nothing was ever in Trash.** B10: the filter was read and has **no delete action**; seven `relay-alarm` mails restored from Trash (Claude can drive via Claude-in-Chrome in your session; the connector cannot write) | ~5 min if it is a filter | **~2026-09-14** (C1.2 purge). ⚠️ Two days after 09-12; a ≤5-minute item with a hard expiry is raised now under the blocker protocol, not held for the ruling |
| 1.3 | **C1.0** — was `rua=` removed on purpose? Decide the target; Claude executes the DNS change under `/safe-execute` on your request | ~5 min decision | before C2.1 is sent |
| 1.4 | **The rulings pack** — the §6 Sitting D list, verbatim, in two halves: **D-1** the dated and unblocking rulings (A1.3 first — it heads Sprint 2's critical path — then E4.1, B30, A0.dm/E4.4, D14, D20, D25, B15.4, B11.2/B12, D3.3) and **D-2** the rest in a second sitting before 2026-10-01. Basis for the estimate: the superseded checklist measured ~5 min per ruling | ~25 min (D-1) + ~60 min (D-2) | D-1 on 09-12; D-2 before 2026-10-01 |
| 1.5 | **E1.5** Stripe dashboard reads #3 and #4 (read, don't change) | ~5 min | — |
| 1.6 | One-line confirmations: B33 recovery codes regenerated? · D28 `.relay-dev-key.json` in 1Password? · B40 who pays for Resend Pro? · A10 LinkedIn posted? | ~2 min | — |
| 1.t | **Claude tails**: A0.t (release config via minted session **with permission**; `verify:dogfood` READY; `verify:orphans`; re-derive §0.1) · B10.t re-prove alarm delivery · record every ruling the same session and execute them in blocking order over the following week (each is S) | — | within the sprint |

**Done when:** `npm run verify:dogfood` reads READY; the three DMARC reports are out of Trash; a
red run's mail has been seen in INBOX; every D-1 ruling is recorded in `PROJECT.yaml` (a "park with
a revisit" is a legitimate answer; silence is not); Web Analytics is enabled if A7.0 found it off; a
fourth cohort deferral, if any, has a revisit date.

### Sprint 2 — Fire the demand lane *(calendar: 2026-09-12 → 2026-10-01 · Steve's court, hours · Claude preps everything that is not authorship or a send)*

**Why now, and why dated:** this is the only lane that moves a gate and it has not moved in six
sprints. The arithmetic is G1's own (`gates.g1-arms-length-demand` comment, 2026-08-16): a piece
sent on day **D** is accepted **D + 2..4 weeks** and published **D + 4..10 weeks**. That derivation
assumed a late-August send; 2026-12-31 was chosen as "the first date that does not require everything
to go right". Re-run against today: a **09-12 send publishes 10-10..11-21**; a **10-01 send publishes
10-29..12-10**, leaving three weeks of reader time on the slow path — exactly the everything-goes-right
condition the gate date was built to avoid. So the **target is the first sitting after 09-12** (A1.1
is hours, not days) and the **ceiling is ~2026-09-20**; a send after that means the G1 date needs a
`moved:` block with a reason, not silence. Both are Steve's to confirm, the way G1's date was.

| # | Item | Blocks on | Court |
|---|---|---|---|
| 2.1 | **A1** op-ed → caregiver.com: A1.3 §1a ruling (Sitting D-1) → A1.1 voice pass → A1.2 cover email → A1.4/A1.5 (Claude) → A1.6 route re-check (Claude, day-of) → **A1.7 send** — target the first sitting after 09-12, ceiling ~09-20 | — | steve (Claude preps) |
| 2.2 | **A2** The Caregiver Space: adapt + image → route re-check → **submit** | 2.1's text | steve |
| 2.3 | **A3** cohort: A3.2 dry run + handoff fix (Claude, now) → A3.1 roster → A3.3 `--commit` on GO → **A3.4 sends → A3.5 calls** → A3.6 report | Sprint 1.1 | steve / co-pilot |
| 2.4 | **A6** G3: A6.1/A6.2/A6.4/A6.5 (Claude, now) → **A6.3 sends** (Homethrive → Wellthy; NAC in parallel) → log every response | — | steve |
| 2.5 | **C2** Outlook: Claude strips the false rua sentences → **C2.1 Resend ticket → C2.2 Microsoft form** → C2.3 re-test | — (the strip step removes the dependency on C1.0; keep C1.0 first only if the sentence is to be made true rather than removed) | steve |
| 2.6 | A10 LinkedIn (if unposted). *A9 AARP belongs to Sprint 5 — a byline cannot exist inside this window* | — | steve |

**Done when:** the op-ed is sent and the date recorded in the flight log; the Caregiver Space
submission is in; the cohort is committed (or a fourth deferral is recorded **with a revisit
date**); three G3 first contacts are sent and `docs/g3-outreach-log.md` exists; the Resend ticket and
the Microsoft form are filed.

### Sprint 3 — Billing truth before the paywall *(calendar: → 2026-10-07 — E4.2 at the first revisit from 10-01, B30 before 10-03, E1.8 by 10-07 · co-pilot)*

| # | Item | Blocks on | Court |
|---|---|---|---|
| 3.1 | **E1.2** route 3 against a local production build → `wired + route-proven`, recorded as exactly that | E1.1 (Sprint 0) | co-pilot |
| 3.2 | **E1.3** route 2 (disposable owner, test clock, redelivery, `deleteAccount`) → `live-proven` | 3.1; `DEV_MAIL_ALLOWLIST` | co-pilot |
| 3.3 | **E4.1** the 1-of-4 ruling (Sitting D-1) → **E4.2** the flip-or-extend decision at the first revisit (from 2026-10-01) → **E4.3** the one-commit change-set (or a new dated revisit) → **E4.4** the revisit dead-man | 3.1 minimum — and the register's bar is 3.2 (live-proven); deciding at route-proven is Steve's recorded relaxation, not this plan's assumption | steve → claude |
| 3.4 | **B30** merge the parser fix (or record the disposition) **before 2026-10-03** | Sprint 1.4 | claude |
| 3.5 | **E1.8** `stripe login` re-pair before **2026-10-07**; **E1.7** restricted read-only key so `verify:stripe` can be scheduled; **E5** the money-path decision (E7 is ruled once, in Sitting D; its revisit lands in Sprint 8 if parked) | — | steve |

**Done when:** E1′ carries its honest label in the register (`route-proven` at minimum; the register's
own bar for the flip is `live-proven`); the paywall is ruled with the 1-of-4 ruling beside it, and any
flip at less than `live-proven` names the relaxation Steve ratified; nothing goes red on 2026-10-03;
the Stripe CLI is re-paired.

### Sprint 4 — Recovery proven *(calendar: → 2026-11-08 · co-pilot · one admin session · dated by `gates.d3-restore-drill.due`, a ceiling)*

| # | Item | Blocks on | Court |
|---|---|---|---|
| 4.1 | **D3.0–D3.4** the restore drill end to end **including a decrypt**; `met:` recorded on the gate with the observed RTO | **A0** (criterion 3 needs a real item in the backup); spend approval | co-pilot |
| 4.2 | Same admin session: **B17** DR copy absence alarm (forced to ALARM once) + re-read `relay-backup-absent` · **B36** AWS budget → SNS · **B18.1** rotate the `autospecai` key · ~~**B16.5** delete `relay-backend-dsql` if present~~ (**closed by measurement 2026-08-29 — the role is ABSENT**; nothing to delete) · **B29** decide the backup-status schedule | rulings from Sprint 1.4 | co-pilot |
| 4.3 | **B12** the off-GitHub heartbeat, if ruled — built on the SNS path this session proves again | B11.1 evidence + ruling | co-pilot |
| 4.4 | **B18.2/B18.3** runtime key and app-secret rotations in their own windows, if a cadence was ratified; **B19** `enable-key-rotation` + the pin flip, if ruled on | B18.0 / B19 | co-pilot |
| 4.5 | **D5** competitor prices re-verified + Proton added, by **2026-10-17** | — | claude |

**Done when:** `gates.d3-restore-drill` carries a `met:` block; both production clusters are ACTIVE
with deletion protection; the scratch cluster is gone; B17 has been seen to ALARM **or** its decline
is recorded with a revisit; **if** B18.0 ratified a cadence, the `autospecai` key is rotated and no
key is older than that cadence — if it ruled "none until first customer", that ruling sits on B18
with a revisit.

### Sprint 5 — The placement *(event: an outlet publishes)*

**A7** in full: the `GATE_LANES` commit **in the same commit that records the placement** (one
commit per outlet; the slug is `ed-caregiver-com`, not the dotted form a sprint report names); the
flight-log window row; day-of `verify:funnel` + `flight:snapshot`; daily snapshots until the read
(cumulative across placements: pass ≥6% @ N≥50 · kill <2% @ N≥150 · a placement driving <10
qualified visits is a *distribution* failure, not a demand reading). Thresholds are ratified and
cannot move after a result. **A9** the AARP second-round pitch opens here, after the byline exists.

### Sprint 6 — The first stranger *(event: an arms-length person appears — editorial, cohort, or partner intro)*

The custodial obligation starts for real. **B5** (KMS EncryptionContext: lift the gate → phase B →
S4-4 live proof → phase C) — the compatibility risk is *empty today* (zero vault items) and grows
from A0 onward, which argues for lifting the gate early in this sprint rather than late. **B23**
standby cap + cross-owner confidentiality. **F-q** durable counters on the two public endpoints.
**B21.2** read `csp_reports` on real traffic, then B21.3/B21.4 are ruled. **B34** read Resend
suppressions before the first notification. **F-a**'s first measurement. Expect the first genuinely unknown
failure mode here; Sprints 0–4 exist so that it is a usability failure and not a custodial one.

### Sprint 7 — Distribution *(event: a G3 meeting advances toward a pilot)*

**G1** white-label tenancy — **only once `gates.g3` is met (a signature), never at a meeting** —
scoped against the signed pilot's actual requirements (B5 first). The meeting opens the rest of this
sprint, not G1. **F-i** KYC vendor if diligence demands it. **C4** SMS / A2P 10DLC resumes
(2–4 week lead; Sole Proprietor route). **A6.5** the diligence pack meets its first reader. **G7**
counsel funded from the opportunity (g2 revisit trigger *a*). **G9** §19 SOC 2 / DPA posture
answered as the partner asks it.

### Sprint 8 — Revenue-proven and the GA bar *(event: arms-length money moves / G1 passes)*

Ladder → `customer-used` → `revenue-proven` with evidence (`lib/ops/ladder-claim.ts` enforces).
**G8** G4 and G5 enter `PROJECT.yaml`. **G2** audit + pen test + session-hardening review. **G6**
entity + insurance. **E7**'s revisit lands here if it was parked in Sitting D. **D4** the test environment re-argued with a
customer's data as the thing the walks must never touch. **B3** Option B re-argued (separate
quarter from B5). **G3** as scale demands.

---

## 4. Dated obligations calendar — a rendering; `PROJECT.yaml` and the named files win

Derived on 2026-08-27, **re-derived 2026-08-29 (revision 5)**. Each row names its basis so it can
be re-derived rather than trusted.

> 🔴 **FOUR ROWS OF THIS TABLE WERE WRONG, and they are corrected in place below rather than
> silently.** A calendar is the one artefact in this file whose whole value is that it can be
> trusted at a glance, so its errors are worth naming: the two DMARC/Trash rows described a state
> that does not exist; the 09-08 dead-man row was superseded by an actual run; and the 09-01
> Actions-minutes row named a cause that has since been disproven. Struck rows are kept, because a
> reader who remembers the old date needs to see it retired rather than absent.

| date | what | owner | basis |
|---|---|---|---|
| ~~**2026-09-01 16:32Z**~~ | ~~the reminder ladder fires for the live owner~~ — 🔴 **CORRECTED SAME DAY: IT WILL NOT.** `CANDIDATE_SQL` requires an armed `release_state` and the owner has none; live candidate count is **0**. The rung arithmetic was right and the gate was never checked. It becomes reachable the moment A0 lands — and the owner is already past the 75% rung, so the first-ever reminder fires on the next hourly cron after A0 | claude (walk); steve (A0) | `lib/release/checkin-reminder.ts` CANDIDATE_SQL, run read-only 08-29 |
| 2026-09-01 | ~~GitHub Actions minutes reset~~ — **the cause it was watched for is DISPROVEN** (§0.0 row 2). G1/G3 `/daily-priority` revisits still begin | — | `gates.g3.revisit`; B30 retired the `g1-caregiver-wtp` revisit (closed 08-29) |
| 2026-09-02 | B11.1 re-measure the cadence — now a NARROW question (does the frequency-selective pattern persist?), because the minutes hypothesis is dead. **B12 is the fix either way** | claude | `deferred.the-scheduled-monitors-are-collapsing.re_measured_2026_08_29...` |
| ~~2026-09-06 04:32Z~~ | ~~the 90% rung~~ — same correction: not a candidate until A0 | — | as above |
| ~~**~2026-09-08**~~ | ~~`verify:live` freshness dead-man~~ — **SUPERSEDED: the chain was run 2026-08-29**, so it now fires **2026-09-12 07:45Z** | claude | `tail -1 docs/verify-live-runs.jsonl` + 14 d |
| 2026-09-09 04:32Z | the live owner goes **overdue**. The sweep selects them and **transitions nothing** — they hold 0 `release_state` rows. Recorded because the opposite was briefly believed | — | `heartbeat.ts` inner query; `relay_ro` read 08-29 |
| **2026-09-12 07:45Z** | `verify:live` freshness dead-man fires (14 d from the 08-29 stamp) | claude | `lib/ops/verify-live-freshness.ts` |
| **2026-09-12** | report-bridge precedence lifts → **Sprint 1** (A0, mailbox, rulings) and **Sprint 2** open. ⚠️ Nothing turns red on this date (A0.dm) | steve | `deferred.the-owners-vault-is-empty.sprint_1_calendar_lapsed.revisit` |
| ~~**~2026-09-14..16**~~ | ~~three DMARC reports purge from Trash~~ — 🔴 **FALSE. Nothing is in Trash**; all 10 reports are retained and labelled. There is no rescue left and no clock. The real finding: `_dmarc` carries no `rua=`, so **the feed is dead** and the newest report is 2026-08-17 | steve (the DNS record) | `in:trash` returns nothing; DoH read 08-29 |
| ~~~2026-09-24~~ | ~~the 08-25 KMS-wall red-proof mail purges from Trash~~ — 🔴 **FALSE.** That thread carries no TRASH label; B10's premise was wrong and delivery is proven working (§0.0 row 1) | — | Gmail read 08-29 |
| **2026-09-19 07:53Z** | `verify:journeys` freshness dead-man fires (21 d from the 08-29 stamp) | claude | `lib/ops/verify-journeys-freshness.ts` |
| 2026-09-30 | `gates.g2-counsel-opinion.due` — **declined**; the date survives as a record | — | register |
| **2026-10-01** | `ratified.beta-free-release` revisit → E4.2 decision; **E4.1 must precede it**; Sprint 2's send-by (derived, Steve to confirm) | steve | register; §3 Sprint 2 |
| ~~**2026-10-02 → 10-03**~~ | ~~CI goes red unless B30 lands~~ — ✅ **CLOSED 2026-08-29 (PR #25).** The parser treats `superseded_by:` as a stopped clock, pinned by a test asserting against 2026-10-03 specifically | — | `lib/ops/gates.test.ts` |
| **2026-10-07** | Stripe CLI session keys expire — `stripe login` | steve | `~/.config/stripe/config.toml` |
| ~2026-10-08 | Devpost prize chase if nothing has arrived (claim 08-09 + 60 d) | steve | memory `project_h0_hackathon_orbis_relay` |
| **2026-10-17** | Competitor-price re-verification clock (+ Proton) | claude | `market.competitors_doc` (60 d from 2026-08-18) |
| 2026-10-21 | `ratified.relay-resumed-2026-08-21.review_on` — what it reviews is unstated (D23) | steve | register |
| ~2026-10-28 | GitHub's 60-day public-repo schedule auto-disable window — **re-derived 08-29** (`pushed_at` 2026-08-29T21:08Z + 60 d; any push resets it) | — | `gh api repos/sgharlow/relay --jq .pushed_at` |
| **2026-11-08** | `gates.d3-restore-drill.due` — a ceiling; `gates.test.ts` red on 11-09 with nothing recorded | steve | register |
| **2026-11-30** | `gates.g3-b2b2c-pilot-loi.due` — kill measured on **meetings** | steve | register |
| **2026-12-31** | `gates.g1-arms-length-demand.due` — ONE arms-length person | steve | register |
| 2027-08-08 | `relaystandby.com` registration expires (Cloudflare) — confirm auto-renew (B35) | steve | RDAP |
| 2027-08-09 | The only live subscription renews (E1.4's "real" route) | — | `stripe subscriptions list --live` |

---

## 5. Standing cadence (not sprint work)

- `verify:orphans` after every walk day or interrupted fixture run.
- `verify:live` **before** the freshness dead-man fires — every 14 days from the newest stamp
  (`tail -1 docs/verify-live-runs.jsonl`) — or a recorded pause with `STALE_AFTER_DAYS` raised in the
  same commit. `verify:journeys` an hour apart (D14).
- `npm run gate` on every change; `npm run test:coverage` before pushing anything that could move
  coverage; `TZ=UTC npx vitest run` before pushing anything that reads a clock.
- Outlet and partner routes re-checked **on the day** of any send (they moved twice in three days).
- Owner-mode a11y audit with a disposable owner before any release that touches owner-mode UI (B28).
- `scripts/check-subscription.ts` after any real checkout (D19).
- Monthly (Claude): scheduled-monitor run counts per workflow; `gh api …/security_and_analysis`;
  branch-protection read-back; `vercel env ls production` names-only drift check; Node runtime vs
  `engines` drift (B32).
- Quarterly: restore drill **including a decrypt** (D3 cadence from the last run date); competitor
  prices; the secret-rotation clock **once B18.0 gives it a rule**; `backup-status.mjs` (B29).
- Yearly: RDAP read of the domain expiry (B35).

---

## 6. THE MANUAL CHECKLIST — every remaining step that cannot be automated, in one place

> **This section supersedes `docs/go-live-checklist-steve.md`, `docs/steve-actions-2026-08-21.md`,
> `__project-docs/relay-manual-actions-checklist-2026-08-21.md` and the standalone vault checklist.**
> The first three now carry a `SUPERSEDED BY ROADMAP.md §6 (2026-08-27)` banner; the standalone vault
> checklist points at its in-repo copy `docs/vault-checklist-sprint-1.md`, which Sitting A walks.
> **`PROJECT.yaml → deferred` and `→ gates` remain the register and stay authoritative**; this is
> the reading view. If this section and the register disagree, the register is right and this
> section has a defect.
>
> *Not relay's, but on a page this section retires:* the manual-actions checklist's item 11 — the
> future-bot public handle / GitHub repo decision, cancel-by 2026-08-30 — is **not** carried here; it
> lives in memory `project-future-bot-2026-08-20`. A dated decision is never dropped by supersession.
>
> **Test for inclusion:** an item is here only if Claude genuinely cannot do it — it needs Steve's
> hands, his credentials or dashboard, his money, a human decision, a human-send by design, real
> content only he has, or approval of a destructive/outward-facing step. Everything Claude *can* do
> is in Sprint 0 and is not repeated here. Where an item has a Claude half, the row says what is
> already prepared. ⏱️ is an honest estimate assuming nothing goes wrong.

### Sitting A — 2026-09-12 · the vault · ⏱️ ~20 min · **unblocks the most**

- [ ] **A0** Walk `docs/vault-checklist-sprint-1.md` at relaystandby.com: two real items (one login
      with secret + 2FA seed + recovery codes; one document/instruction), **Needs a code?** answered,
      one recipient **and** one verifier in `/circle`, one rule in `/rules`, a saved trigger in
      `/triggers`. **Do not press Initiate. Do not run `reset-demo.ts`.** People you name here must
      **not** also go in `.relay-cohort.json` (A3.2). *Claude after:* `verify:dogfood` READY,
      `verify:orphans`, re-derive §0.1. — `deferred → the-owners-vault-is-empty` · revisit 2026-09-12
- [ ] **A0.t permission** One line: may Claude mint your owner session (`scripts/mint-owner-session.ts`,
      read-only on the DB, bypasses TOTP) to set the release configuration and run `invite:cohort
      --commit`, or do you prefer to do those two clicks yourself? *Default if unanswered: Claude
      does not mint it.*

### Sitting B — before ~2026-09-14 · the mailbox · ⏱️ ~5 min · **hard expiry** · co-pilot possible

> ⚠️ The purge lands two days after 09-12 (a Saturday), on evidence that cannot be recovered. A
> ≤5-minute item with a hard expiry is raised **now** under the Steve's-Court Blocker Protocol rather
> than held behind the precedence ruling — it is the first item in this revision's hand-off. With a
> Claude-in-Chrome session connected, Claude can drive Gmail's settings pages in your signed-in
> browser while you watch; the connector itself cannot write.

- [ ] **C1.1** Gmail filter: from `dmarcreport@microsoft.com` OR `noreply-dmarc-support@google.com`
      → label, **never Trash**. (Never done; the untrash alone recurred in two days.)
- [ ] **C1.2** Untrash the three reports now in Trash — Google/relaystandby 08-15, Microsoft/
      report-bridge 08-16, Microsoft/relaystandby 08-17 (the A/B-test evidence). *Claude:* C1.3 reads
      the 08-17 report (read works on Trash — it may not even need the untrash). — purge
      **~2026-09-14..16**
- [ ] **B10** Remove the Gmail rule that **B10.d** (Sprint 0) names as sending `[sgharlow/relay] Run
      failed` mail (from `relay@noreply.github.com`) to Trash — ≈20 threads since 2026-08-08, both
      red-proofs included. *Claude after:* dispatches a bogus-key KMS-wall run and confirms the mail
      lands in INBOX (B10.t). — the 08-25 evidence mail purges ~2026-09-24

### Sitting C — decision · DNS · ⏱️ ~5 min

- [ ] **C1.0** Was `rua=` removed from `_dmarc.relaystandby.com` on purpose? If yes, say so and it
      gets recorded; if no, choose the target — a DMARC processor (Postmark digest / dmarcian /
      URIports, per the runbook's own §1) rather than the forwarding mailbox — and Claude executes the
      change under `/safe-execute` (snapshot of the three live TXT values, rollback line, DoH proof)
      **on your request** — the on-disk Cloudflare token is zone-scoped and reads the record today.
      Until this is done, C1.1 protects reports that cannot arrive (C1.2 stands on its own) and C2's
      draft contains a false sentence. — 📝 register entry created by rev 4

### Sitting D — the rulings pack · two sittings · basis: the superseded checklist measured ~5 min per ruling

> ✅ **DRAFTED AND READY, 2026-08-29 — `docs/rulings-pack-sitting-d.md`.** The list below is the
> inventory; that file is the thing to run. Every question in it carries the measurement that makes
> it answerable, a recommended default, and what happens if it is parked — which is the whole point
> of row 0.8, that this sitting costs minutes rather than re-derivation.
>
> ⚠️ **Four items on the list below have MOVED since revision 4 wrote it**, and the pack opens by
> saying so rather than letting the sitting spend its first ten minutes on them: **B30 is CLOSED**
> (PR #25, 2026-08-29 — comes off D-1); **B10's premise was false** and its question changed
> entirely, because delivery is proven working and nothing is being trashed; **D21's precondition is
> met**; **B27 and B31 were executed** on a nod the same day.
>
> The pack also carries the **C1.0 DNS change prepared under `/safe-execute`** — snapshot, rollback,
> and the DoH proof before and after — ready to execute on request, and explicitly *prepared rather
> than proposed*.

Each is a *decision*; "park with a revisit date" is always a legitimate answer, silence is not.
Delivered as a batched `AskUserQuestion` series (≤4–5 per call, recommended default first). Claude
records every ruling the same session and executes them in blocking order over the following week
(each is S).

**D-1 — 2026-09-12 · ⏱️ ~25 min · dated or unblocking**

- [ ] **A1.3** Does §1a (third person) bind the editorial piece? (register says yes; the 08-17 sprint
      report relaxed it unratified) — **first: it heads Sprint 2's critical path**
- [ ] **E4.1** Are releases billing-gated on **all four** ARMED→PENDING paths or only Initiate?
      **Must precede the first paywall revisit (from 2026-10-01)**
- [ ] **B30** The 2026-10-03 latent red: parser fix (default) or a disposition on the ratified gate
- [ ] **A0.dm / E4.4** Revisit dead-man: promote A0 to a `gates:` entry, **or** a guard reads
      `revisit:` (default; also covers 2026-10-01)
- [ ] **D14** Signup ceiling: **A leave-and-say-so** (default) · B exempt reserved domains · C = D4
- [ ] **D20** 28 dangling rows: purge (Claude drafts + runs on GO) **or** NOTICE by ruling (default:
      purge)
- [ ] **D25** FR9 `/api/demo/simulate`: retire (default) or re-seed a demo account
- [ ] **B15.4** Ratify rungs 75% / 90% and the 12 h cooling-off; rule on owner self-naming (default:
      refuse the row)
- [ ] **B11.2 / B12** After the 2026-09-02 re-measure: if the monitors' cadence recovered with the
      minutes reset — a payment method / plan on the GitHub account (money), or accept the monthly
      collapse; if it did not — rule the off-GitHub heartbeat (Route 53 / CloudWatch Synthetics → SNS
      NotifyMe, 5-gate; default: build in Sitting H) or the B12.i interim only, with a revisit
- [ ] **D3.3 fallback** If A0 has not happened by the drill: does a disposable item created *before*
      the backup satisfy criterion 3? (default: wait for A0)

**D-2 — before 2026-10-01 · ⏱️ ~60 min · the rest**

- [ ] **B17** Add the DR copy-job absence alarm (~$0.10/mo; default yes, executed in Sitting H)
- [ ] **B36** AWS Budget ≈ 2× the fixed monthly cost → SNS NotifyMe (5-gate; default yes, Sitting H)
- [ ] **B29** An AWS Backup read-only OIDC role so `backup-status.mjs` can be scheduled (default yes,
      Sitting H)
- [ ] **B20** Bring `infra/iam-policy.json` to the live v2 shape; does runtime keep `kms:DescribeKey`?
- [ ] **B19** CMK auto-rotation: enable (~$24/yr; executed in Sitting H) or record "stay off,
      deliberately"
- [ ] **B18.0** Secret-rotation cadence, or "none until first customer" with a revisit; and the
      `autospecai` key (424 days) — rotate now? (default yes, Sitting H)
- [ ] **B22** `executor` role: refuse at the API (default) or amend Req 3.1
- [ ] **B26** Q6 owner-branch `/api/kms/unwrap` under step-up? Q16 seed phrases in scope?
- [ ] **B25** Bulk session revocation: build, defer with trigger, or accept "rotate `NEXTAUTH_SECRET`"
- [ ] **B38** Do Cloudflare (mail forwarding) and Google (Gmail) belong on `/privacy`? (default yes)
- [ ] **D21** Place `.env.ro` in the Claude Code cloud env — do it, or keep tracking.
      ✅ **Its precondition is met (2026-08-29):** B16.1 read clean, and the load-bearing claim
      is now MEASURED rather than asserted — `relay-ro-policy v1` grants `dsql:DbConnect` on the
      two cluster ARNs and carries no `kms:` action at all, which is the entire reason this
      credential may sit somewhere less trusted than the laptop. Placement is Steve's
- [ ] **E7** Sales tax / Stripe Tax: register, threshold, or "accepted until first revenue" + revisit
      (ruled once; the revisit lands in Sprint 8)
- [ ] **B21.3** `csp_reports` retention: prune by `ts` after N days (default 30) or keep with a cap
- [ ] **G4** Mobile: assign a trigger or strike it from §2-G
- [ ] **B41 / B42** Who watches `hello@` when you are unreachable; Reply-To `hello@` vs `relay@`
- [ ] **F-l** The abandon-after-seed nurture branch: give it a §2-F unlock or strike it
- [ ] **D23 / D26 / G9 / G10 / G11** State what the 2026-10-21 review reviews; migration ledger
      "accepted-not-planned"; dispositions on the un-ruled spec planks (§18, §19 incl. DPA/SOC 2,
      §20–22, §23/24 + `business`/`travel` selectable), Req 13.6, the two design decisions

### Sitting E — dashboards and one-liners · ⏱️ ~10 min · co-pilot where noted

- [ ] **E1.5 #3** Stripe → Settings → Emails: "Successful payments" customer receipts ON? (read only —
      shared account; no API exposes it; Claude-in-Chrome can read the page in your session)
- [ ] **E1.5 #4** Stripe → Webhooks: endpoint-failure notifications ON, to which address? (read only)
- [ ] 🔴 **A7.0 — MEASURED 2026-08-29, AND IT IS WORSE THAN "OFF". ENABLE WEB ANALYTICS.**
      Vercel dashboard → the `relay` project → **Analytics** → enable. ~1 min.
      **This is no longer conditional and it is a hard precondition of Sprint 5.** The API refuses
      the project (`web_analytics_not_enabled`) while the edge serves the collector script (200)
      and answers **200 OK** to every beacon — `POST /_vercel/insights/view` and
      `POST /_vercel/insights/event` both. So the site looks instrumented, the browser's network
      tab shows success, and nothing is readable. On placement day that presents as an empty
      dashboard beside a site that appears to be reporting correctly, and the number cannot be
      re-collected afterwards.
      Claude re-runs the API probe straight after to confirm it became a count. Evidence and the
      four commands: `docs/g1-flight-log.md` → "A7.0 — WEB ANALYTICS IS NOT COLLECTING ANYTHING
      READABLE"; register `deferred.web-analytics-collects-but-cannot-be-read`.
- [ ] 🔑 **E1.7 — mint a RESTRICTED read-only Stripe key.** Stripe dashboard → Developers → API
      keys → **Create restricted key**. ~3 min.
      Scopes: **Webhook Endpoints: read** and **Billing Portal: read**. Nothing else, and
      🔴 **never the secret key** — this account is shared with report-bridge, skillcrossroads and
      second-brain, so a key with more power than it needs carries their blast radius too. If it
      cannot be minted that narrowly, say so and leave it unset: the CLI fallback is the better
      answer, not the worse one.
      Then set `STRIPE_READONLY_KEY` wherever the check runs and Claude confirms with
      `npm run verify:stripe` (it prints which read path it used).
      **Why it is dated:** the check is live-proven but unschedulable without this, and its only
      other read path is your Stripe CLI browser pairing, which **expires 2026-10-07** (E1.8).
      After that date, with no restricted key, `verify:stripe` has no read path at all.
      Procedure and the never-substitute rule: `docs/secret-rotation-runbook.md` §8.
- [ ] 🌐 **B10.d — connect the Claude browser extension**, so the `relay-alarm` Gmail filter can be
      read. ~2 min, and it unblocks a read rather than a change.
      Delivery is already PROVEN WORKING — three deliberate red runs on 2026-08-29 reached the
      INBOX in 23–37 s, labelled `relay-alarm` and starred — so B10's "every alarm goes to Trash"
      premise is false and nothing needs deleting. What is unknown is **why** it works: the filter
      itself has never been read, and something changed between 2026-08-25 (archived, unstarred)
      and 2026-08-29 (inbox, starred) that nothing records. That is the distance between "delivery
      works" and "delivery works for a reason that will keep holding".
- [ ] **B33** Regenerate the recovery codes for the live paying owner account from `/account`
      (step-up/TOTP) — **verified NOT done** on 2026-08-27 (8 codes, all created 2026-08-09T01:36Z,
      none since, none used)
- [ ] **B35** Cloudflare registrar: `relaystandby.com` auto-renew ON and the card current (expires
      2027-08-08). The on-disk token has no Registrar scope (403) — dashboard or a re-scoped token
- [ ] **B18.5** Nod: Claude removes the inert, retired `TOTP_SECRET` from Vercel Production
      (`vercel env rm`; nothing reads it)
- [ ] One-liners: **D28** `.relay-dev-key.json` is in 1Password? · **B40** which product carries the
      Resend Transactional Pro line in its unit economics? (the plan, amount and renewal day are read
      from the receipts by Claude) · **A10** was the LinkedIn H0 post published?

### Sitting F — the demand lane · 2026-09-12 → 2026-10-01 · ⏱️ hours · **the only sitting that moves a gate**

- [ ] **A1.1** Voice pass on `docs/oped-angle-3-draft.md` (yours, under your byline)
- [ ] **A1.2** Cover email disclosing the commercial interest ("I build a product in this space; the
      piece recommends a free feature of the reader's existing provider, and my product appears
      nowhere in it")
- [ ] **A1.7** Send the `.docx` (Claude derives it from your final text, outside the repo, with the
      contact block) to the caregiver.com address in the dossier from your own mailbox — after
      Claude's day-of route re-check
- [ ] **A1.8** On acceptance: sign their release; Claude confirms the byline link is tagged
- [ ] **A2.1 / A2.3** Adapt the piece for The Caregiver Space (their standard; end-of-post bio;
      a rights-cleared image — Claude preps bio, tagged link and a candidate image) and submit it
      through their site contact form (Claude may prefill; you press submit)
- [ ] **A3.1** The cohort roster: names, emails, recipient-or-verifier, delivery arm — both types,
      both arms, ~10–20 people (today: one recipient, no verifier)
- [ ] **A3.3 GO** Approve `invite:cohort --commit` (Claude runs the dry run first; writes real
      invitations)
- [ ] **A3.4** Deliver the owner-arm invitations out of band (read aloud / text / in person) —
      manual **by design**
- [ ] **A3.5** The four-word verification call per claimant (People → the person → Verified?), plus
      the safe-sender and passkey asks — manual **by design**
- [ ] **A6.3** Send the three G3 first contacts under your own identity — Homethrive, then Wellthy,
      NAC in parallel (Claude drafts; re-checks routes; verifies the Homethrive newsroom claim first;
      keeps `docs/g3-outreach-log.md`). Nothing via the day job.
- [ ] **C2.1** Open the Resend support ticket (drafted; Claude first strips the two now-false
      DMARC sentences)
- [ ] **C2.2** Submit the Microsoft sender-support form under your Microsoft account (Claude may
      prefill). Never click "It's not junk" on the evidence.
- [ ] **A9** AARP second-round pitch — **Sprint 5, not before**: only after a byline exists; plain
      text; no attachments
- [ ] Send-by for A1/A2: **target the first sitting after 09-12; ceiling ~2026-09-20** (§3 Sprint 2's
      arithmetic from G1's own lead times — confirm it, or move G1's date with a `moved:` block)

### Sitting G — E1′ and the paywall · co-pilot · → 2026-10-07 · ⏱️ ~45 min + your approvals (basis: the superseded checklist's ~30 min for E1′, plus the paywall decision)

- [ ] **E1.2 approval** Route 3 writes one fabricated-invoice audit row to your owner's hash-chained
      log; and, if you want it POSTed at `relaystandby.com` rather than a local production build,
      **DETAIL** the live `STRIPE_WEBHOOK_SECRET` into a gitignored env file (never chat)
- [ ] **E1.3 approval** Route 2: a test-mode subscription on a disposable owner, failed via a test
      clock, closed with `deleteAccount()`; add a controlled mailbox to `DEV_MAIL_ALLOWLIST` for the
      inbox half
- [ ] **E4.2** At the first revisit (from 2026-10-01): flip `canRelease`, or extend the beta **with a
      new dated revisit**. The register's bar is E1′ `live-proven` (E1.3); deciding at `route-proven`
      (E1.2) is a relaxation *you* would be ratifying, not one this plan assumes
- [ ] **E1.8** `stripe login` re-pair before **2026-10-07** (co-pilot: Claude runs the CLI, you approve
      the pairing page in your browser); **E1.7** mint a restricted
      read-only Stripe key (`webhook_endpoints:read`, `billing_portal_configurations:read`,
      `subscriptions:read`) so the contract check can be scheduled
- [ ] **E5** Rule whether any billing check joins an automated chain (each proof = a real charge on
      the shared account)

### Sitting H — the admin session · co-pilot · → 2026-11-08 · ⏱️ ~2–3 h + scratch-cluster hours (basis: the superseded checklist's ~2 h for the drill alone; five bundled items added)

- [ ] **D3.0** Authorise the scratch-cluster spend and hold the `autospecai` admin session while
      Claude drives the drill (backup → restore to scratch → `verify:kms` → **one real item through
      Reveal** against the scratch endpoint via a throwaway env file → observed RTO → delete scratch →
      both prod clusters ACTIVE + deletion protection). **Blocked on A0** for the real item — or the
      D-1 fallback ruling that a disposable pre-backup item satisfies criterion 3.
- [ ] Same session, on the rulings from Sitting D: **B17** DR alarm (forced to ALARM once) ·
      **B36** AWS budget → SNS · **B18.1** `autospecai` key rotation · **B16.5** delete the H0-era
      `relay-backend-dsql` role if present · **B29** an AWS Backup read-only OIDC role for
      `backup-status.mjs` · **B19** `enable-key-rotation` + the pin flip, if ruled · **B12** the
      off-GitHub heartbeat, if ruled · **B18.2/3** further
      rotations if a cadence was ratified (`RESEND_API_KEY`'s provider half is your dashboard;
      `STRIPE_*` never per project)

### Event-triggered and watch — no date; re-raised at each `/daily-priority`, never dropped

- [ ] **B5.0 / B5.3** Lift the KMS EncryptionContext gate at the first stranger (or on any
      wrap/unwrap change); approve the phase-C flag flip (the point of no return)
- [ ] **C3** DMARC step-up — only after C1.0 and a fortnight of reports; your explicit request
- [ ] **C4** SMS / A2P 10DLC — Sprint 7; Sole Proprietor; your identity, a real mobile, ~$60
- [ ] **C5** Stripe merchant name — only if a real customer remarks
- [ ] **C6** report-bridge's NXDOMAIN bounces on the shared Resend account
- [ ] **B34** Read Resend → Suppressions before the first notification reaches a stranger
- [ ] **B21.3 / B21.4** At the first real traffic window: `csp_reports` retention (if not already
      ruled in D-2) and the nonce + Node-runtime middleware change (5-gate, your request) once B21.2
      has read the table
- [ ] **G8** On G1 pass: approve the G4/G5 gate drafts · **C2.3** the Microsoft reply (vendor); no
      reply in ~2 weeks → recorded and closed
- [ ] **A8** Rule what counts when a G1 candidate appears · **A6.6** G3 verdict on 2026-11-30 ·
      **A11** Devpost prizes by ~2026-10-08 · **E1.4** the real renewal (2027-08-09) · **E6** refunds
      by hand · **D4** the test environment at the first paying customer · **B3** Option B on its
      triggers · **F-i** KYC vendor · **G2/G6/G7** audit, entity + insurance, counsel — funded from
      the opportunity · **B39** edit or unlist the public demo video / confirm the X thread

---

## 7. Explicitly not planned — with what would reopen each

- **Estate, in any form** — withdrawn permanently (`gates.g2-counsel-opinion.declined`; J10
  withdrawn; `lib/ops/gates.test.ts` enforces the ordering). Reopens only by reversing that decision
  first, in its own change. The public artifacts that still say otherwise are B39.
- **Paid advertising** in any channel; **Caregiver Action Network** sponsorship (paid). Reviving a
  paid lane = one src in `GATE_LANES`, barred absent an op-ed showing a searchable vocabulary.
- **Feature work ahead of demand evidence** — all of §2-F and §2-G behind their named unlocks.
  §2-B and §2-D are not exceptions; §1 gives the test.
- **J9 steps 5–7**, **`POST /api/ai/prioritize`**, the **Cancel control** — decided, not deferred.
- **A test cluster before D4's ruling**, a **multi-Region CMK** (B3 ruled), a **shared-state rate
  limiter** (D6 ruled), a **`next-auth` v5 / React 19 / Tailwind 4 / TypeScript 7 upgrade** (D12) —
  infrastructure changes to a working system; each needs the 5-gate policy and Steve's explicit
  request. **Vercel → AWS OIDC federation** to replace the static runtime key belongs here too.
- **Raising `/api/auth/signup`'s `LIMIT`** to make the walks fit — the wrong direction of fit.
- **Seeding the owner's vault with fixtures** — the shortcut this document's own headline invites.
- **Widening `verify:orphans`'s ignore list** without a ruling — an orphan census that learns to
  ignore orphans is decorative.
- **A bare `/api/health` route** — a 200 that proves nothing (D22).
- **A second demand instrument before the first one reads.**

---

## 8. How to keep this document honest

This file restates no number a test could catch drifting; everything checkable lives in
`PROJECT.yaml`, which the suite reads. Where revision 4 quotes a measurement it carries the date and
the command. When a sprint closes, strike its items with a date and a commit, in place. When a gate
outcome changes the plan, change it **here and in `PROJECT.yaml` in the same commit**.

**A finding recorded only in this file is one session from being lost** — every item enters
`PROJECT.yaml → deferred` with an owner and an `ends_when` that is a condition, not a date; §2-H lists
the ones this revision found without one.

**The weakness revision 3 recorded against itself is confirmed, for the third time.** This document
has now been rewritten three times to say demand is the binding constraint, and three times the
demand lane did not move while the engineering lane did — because the engineering lane needs
nobody. Revision 4's answer is structural rather than rhetorical: Sprint 0 spends the engineering
lane *down to zero* before 09-12, so that on 09-12 the only work left is the demand lane and a
one-hour sitting, and §6 exists so that "what does Steve have to do" is never again a question with
four answers in four files.

**The weakness revision 4 records against itself:** it found the alarm path broken at its last hop
(B10) and the schedules collapsing (B11) — both had been "proven" in the register on the strength of
exit codes and green runs. The generalisable lesson, added to the portfolio's list: **a monitor is
proven when its failure has been seen by a human, not when its process has been seen to exit 1.**
The next revision should open by asking which of its own "proven" claims have been *seen*.

**The weakness revision 5 records against itself — two, and the second is the uncomfortable one.**

*First:* this revision answered revision 4's question honestly and found six false claims, but its
own output is once again **instruments rather than outcomes**. Sprint 0 produced a cadence watcher,
a billing-contract wall, an incident-evidence tool, a chain dead-man, a structural guard against the
next missing dead-man, and a great deal of corrected prose. Production still has no effective
synthetic monitoring; the fix for that is B12 and B12 is not built. **A defect that is now reported
daily is a better-understood defect, not a smaller one.**

*Second, and it reorders the file:* the custodial obligation this document is largely organised
around is, today, **owed to nobody**. The one live owner holds an empty vault — 0 items, 0 people,
0 rules, 0 release_state rows. Four revisions have tracked the guarantees owed to a first stranger
while the 20-minute action that makes those guarantees non-vacuous (A0) has not been taken. The
engineering lane has been spent, twice over, verifying machinery against fixtures because there is
nothing real for it to act on. **The next revision should open by asking whether A0 happened, and
if it did not, why a 20-minute task outlived a month of week-long ones.**

**Re-derive before planning.** Every number in this file was live on 2026-08-27, and the numbers in
§0.0, §0.5, §2.5 and §4 were re-derived on 2026-08-29. The register
command (§0.2), `npm run verify:dogfood`, `npm run verify:orphans`, `tail -1
docs/verify-live-runs.jsonl`, `npm run flight:snapshot`, `ls .relay-cohort*.json`, and
`gh api repos/sgharlow/relay/actions/workflows/<wf>/runs?created=<day> --jq .total_count` are the
seven reads that decide whether anything above has moved.

**Revision 5 adds two, both of which found something the seven did not.** `npm run check:cadence`
(is the monitoring alive at all?) and a `relay_ro` read of the live owner's
`vault_items / recipients / verifiers / access_rules / release_state` counts (is there anything for
the custodial machinery to protect?). The second is the one that changed this revision's ordering.
