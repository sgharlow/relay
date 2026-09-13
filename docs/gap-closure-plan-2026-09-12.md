# Relay — Gap-Closure Plan: the deployed product vs the specified product

> **Revision 2, 2026-09-12 (QA pass).** Revision 1 was reviewed adversarially the same day by two independent readers — one for direction and recorded decisions, one for implementability and safety — and by a third check of the ladder arithmetic. Fifty findings, eight of them blockers. Every one is applied below and logged in §Q so the reader can see what revision 1 got wrong and why. **Plan-internal row ids are now prefixed `GP-`** so they never collide with ROADMAP's `D1`/`D14`/`D20` ids.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the Claude-court tasks in §5 task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every other row in this file is Steve's hands, a ruling, or a calendar event — none of those is executable by an agent.

> **Status of this file.** A *derived view*, written against `master` @ `2853ef8` and the live system as measured 2026-09-12 (§0.2). It is not a third register: `PROJECT.yaml` stays authoritative for gates, dates and the debt ledger; `ROADMAP.md` (revision 8) stays authoritative for the plan thesis. Every row cites a register key / ROADMAP id or is marked **NEW** and owes a `PROJECT.yaml → deferred` entry (task 5.1). When ROADMAP revision 9 is written it absorbs §2–§4 and this file gets a `SUPERSEDED BY` banner.

**Goal:** Close every gap between what `relaystandby.com` does today and what the specification obliges it to do — by *proving* what is built, *fixing* what drifted, *ruling* what the spec leaves undecided, and *correcting* the record — while building **no** new capability.

**Architecture:** Unchanged. Next.js 16 App Router on Vercel · Aurora DSQL active-active (us-east-1 / us-west-2) · AWS KMS envelope encryption · Vercel Cron + the off-GitHub heartbeat (`relay-heartbeat`, Windows Task Scheduler, every 15 min) · Resend · Stripe live mode. No migration, no new route, no new state, **no new monitor** is proposed anywhere in this plan.

**Tech Stack:** TypeScript, Vitest, `npx tsx` scripts under `.env.ro` / `.env.local` / `.env.admin`, GitHub Actions with OIDC (`relay-ro-ci`, `relay-kms-wall-ci`).

**Spec:** a stack; every gap names its layer.
- `specs/Relay_H0_Build_Spec_v2.md` — strategy + MoSCoW plan (read its 2026-08-21 banner first: estate withdrawn; §26 rollout → `ROADMAP.md`).
- `.kiro/specs/relay-h0-mvp/requirements.md` — the 17 numbered obligations (R1–R17).
- `.kiro/specs/relay-h0-mvp/design.md` — the 7-edge transition table, the OCC pattern, Correctness Properties 1–20.
- `docs/standby-architecture.md` (hybrid+6) — how a recipient or verifier is authenticated.
- `docs/user-journeys.md` — J1–J9 with the 2026-08-13 production re-sweep and the 2026-08-17 step register.

## Global Constraints

- *"Nothing in §2-F or §2-G may start before its named event. Starting early is the defect, not a head start."* — `ROADMAP.md` §1.
- *"Do not widen the selectable list and do not build estate."* — `CLAUDE.md`. Copy that still offers estate is a defect (B39).
- *"`PERMITTED_TRANSITIONS` stays at seven edges … ARMED remains the safe default; silence never resolves toward open."* — `docs/standby-architecture.md` §2 principle 4.
- *"Alerting is convenience and is allowed to fail."* — `docs/standby-architecture.md` §2 principle 5 (verbatim; revision 1 misquoted it).
- *"Every sprint ends with a live probe against production, not a green suite."* — `docs/standby-sprint-plan.md` §7.
- *"a monitor is proven when its failure has been seen by a human, not when its process has been seen to exit 1."* — `ROADMAP.md` §8.
- Infrastructure Change Policy: any change to a working database, DNS, secret, IAM, auth provider or production host needs the 5-criteria gate and Steve's explicit request. Rows marked **5-gate** are *rulings*, never actions, until `/safe-execute` passes. **Credential rotation is 5-gate** (`ROADMAP.md` B18: "credential-touching → 5-gate"); **no secret ever appears in chat or tool output.**
- Local dev writes production DSQL. No walk runs without `netstat -ano | grep :3000 | grep LISTEN` showing exactly one listener.
- `verify:live` performs exactly 10 signups against a 10/hour limit; restart the dev instance for a second budget.
- **Three writers reset the owner's check-in clock**, and coverage is opt-in per route (`lib/http/owner-route.ts:29-34`): an owner sign-in (`lib/auth/upsert-user.ts:77`); any owner POST/PUT/PATCH/DELETE through `requireOwner(req)` (`lib/release/liveness.ts:52`); the explicit check-in (`lib/release/heartbeat.ts:113`). Confirmed to reset: `POST /api/people/[id]/confirm`, `POST /api/fire-drill`, the cohort `--commit` (`POST /api/recipients|verifiers`), `POST /api/account/recovery-codes`. Rungs sit at 0.75 and 0.9 of the interval (`lib/release/checkin-reminder.ts:102-117`), so **every owner write pushes the first reminder to write + 22.5 days.** Rows that do this are marked ⏱.
- The git repo has no pre-push hook of its own; the gate is the Claude Code harness hook `~/.claude/hooks/pre-push-check.sh`, which runs `npm run build` then `npm test` on any push. Run `npx tsc --noEmit` after every edit.
- No `Co-Authored-By: Claude` trailer. Stage explicit paths.

---

## Q. What revision 2 changed, and why (the QA log)

Numbered for reference from the rows below. **B** = blocker in revision 1, **M** = major, **m** = minor.

| # | Sev | Revision 1 said | The record says | Applied as |
|---|---|---|---|---|
| Q1 | B | U9: the demo-simulate fate is unruled; re-seed via `reset-demo.ts` | Ruled **RETIRE** 2026-08-30 (`ratified.sitting-d1-2026-08-30.rulings.d25_demo_simulate`), executed PR #40, `docs/retired-surface.md:244`; `reset-demo.ts` is barred by name (`ROADMAP.md:545,1644`); `/demo` is fixtures-only, no DB | Row deleted; **GP-R11** records the false "unruled" |
| Q2 | B | D1: "nothing effective covers the site"; buy a Route 53 check | B12.i (`scripts/heartbeat-local.ts`) runs the **real canary against production every 15 min**, alive, alert path proven. What the canary does *not* probe is `/api/health/scheduler` and `/api/health/reminders` (`lib/ops/canary.ts:102-117` probes three behavioural paths only) — those two dead-men are watched only by the collapsing GitHub tier | **GP-D1** re-scoped: two canary assertions, Claude's court, zero cost, no 5-gate. Route 53 dropped (its real numbers: ~15 checkers × 30 s ≈ 43k `force-dynamic` DSQL-backed requests/day, ≈ $2.75/mo before DSQL/Vercel, no rate limit on the route, 4-s checker budget vs 5-s pool connect timeout) |
| Q3 | B | U15: D14, D20, B15.4 and E4.1 are "rulings owed since 08-27"; pack recommended NOTICE for D20 | All four ruled 2026-08-30 in `ratified.sitting-d1-2026-08-30`: D14 LEAVE IT; D20 **PURGE — executed, 28 → 0**; B15.4 RATIFY; E4.1 **KEEP INITIATE-ONLY, say so in `/terms`** | Moved to **GP-R12**; Sitting D-1 is not re-convened; E4.1's licensed `/terms` sentence is Claude's (**GP-U14**) |
| Q4 | B | G2.5 "90 % rung ≈ 09-26"; G3.1 first rung ≈ 10-03 | 75 % precedes 90 % (`checkin-reminder.ts:171-178` returns the highest rung reached); `check:ladder` today: first 10-03 15:36Z, final 10-08 03:36Z; 09-26 is a stale copy of `ROADMAP.md:1219`. And every G1 owner write pushes both rungs to write + 22.5 d | G2.5 deleted; **GP-U9 (NEW ruling)** picks the proof window; P1 moves to G4; ⏱ marks on every owner-write row; `ROADMAP.md:1219` and the entry's `ends_when` date join the strike list (**GP-R13**) |
| Q5 | B | U11(a): the a11y job reads the secondary *daily* — record as R14.2 evidence | `a11y.yml` has no `schedule:` (master push / PR / dispatch only); PRs carry no DB config; `relay_ro` is SELECT-only so it cannot evidence R14.2's write clause | **GP-U11**: record as R14.1 evidence on master pushes, dated; R14.2 stays with the drill |
| Q6 | B | R3: close `the-read-only-identity-is-not-in-the-cloud` (D21 shipped) | Its `ends_when` needs one of the five `.env.ro` verifications **observed running in CI**; `relay-ro-ci` runs the a11y mint, none of the five; only `a11y.yml` assumes the role | Entry stays open; **GP-R3** now records that ROADMAP §2-D's "D21 ✅ DONE" overstates; closing it is a Steve re-scope or a workflow that runs one of the five under the role |
| Q7 | B | D3: strike `executor` from the API; "API and UI agree" | The asymmetry is the recorded design (`PeopleSections.tsx:38-72`), the same pattern as `estate`; `VALID_ROLES` mirrors the DB CHECK (`001_initial.sql:65-66`) and §7 bars a migration; live rows may carry the value | **GP-D3**: read live `recipients.role` first; ruling is *document* vs *strike with a migration*; recommended document |
| Q8 | B | D13: B10 "premise disproven"; re-prove once | Newest measurement (`re_measured_2026_08_30`): alarms **are** in Trash, unread, 30-day purge; the filter has no delete action; delivery is proven and "does not need re-proving"; owner moves to Claude for the read | **GP-D13**: Claude's court; close `revised_ends_when`, open the residue |
| Q9 | B | 5.9: copy `e2e-stepup.ts`, monkey-patch, inject faults | The walk is out-of-process HTTP (`scripts/e2e-stepup.ts:29,71`); a patch in the script never reaches the server. And the register (`shipped-but-unproven-release-guards.re_measured.b15_6_…`) already records the fault injection done 08-31; what is missing is Steve confirming that property *is* B15.6 | **GP-P6**: S one-line confirmation + C restates B15.6 as a property. Task 5.9 deleted |
| Q10 | B | 5.4: `KNOWN_ACTIONS = Object.keys(LABELS)` then assert every known action is labelled; `title=` keeps the raw value; "S" sized; `verify:ui` 43/43 | The assertion is a tautology; `title` is unreachable by keyboard/touch under CC8; ≈75 distinct actions incl. a template literal and an `estate_…` action; `verify:ui` never visits `/audit`; the page already resolves the **actor** column with a visible raw sub-line (`AuditPageClient.tsx:181-190`) and `describeIncident` already labels nine actions on the same page | Task 5.4 rewritten: independent `EMITTED_ACTIONS` bound both ways (the `verify-timeline-is-labelled.test.ts` pattern); visible sub-line; scope to owner-visible actions with fall-through; **M**; proof via `a11y-audit.mjs` (which audits `/audit`) |
| Q11 | B | D8 rotation: co-pilot per the runbook | B18 is 5-gate; the runbook has **no section for the `autospecai` admin key** (§5 is the Vercel runtime pair); a co-pilot `create-access-key` would print the secret into tool output | **GP-D8**: 5-gate via `/safe-execute`; Steve creates/deactivates and edits `~/.aws/credentials`; Claude writes runbook §5b first and re-runs the three walls after |
| Q12 | M | 5.1: a new well-formed test | `lib/ops/project-yaml-parses.test.ts:159-180` already asserts owner + ends_when on open entries and **exempts `held`/`blocked_on`** — which is why `verify-live-cannot-enter-ci` (has `blocked_on`) passes today. The `revisited.outcome` rule is genuinely new | Task 5.1 adds one rule to the existing file; no third file; R4 is hygiene, not a test failure |
| Q13 | M | 5.2 step 9: "no test parses ROADMAP rows; `gates.test.ts` reads it" | `lib/ops/roadmap-court.test.ts` parses every `Court` table; `g-lane-names.test.ts` regex-matches §2-G; `gates.test.ts` never reads ROADMAP | Step 9 names the two real tests |
| Q14 | M | D9: copy `kms-wall.yml` | `@aws-sdk/client-iam` is a **devDependency** so `npm ci --omit=dev` breaks; `RELAY_RUNTIME_IAM_USER` env needed; the proposal (§5–6) also requires the "after 60 days" phrase (`alarm-of-record.test.ts`), a `principal` dispatch input, and a fifth `CONTRACTS` entry; creating an IAM role is infra | **GP-D9** carries all five; marked 5-gate (additive; rollback = delete role) |
| Q15 | M | 5.6: rewrite `sprint-state.json` | The skill's first bullet needs "iterations remaining"; `BACKLOG INFERRED` is unreachable while `docs/backlog.md` exists | `iterationsRemaining` added; done-when = the orient step names this file |
| Q16 | M | R8: J6 "4c live-proven; re-run by `verify:request`" | The note covers 4a/4b/4c; 4a+4b are proven by `verify:request` (`e2e-request.ts:241,342,445`); 4c by **`verify:escalation`**; the claim sits at five lines (486, 503, 573, 1577, 2267) | Task 5.3 step 6 corrected, all five lines |
| Q17 | M | Pack #16: enable CMK rotation, "reversible", licenses "AWS setting" | B19 = `enable-key-rotation` **+ flip `ROTATION_INTENDED` in the same commit** or `verify:kms` goes red daily (`kms-wall.ts:117-122,235-238`); ~$24/yr recurring; rotated material is not removable; execution is Sitting H | Pack row corrected; execution G4 |
| Q18 | M | Pack #17: bulk revocation = "epoch bump by admin SQL" | B25's menu is build / defer with trigger / accept "rotate `NEXTAUTH_SECRET`"; a raw bump skips `revokeChallenges` (`session-epoch.ts:84-92`) and would one day hit DSQL's per-transaction row cap | Answered from the menu; recommended *accept + document*, defer a built control to the first stranger |
| Q19 | M | R4 `ends_when` = G1 met | G1's metric admits a written willingness-to-pay; D4's ruling says *paying* customer | `ends_when` = arms-length money moved, or Steve re-rules |
| Q20 | M | R1: close the web-analytics entry | Its third clause (where the queryability assertion lives) is unanswered | Partial closure, nod-gated, clause 3 recorded in the same edit |
| Q21 | M | G2.3 closes the domain entry; §4 lists it as open until 2027 | Its `ends_when` has a conditional alarm clause | Done-when carries the clause; the §4 list no longer contradicts it |
| Q22 | M | G0.1: four Steve-owned entries edited in Claude's court | Only R2 is clerical | R2 Claude's; R1/R3/R4 nod-gated |
| Q23 | M | G1 "is" rev-8 Sprint 2 | Row 2.6 (A1 acceptance watch, ~09-30) was dropped | Added as G1.11 |
| Q24 | M | R3 cites PR #60, 09-03 | #60 = repo side, **#61** = role + migration 040 both regions, both 2026-09-02 | Cited correctly |
| Q25 | m | P1 cites hybrid+6 §4.6 | §4.6 is [A4], the thing that *moves* the ladder | Cites `checkin-reminder.ts` + `ratified…b15_4` |
| Q26 | m | P3 "alerting may fail visibly"; did-not-mail empty as the gate | Principle 5 is "allowed to fail"; the gate is every verifier *acknowledging* (pull works) | Wording and done-when fixed |
| Q27 | m | §0.3 "thirteen planks", "seventeen barred" | Counts drifted from the tables | Counts derived from the tables or dropped |
| Q28 | m | 5.2 misses `ROADMAP.md:1219`, the entry's `ends_when` date, `scripts/verify-stripe.ts:31,94,138`, and CLAUDE.md's "verify:iam has never been run against the real policy" (it ran 09-10, B28) | | All added to task 5.2 |
| Q29 | m | 5.5 edits design.md only; 5.3 step 7 runs `check:oped` (reads one unrelated file); 5.1 commit says "D4"; `grep -c` in a done-when | | tasks.md added; `journey-state.test.ts` named; message says R4; grep fixed |
| Q30 | m | D7 window "before 09-24" | Derived from the wrong date | D7 moves into G1's owner-write block |
| Q31 | m | GP-D4 (files): "six public artefacts still sell estate; Claude banners them" (task 5.8) | **Found during G0 execution:** all six already open with a `HISTORICAL H0 ARTEFACT — DO NOT REUSE` banner (ROADMAP Sprint 0 row 0.7, B39). Neither revision of this plan verified before scheduling the edit | Task 5.8 is a verification, done 2026-09-12; only the YouTube/X half of B39 (Steve) remains |
| Q32 | — | (not a plan defect — a live finding while executing G0) | The 09-10 step-up walk left two `relay-stepup-e2e-*@relay.test` owners on production (61 h old, no rows); the orphan monitor went red 2026-09-12 13:43Z and its alarm sat **read, in Gmail Trash**. Found by a manual Trash search on 09-13 | Both closed via `deleteAccount()` (0 rows each), `verify:orphans` clean, monitor re-dispatched; recorded on B10's `re_scoped_2026_09_12` — the B10 failure mode, live |

---

## 0. What "gap" means here, and what was measured

### 0.1 The five kinds

| Kind | Definition | Closing action | In scope? |
|---|---|---|---|
| **P — Proof** | Specified, built, deployed, never exercised against the real system (`built`/`wired`, not `live-proven`) | run it once, for real; record the evidence | ✅ |
| **D — Drift** | Built, but the live system, its copy or its guardrails contradict the spec or a promise the product makes about itself | fix in place | ✅ |
| **U — Undecided** | The spec names a plank; no ruling says whether it is the product, deferred with a trigger, or struck | Steve records a disposition; Claude records it | ✅ (the ruling, never the build) |
| **R — Record** | The product is right and the documents are wrong about it | correct the doc/register; add the guard that stops the recurrence | ✅ |
| **B — Barred** | Specified, scoped, deliberately unbuilt behind a demand-evidence unlock (§2-F, §2-G, Standby Sprint F) | none until the named event | ❌ — listed in §3, **not scheduled** |

"Don't add new functionality" and the roadmap's barred/obliged test say the same thing. Kind **B** is new functionality; **P/D/U/R** make an existing capability or promise true.

**The "skill."** The only skill this repo names is the `/sprint` slash command. Its backlog order reads `.claude/sprint-state.json` first (only *with iterations remaining* — the current file has no such field) then `docs/backlog.md` (banner-ed SUPERSEDED, still showing a shipped crypto item as `NOT DONE`). Task 5.6 re-points it.

### 0.2 Measured 2026-09-12 (re-derive with the command; never quote these later)

| What | Command | Result today |
|---|---|---|
| Owner vault real (R1) | `npm run verify:dogfood` | **READY** — 2 owners / 1 item / 1 recipient / 1 verifier / 1 rule / 1 trigger |
| Real circle (R2) | `npm run beta:status` | alias-clean; recipient + verifier named, codes issued 09-10; verifier **not yet `confirmed`** |
| Reminder ladder | `npm run check:ladder` | **rungs ever sent 0**; live owner first rung **2026-10-03 15:36Z**, final **2026-10-08 03:36Z** — both move with any owner write |
| GitHub-scheduled tier | `npm run check:cadence` | 🔴 canary 9/24 h (96 designed), scheduler-monitor 7/24 h (48 designed) — the GitHub tier is collapsing (B11, known) |
| Off-GitHub heartbeat (B12.i) | `tail -1 .heartbeat/runs.jsonl`; `Get-ScheduledTask relay-heartbeat` | `ok` 2026-09-13T06:09Z; task **Ready**; it runs the real canary against production every 15 min |
| What the canary probes | `grep -n path lib/ops/canary.ts` | three behavioural paths (forged verifier token, checkout, webhook) — **not** `/api/health/scheduler` or `/api/health/reminders` |
| Live chain freshness | `tail -1 docs/verify-live-runs.jsonl` | stamped 2026-09-10T17:25Z @ `d8843e2`; dead-man **2026-09-24 17:25Z** |
| Journeys chain freshness | `tail -1 docs/verify-journeys-runs.jsonl` | stamped 2026-09-10T17:28Z; dead-man **2026-10-01 17:28Z** |
| Register guard | `TZ=UTC npx vitest run lib/ops/revisit-dates.test.ts` | **7 passed** — nothing fires 09-13 |
| Register size | the `yaml` one-liner in `ROADMAP.md` §0.2 | **70 deferred, 26 open** |
| Request-layer coverage | `npm run check:route-coverage` | 86.81 % / 79.48 %, floors 85 / 78 |
| Public routes | node `fetch` sweep | `/`, `/auth/signup`, `/auth/signin`, `/verify`, `/standby`, `/privacy`, `/terms`, `/guide` → 200; owner routes → 307; `/api/health`, `/pricing` → 404 by design |
| Cohort | `ls .relay-cohort*.json` | one 141-byte roster from 08-18; fourth deferral dated 2026-09-17 |
| Post-rev-8 merges | `git log --since=2026-09-10 --format=%h` | `850ea35`, `2853ef8` only |

### 0.3 The verdict

**The H0 obligation layer is built end to end.** Every R1–R17 criterion that is not withdrawn (estate) or explicitly unreachable (6.6) has code, tests and — for signup, sign-in, step-up, multi-owner, reveal, factors, delegate, request and stand-down — a production walk stamped 2026-09-10. Standby Sprints A–E are shipped and live-proven. Beta-ready is **seven of eight**; the eighth is one real verifier saying four words on a phone.

What separates the deployed product from the *specified* product is not missing code. It is **(P)** five specified behaviours never exercised for a real person — the reminder ladder, the failed-renewal notice, a fire drill with a real circle, a verifier confirmed by the call, a restore that decrypts; **(D)** the two scheduler dead-men being watched only by a collapsing GitHub tier while the off-GitHub heartbeat looks elsewhere, plus a dozen copy, setting and rotation items the product promises and does not yet do; **(U)** the spec planks in §2.U with no disposition, and one new ruling this QA surfaced — *when* the ladder can be proven, given that every owner action moves it; **(R)** the record rows in §2.R, now including five things revision 1 itself got wrong. §3 lists the barred items so the reader sees the whole delta; none is scheduled.

---

## 1. Spec coverage — where each layer stands

| Spec layer | Planks | Built | Live-proven | Not proven / drifted / undecided |
|---|---|---|---|---|
| Build Spec §4 **Must** FR1–FR9, FR17 | 10 | 10 (FR9's route retired by ruling 08-30; `/demo` is fixtures) | 9 | FR4/J5 ladder never fired → **GP-P1** |
| §4 **Should** FR10–FR12 | 3 | 3 | walked 08-13 | Req 13.6 unruled → **GP-U8**; J8 slice barred (§3) |
| §4 **Could** FR14–FR16, FR18 | 4 | 1 (FR15, at H0) | H0 only | failover never re-exercised → **GP-U11**; rest barred |
| NFR1–NFR9 | 9 | 9 | 8 | NFR1 re-proof = **GP-U11**; CC9 coverage → **GP-D1** |
| `.kiro` R1–R17 | 17 | 17 | 15 walked | R4.6 (**GP-P1**); R17 rotation never done (**GP-D8**); R8 `/audit` raw actions (**GP-D2**) |
| design.md Properties 1–20 | 20 | 19 (P1 struck) | tagged | Property 17 untagged → **GP-R6** |
| hybrid+6 §2 principles, §3.7 rules | 19 | 19 | walks 09-10 | — |
| Standby Sprints A–E, flows N1–N16 | 5 + 16 | 5 + 14 | per-sprint probes | N2, N8 deferred by ruling (§3 F-h) |
| user-journeys J1–J9 steps | ~60 | ~48 | 08-13 sweep + 3 walks | J6 note stale (**GP-R8**); open steps are §3 F-c/e/f/k/m/n |
| CC1–CC10 | 10 | 10 | CC8 closed 08-14 | CC9 → **GP-D1** |
| Ship-gates (Terms standby clause, privacy, `/caregivers`) | 3 | 3 | — | `/privacy` sub-processors → **GP-D5** |
| Build Spec §17–§27 | ~30 | 0 by design | — | un-ruled → **GP-U1–U7**; rest barred |

---

## 2. The gap register

Court: **S** Steve · **C** Claude · **CP** co-pilot · **E** event. ⏱ = an owner write that resets the check-in clock (Global Constraints). **5-gate** = ruling only until `/safe-execute` passes.

### 2.P — Proof gaps

| ID | Spec plank | Deployed state | Closure | Court | Sprint | Done when |
|---|---|---|---|---|---|---|
| **GP-P1** | FR4 / R4.6 / J5-3 — the reminder ladder; rungs 0.75/0.9 (`lib/release/checkin-reminder.ts:102-117`, ratified `sitting-d1-2026-08-30.rulings.b15_4_rungs_and_self_naming`) | `wired` · rungs ever sent 0 · today first 10-03, final 10-08 — **but every G1 owner write moves both** | Under **GP-U9**'s ruling: a quiet window with no owner sign-in and no owner write; observe the 75 % mail + `owner_checkin_reminder_first` row, then the 90 %, then the owner checks in and `check:ladder` reads clean | C observe · S hands off, then check in | G4 (natural date ≈ last G1 write + 22.5 d) | `the-reminder-ladder-has-never-fired` closed with both row ids and mail timestamps |
| **GP-P2** | `/terms` promises a failed-renewal notice (E1′) | `wired` · 7 deliveries, zero audit rows | Rev-8 row 2.5: instrument the webhook handler's first line (a production-code edit, `docs/e1-stripe-lapse-proof.md` final §); one authorised route-3 run writes at most one `renewal_payment_failed_notice` row on the live owner's log; name the branch | C build → CP one run on a fresh nod | G1 | `the-lapse-notice-is-wired-not-live-proven.attempted_3` names the branch |
| **GP-P3** ⏱ | Principle 5 (pull before push; alerting is allowed to fail); CC7 case ID — the fire drill | `POST /api/fire-drill` exists, owner-auth, 3/h; never run with a real person | Owner presses it with the real circle; **every verifier acknowledges** (that is the gate — pull worked); the *did-not-mail* list is recorded as information, not a gate | S press · C read the audit | G1 | one drill, every verifier acknowledged, audit rows cited |
| **GP-P4** ⏱ | R2 — a verifier `confirmed` by the four-word call (`POST /api/people/[id]/confirm`) | named, code issued 09-10, not claimed | The verifier claims; Steve calls; `/circle` light green; `revisit_outcome` on `adding-a-person-to-the-circle-does-not-invite-them` (revisit 09-17) | S + the verifier | G1 | `beta:status` → `state: confirmed` |
| **GP-P5** | Backup/restore with a decrypt — `gates.d3-restore-drill` | preflight READY 08-31; `met:` absent; due 2026-11-08 | One admin session per `docs/backup-restore-runbook.md`, incl. one KMS unwrap of a restored row | CP + S (spend, admin) | G4 | `met:` recorded with the row id and unwrap result |
| **GP-P6** | Step-up error classification (B15.6) | The fault injection **is done** (08-31, `shipped-but-unproven-release-guards.re_measured.b15_6…`: fail-closed classification injected on `requireStepUp`; `requireStepUpOnce` proven by a planted fail-open catch). What is missing: B15.6 is one clause nobody can map to that property | Steve confirms in one line that the proven property *is* B15.6; Claude restates B15.6 as that property in the register and ticks it | S one line → C | G0 | the sub-entry names the property and is closed |
| **GP-P7** | KMS EncryptionContext phase C (B5.2, B5.3) | phase B proven 20/20 (09-03); C gated on Steve lifting B5.0 | Ruling first (**GP-U12**); then S4-4 proof, then the flip | S → C → S | G4 or later | per the entry's `reopen_conditions` |
| **GP-P8** | `date-guards` never seen red | ruled *wait* 08-29 | none; fires on the next lapsed date | E | — | first red run cited |

### 2.D — Drift

| ID | Spec plank | What is wrong today | Closure | Court | Sprint | Done when |
|---|---|---|---|---|---|---|
| **GP-D1** | CC9 dead-man on the scheduler; ROADMAP B12 | The site's behaviour is watched off-GitHub every 15 min (B12.i). The **scheduler** and **reminders** dead-men (`/api/health/scheduler`, `/api/health/reminders`) are watched only by the collapsing GitHub tier (~3.4 h detection) | Two assertions in `lib/ops/canary.ts` (GET each, expect 200 + `healthy`); they then run in `production-canary.yml` **and** in `relay-heartbeat` every 15 min. Proof-of-red: point one at a bogus path in a dispatch and watch the heartbeat alert. Zero cost, no infra | C | G0 | both assertions in the canary; one heartbeat run seen red on a planted path, then green; B12's register entry updated |
| **GP-D2** | R8 / screen 7 — the audit log is readable (F-p) | `/audit` prints the raw action string (`AuditPageClient.tsx:191`) while the **actor** column already resolves a name with the raw value on a visible sub-line (`:181-190`) and `describeIncident` labels nine actions on the same page | Task 5.4: an action label map bound **both ways** to an independently derived emitted-actions list; visible sub-line, not `title`; scope = actions an owner's log can contain, fall-through for the rest. F-p's unlock ("a real owner reads `/audit`") is met since 08-29 — **GP-U13** confirms the reclassification | S nod → C | G0 | every scoped action renders a sentence; `a11y-audit.mjs` (owner mode, `/audit`) clean |
| **GP-D3** | R3 roles; ROADMAP B22 | `executor` is hidden in the UI and accepted by the API — **deliberately** (`PeopleSections.tsx:38-72`, the `estate` pattern). `VALID_ROLES` mirrors the DB CHECK (`001_initial.sql:65-66`); striking it needs a migration, which §7 bars | Read live `recipients.role` under `.env.ro` first. Ruling: *document the asymmetry as design* (recommended, no code) vs *strike with a migration* (its own decision) | C read → S ruling | G1 | the ruling on B22; if "document", a one-line comment in `enums.ts` and B22 closed |
| **GP-D4** | Estate copy is a defect (B39) | Six tracked public artefacts and the public YouTube demo still sell estate | Task 5.8 banners (Claude, docs only); YouTube edit/unlist + X-thread check (Steve) | C + S | G0 / G1 | the banner is the first `estate` hit in each file; YouTube decision recorded |
| **GP-D5** | `/privacy` names every sub-processor (B38) | Cloudflare and Google unnamed | One line from Steve, then the edit and a pinning test | S → C | G1 | `/privacy` lists both; test asserts |
| **GP-D6** | B41 / B42 — support promise; Reply-To | "Within one business day" on three surfaces with no reader; header mismatch | Two rulings, then copy and header edits | S → C | G1 | copy agrees with the process; headers agree |
| **GP-D7** ⏱ | B33 recovery codes | Live owner's 8 codes created at enrolment, never regenerated | Steve regenerates from `/account` (step-up, `POST /api/account/recovery-codes`) — **inside G1's owner-write block**, before the quiet window opens | S 2 min | G1 | NOTICE gone from `beta:status` |
| **GP-D8** 5-gate | B18 secret rotation (R17) | 26 keys never rotated; admin key `autospecai` 424 days; **the runbook has no section for it** | (1) Claude writes runbook §5b for the `.env.admin` laptop profile: what breaks mid-rotation (`migrate.ts`, `verify:iam`, `verify:kms`, `drill:preflight`; production unaffected), rollback = re-activate the old key. (2) `/safe-execute`. (3) **Steve** creates the new key, edits `~/.aws/credentials`, deactivates then deletes the old — no secret in chat. (4) Claude re-runs `verify:iam`, `verify:kms`, `verify:roles` and records the date; cadence recorded, no invented deadline | C → S → C | G3 | one key rotated with its date; three walls green after |
| **GP-D9** 5-gate | B16 residue — `verify:iam` is the only wall nothing schedules | Proposal complete (`docs/iam-wall-oidc-role-proposal.md`: role `relay-iam-wall-ci`, trust pinned to `refs/heads/master`, eight read actions); role not created | Steve creates the role (additive; rollback = delete). Claude's `iam-wall.yml`: plain `npm ci` (`@aws-sdk/client-iam` is a devDependency), sets `RELAY_RUNTIME_IAM_USER`, carries the "after 60 days" phrase, a `principal` dispatch input for proof-of-red, and adds the **fifth `CONTRACTS` entry** for the new role | S → C | G3 | green on the real account; red on a dispatched bogus principal |
| **GP-D10** | B20 — `infra/iam-policy.json` still grants `DbConnectAdmin` | template can re-open the wall | ruling, then the edit | S → C | G1 | template equals the live policy |
| **GP-D11** 5-gate | B17 / B36 / B29 | DR copy, AWS spend, backup status: no absence alarm | Sitting H bundle; each additive with delete-to-rollback; the confirmed SNS topic `NotifyMe` (us-east-1, acct 461293170793) already exists | S → C | G4 | each seen red once |
| **GP-D12** | C1.1 / C1.3 / C3 — DMARC reaches a human | filter never created; 08-17 Microsoft report unread; `p=none` | C1.1 co-pilot in the browser; C1.3 Steve downloads → Claude reads; C3 after a fortnight of reports (5-gate, DNS at Cloudflare) | CP / S → C / S | G2 / G4 | filter exists; report parsed; C3 ruled |
| **GP-D13** | B10 alarm of record | Newest measurement (08-30): relay alarms **are in Gmail Trash**, unread, on a 30-day purge; the filter has no delete action; delivery itself is proven | Close `revised_ends_when` (the filter was read and named 08-30) and open the residue as its own entry: *why* Trash, with the purge clock. Claude re-reads the newest alarm's headers/labels via the connector; if the mechanism stays unknown, the mitigation is a daily read of Trash for the alarm label | C | G0 | the entry re-scoped; residue entry has `ends_when` |
| **GP-D14** | B35 domain lapse | auto-renew unconfirmed | Steve reads the registrar; Claude records | S 1 min → C | G2 | `ends_when` clauses: auto-renew ON, card unexpired, expiry recorded, **and** a statement whether a non-human alarm mechanism exists (if none, say so) |
| **GP-D15** | B27 repo security | 3/5 on | nod; Claude flips validity checks + Dependabot security updates | S nod → C | G0 | both on |
| **GP-D16** | B21.3 / B21.4 CSP | retention unruled; nonce parked | retention ruling; nonce waits for real traffic | S | G1 | ruling recorded |
| **GP-D17** | B19 / B25 / B26 | three security rulings never taken | Sitting D-2 with the corrected defaults (§6 rows 11–13); **B19's execution stays in G4** | S | G1 (rule) · G4 (B19 execute) | rulings recorded |

### 2.U — Undecided

| ID | Plank | Why it is a gap | Closure | Court | Sprint |
|---|---|---|---|---|---|
| **GP-U1** | §18 incapacity verification | the emergency path's end state is undecided | disposition | S | G1 |
| **GP-U2** | §19 SOC 2 / GDPR-CCPA / DPA | zero mentions; a regulated partner's first questions | disposition (defer to G3 signature) | S | G1 |
| **GP-U3** | §20 bug bounty / whitepaper / OSS client | only the audit survives as G2 | defer to G5 | S | G1 |
| **GP-U4** | §21 open standard | never scheduled | strike | S | G1 |
| **GP-U5** | §22 SLOs / ledger | see U11 for the drill | defer to G4 | S | G1 |
| **GP-U6** | `business` / `travel` selectable during the caregiver test | outside the wedge | keep (built, reversible, not widening) | S | G1 |
| **GP-U7** | Mobile (§23, G12) | no trigger | assign one or strike | S | G1 |
| **GP-U8** | Req 13.6 plan preview | not built, not ruled | drop, or defer into §2-F under F-o | S | G1 |
| **GP-U9 NEW** ⏱ | **When can the ladder be proven?** Every G1 owner write pushes the first rung to write + 22.5 d | (a) **accept the natural date**: G1's last owner write ≈ 09-24 → first rung ≈ 10-16/17, final ≈ 10-21; a quiet window 09-24 → ~10-21 with no owner sign-in or write; E4.2 on 10-01 rules with the ladder unproven, which the EXTEND default already assumes. (b) shorten `checkin_interval_days` to **14** for the window: rungs at +10.5 d / +12.6 d, **overdue at +14 d — a missed check-in opens a real emergency to the real circle**, 1.4-day buffer; restore 30 after. **Recommended (a)** | S ruling | G0 (before G1's first owner write) |
| **GP-U10** | G11 quorums on one social graph; challenge window per trigger type | no owner ruling | Claude drafts options (task 5.7); Steve rules | C → S | G1 |
| **GP-U11** | FR15 / R14 / NFR1 failover | proven once at H0; never re-exercised. Master-push a11y runs read the **secondary** first (`getPool()` rule 3; `relay_ro`, SELECT-only) — evidence for **R14.1 only**, not daily, not the write clause | (a) record the master-push secondary read as dated R14.1 evidence; (b) the R14.2 re-proof (a cut-over) bundled with the restore drill | S ruling → C record | G1 record · G4 drill |
| **GP-U12** | B5.0 lift the EncryptionContext gate | deferred 08-20 with reopen conditions | re-read at the first stranger; not before | S | E |
| **GP-U13** | reclassify F-p (audit labels) from barred to obliged; and rule that the retired `estate_irreversibility_acknowledged` action gets a neutral past-tense label, never product-voice estate copy | see GP-D2 | one nod | S | G0 |
| **GP-U14** | E4.1 ruled 08-30 **KEEP INITIATE-ONLY, say so in `/terms`**; E4.2 (10-01) flip or extend; E5; E7 | the entry stays open until the `/terms` sentence lands (its `ends_when` ties it to the `canRelease` flip commit); CI red 10-02 if E4.2 is unrecorded | Claude drafts the `/terms` sentence into the E4.3 change-set now; E4.2 default **extend with a dated revisit**; E5, E7 ruled | C draft · S rule | G2 |
| **GP-U15** | D23 — what `relay-resumed.review_on: 2026-10-21` reviews | unstated | ruling | S | G1 |

### 2.R — Record

| ID | The record says | What is true | Fix | Court | Sprint |
|---|---|---|---|---|---|
| **GP-R1** | `web-analytics-collects-but-cannot-be-read` open, no `closed:` | enabled 09-01; the closure landed on `the-funnel-walk-spoke-for-a-half-it-could-not-see`; **clause 3 (where the queryability assertion lives) still unanswered** | on a nod: `closed:` with the cross-reference **and** clause 3 answered in the same edit, or a recorded partial | S nod → C | G0 |
| **GP-R2** | `nothing-turns-red-when-a-revisit-lapses` counted open | `revisited: {date: 2026-08-30, outcome: CLOSED, proven_by_planting}`; no `closed:` key | add `closed: 2026-08-30` citing PR #43 (`128e3cf`) | C | G0 |
| **GP-R3** | ROADMAP §2-D "D21 ✅ DONE 2026-09-03 via OIDC" | The register entry is **correctly open**: its `ends_when` needs one of `verify:schema/dogfood/orphans/flight:snapshot/verify:roles` observed in CI under the role; `relay-ro-ci` (PRs #60 repo side + #61 role/migration 040, both 2026-09-02) runs only the a11y mint | strike the ROADMAP overstatement; closing the entry is either Steve's re-scope or a workflow running one of the five under `relay-ro-ci` (Claude can draft; it is a new scheduled workflow → nod) | C strike · S | G0 |
| **GP-R4** | `verify-live-cannot-enter-ci` has no `ends_when` | it has `owner: steve` and `blocked_on`, which the existing well-formed test exempts — hygiene, not a failure | on a nod: `ends_when` = "arms-length money has moved (G4-class revenue), OR Steve re-rules" — D4's own wording, not G1's | S nod → C | G0 |
| **GP-R5** | ROADMAP rows C1.0, B28, D1's `~2026-09-08`, E1.8 ×4 (incl. `CLAUDE.md` and `scripts/verify-stripe.ts:31,94,138`), §3.5 rows 1.5/1.6, §4 missing the two 09-17 obligations, §6 Sittings A/B/E/F, **`ROADMAP.md:1219` "90 % rung 2026-09-26"**, CLAUDE.md "`verify:iam` has never been run against the real policy" (it ran 09-10, B28) | all done or superseded 08-30 → 09-10 | strike in place with date + commit | C | G0 |
| **GP-R6** | Property 17 "untagged" (design.md:925-935, tasks.md:36-44) | covered at `lib/import/csv-parser.test.ts:70` | add the tag; amend both spec files | C | G0 |
| **GP-R7** | Five docs describe 08-17 → 09-10 states as open (sitting sheet, cohort handoff:10,26, backlog:635, readiness assessment:13, standby plan §3a) | each closed; a deleted account's session answers 401 (`e2e-stepup.ts:231`) | banner or strike each | C | G0 |
| **GP-R8** | user-journeys J6 note (lines 486, 503, 573, 1577, 2267): outcomes "wired, never walked" | 4a + 4b proven by `verify:request` (`e2e-request.ts:241,342,445`); 4c both paths proven 08-31 (B15.3, 22/22) by `verify:escalation` | amend all five | C | G0 |
| **GP-R9** | `/sprint` resolves a spent lane | the live Claude queue is §5 | task 5.6 | C | G0 |
| **GP-R10** | ROADMAP §3 numbering collision (rev-8 1–3, rev-7 4–8) | unflagged | one banner line | C | G0 |
| **GP-R11 NEW** | revision 1 of this plan: "D25 unruled" | ruled RETIRE 08-30, executed PR #40 | this row is the record; no ruling owed | — | — |
| **GP-R12 NEW** | revision 1: D14, D20, B15.4, E4.1 "owed since 08-27" | ruled 08-30 in `ratified.sitting-d1-2026-08-30`; D20 executed (28 → 0) | no rulings owed; E4.1's sentence → GP-U14 | — | — |
| **GP-R13 NEW** | `the-reminder-ladder-has-never-fired.ends_when` names "2026-09-21T15:49Z" | passed out of truth 09-10 | re-date the `ends_when` to "the live owner's 75 % rung per `check:ladder`" (no literal date) | C | G0 |

---

## 3. The barred delta — specified, unbuilt, NOT scheduled

| ID | Specified capability | Unlock (verbatim from ROADMAP) |
|---|---|---|
| F-a | Requirable factors beyond the authenticator code | *"first real declaration answers (needs A0 + strangers)"* |
| F-b | Field-level vault-item editing + unwrap step-up decision | *"first real owner maintains a vault over time"* |
| F-c | J8 next-action card, ephemeral reveal, shared progress | *"a real recipient's observed need"* |
| F-d | Renewal receipt, quarterly review, life-event prompts | *"first arms-length subscription approaching renewal"* |
| F-e | J2 by-exception review, top-three gaps, document + email ingestion | *"demand evidence"* |
| F-f | J3 monthly delegate digest | *"demand evidence"* |
| F-g | Secret-types Phase 2 | *"F-a evidence + demand"* |
| F-h | Standby Sprint F (card, one-page plan, wallet pass, SMS rung, re-confirm; N2, N8) | *"post-G1 by ratified plan"* |
| F-i | KYC at claim | *"a partner's diligence or a real user demands it"* |
| F-k | Per-trigger-type cadence (migration) | *"demand evidence"* |
| F-l | J1 qualifier + latent-tier capture | *"demand evidence (build); Steve (ruling)"* |
| F-m | J4 proposed N-of-M defaults | *"demand evidence"* |
| F-n | J6 evidence attachment, multi-channel challenge, time remaining | *"demand evidence"* |
| F-o | Owner preview of the recipient's view | *"demand evidence"* |
| F-q | Durable rate-limit counters on two routes | *"first arms-length person / first placement / observed abuse"* |
| G1/G3/G13 | Tenancy; ZK productionisation; provider handoffs + ingestion tiers; residency | `gates.g3` met / post-G3 / partner pull |
| G2/G4/G5 | Audit + pen test; billing MVP; audited crypto | G1 met → G4 → G5 |
| C4 | SMS / A2P 10DLC | `revisit: 2026-11-30` |
| FR14/16/18 | Threshold secret-sharing; channel-partner org model; Plaid | never scheduled; map to G3 / G1 / G13 |

---

## 4. The sprint plan

**Stop rule (pre-registered):** the number moved is *open rows in §2.P/D/U/R*. Target: 0 Claude/co-pilot rows and 0 rulings owed by the end of G4; §3 rows are not counted. Minimum gain per sprint: **3 rows closed**. Below that, the next scoping note leads with **STOP recommended** and the trailing-3 table; it runs only on Steve's override.

### G0 — The record and the nods *(2026-09-12 → 09-17 · Claude's court · Steve ≈ 15 min: one ruling and five nods)*

| # | Row | Court | Done when |
|---|---|---|---|
| G0.1 | **GP-R2** `closed:` on the revisit-lapse entry; **GP-R13** the ladder entry's `ends_when` re-dated; the new `revisited.outcome` rule in the existing well-formed test (task 5.1) — ✅ **merged PR #75, 2026-09-12** | C | one-liner reads **74 total, 28 open** (26 − R2 + the three new open rulings GP-U9/U11/R9; the GP-R11–13 record entry is born closed); test proven red on the base, then green |
| G0.2 | **GP-R1, R3, R4** — nod-gated register edits (task 5.1 second half) | S nod → C | on nods: 70 / 24 (R1 closed) and R4 well-formed; R3's ROADMAP overstatement struck either way |
| G0.3 | **GP-R5, R10** ROADMAP + CLAUDE.md + `verify-stripe.ts` strikes (task 5.2) | C | `npx vitest run lib/ops/roadmap-court.test.ts lib/ops/g-lane-names.test.ts` green |
| G0.4 | **GP-R7, R8** six docs, five J6 lines (task 5.3) | C | `npx vitest run lib/ops/journey-state.test.ts` green; stale phrases grep empty |
| G0.5 | **GP-R6** Property 17 tag + both spec files (task 5.5) | C | tag present once |
| G0.6 | **GP-R9** `/sprint` pointer with `iterationsRemaining` (task 5.6) | C | the orient step names this file as the backlog source |
| G0.7 | **GP-D4 (files)** six estate banners (task 5.8) — ✅ **already present; verified 2026-09-12** (Q31) | C | banner is the first `estate` hit in each — it is |
| G0.8 | **GP-D1** two canary health assertions + proof-of-red via the heartbeat (task 5.9) | C | one heartbeat run seen red on a planted path, then green |
| G0.9 | **GP-D13** B10 re-scope + residue entry (task 5.10) | C | entry re-scoped; residue has `ends_when` |
| G0.10 | **GP-P6** on Steve's one-line confirmation: B15.6 restated as its property and ticked | S line → C | sub-entry closed |
| G0.11 | **GP-U13 → GP-D2** on a nod: audit labels (task 5.4) | S nod → C | `a11y-audit.mjs` owner mode clean on `/audit`; both-way binding test green |
| G0.12 | **GP-D15** on a nod: two repo settings | S nod → C | both on |
| G0.13 | **GP-U9** the ladder-window ruling — **before G1's first owner write** | S ruling | recorded on `the-reminder-ladder-has-never-fired` |
| G0.14 | **GP-U10** options brief (task 5.7); the rulings pack (§6) into `docs/rulings-pack-sitting-d.md`; **NEW** register rows GP-U9, GP-U11, GP-R9, GP-R11–R13, the B10 residue | C | each new entry has owner/opened/what/why/ends_when |

**Done when:** every C row merged by PR; every nod-gated row merged or its nod recorded as withheld; GP-U9 ruled. Nothing in G0 writes to production except one planted canary red.

### G1 — Real people, real rulings *(2026-09-17 → 09-24 · = rev-8 Sprint 2 + Sitting D-2 · Steve ≈ 3 h: the sends and calls (by design), ~20 rulings ≈ 100 min, four owner writes)*

**All ⏱ rows happen inside this sprint, and the last of them starts the quiet window (GP-U9).**

| # | Row | Court | Done when |
|---|---|---|---|
| G1.1 ⏱ | **GP-P4** the verifier claims; the four-word call; `revisit_outcome` (revisit 09-17) | S + verifier → C | `beta:status` → `confirmed` |
| G1.2 ⏱ | **A3.1 roster** (fourth deferral lands 09-17) → A3.2 dry run → A3.3 `--commit` (owner cookie) → A3.4 owner-arm sends (not a product write); Outlook addresses on the owner arm | S / C / CP / S | first arms-length claim, or a dated fifth deferral |
| G1.3 ⏱ | **GP-P3** fire drill with the real circle | S press · C audit | every verifier acknowledged |
| G1.4 ⏱ | **GP-D7** recovery codes regenerated | S 2 min | NOTICE gone |
| G1.5 | **GP-P2** E1′ instrumented; one route-3 run on a fresh nod | C → CP | branch named |
| G1.6 | **A6 follow-ups 09-22** logged, including silence | S | three outcome rows |
| G1.7 | **Sitting D-2** (§6 rows 5–24): GP-D3 (after the live-rows read), D5, D6, D10, D16, D17, U1–U8, U10, U11 record, U15 | S ≈ 100 min | each recorded |
| G1.8 | The edits the rulings license, one PR each: privacy line + test; B22 comment or nothing; IAM template; Reply-To; copy softening; R14.1 evidence recorded | C | merged; `verify:iam` / `verify:ui` assert |
| G1.9 | **GP-D4 (accounts)** YouTube edit or unlist; X-thread check | S | recorded on B39 |
| G1.10 | `npm run verify:live` before the **09-24 17:25Z** dead-man (disposable owners only — not a live-owner write) | C | fresh stamp |
| G1.11 | **A1 acceptance watch** (rev-8 row 2.6): caregiver.com window to ~09-30; re-verify submission guidelines before any follow-up; A1.8 on acceptance | S | a reply logged, or the 09-30 silence recorded |

**Done when:** one real claim and one `confirmed` verifier · one fully acknowledged drill · E1′'s branch named · Sitting D-2 answered · licensed edits merged · live stamp ≥ 09-23 · the quiet window has begun (no further owner writes).

### G2 — Billing truth, quiet window *(2026-09-24 → 10-01 · = rev-8 Sprint 3 + Sitting E · Steve ≈ 20 min + the 10-01 decision · **no owner sign-in, no owner write**)*

| # | Row | Court | Done when |
|---|---|---|---|
| G2.1 | **GP-D12** C1.1 Gmail filter (co-pilot, browser — not the owner account); C1.3 Steve downloads the 08-17 report → Claude reads | CP / S → C | filter exists; verdict recorded |
| G2.2 | **GP-D14** registrar read | S 1 min → C | the four `ends_when` clauses answered |
| G2.3 | **E1.5** Stripe dashboard reads #3/#4; **D28** the done-but-unrecorded lines | S ~10 min → C | recorded |
| G2.4 | **A3.6 Phase-0 report** against the ~50 % floor | C | in `docs/sprint-reports/` |
| G2.5 | **GP-U14** the `/terms` sentence drafted into the E4.3 change-set (E4.1 already ruled); **E4.2 on 10-01: extend with a dated revisit** (recommended) or flip; E5; E7 (Claude reads `stripe tax settings retrieve --live` first) | C draft · S rule | `beta-free-release.revisited` block; nothing red 10-02 |
| G2.6 | `npm run verify:journeys` before the **10-01 17:28Z** dead-man | C | fresh stamp |

**Done when:** Sitting E recorded · Phase-0 report exists · E4.2/E5/E7 recorded on 10-01 · CI green 10-02 · the quiet window unbroken.

### G3 — The machine watches; the window holds *(2026-10-01 → 10-08 · Steve ≈ 30 min + two `/safe-execute` sittings · still no owner write)*

| # | Row | Court | Done when |
|---|---|---|---|
| G3.1 | **GP-D9** 5-gate: Steve creates `relay-iam-wall-ci`; Claude's `iam-wall.yml` per the five requirements | S → C | green on the real account; red on a bogus dispatch |
| G3.2 | **GP-D8** 5-gate: runbook §5b (Claude) → `/safe-execute` → Steve rotates the admin key → three walls re-run | C → S → C | one key rotated with its date |
| G3.3 | Devpost prize clock ~10-08 checked | S | a line in the register |
| G3.4 | `check:ladder` read daily; the two rungs are expected ≈ 10-16/17 and ≈ 10-21 under GP-U9(a) | C | dates recorded as they print |

**Done when:** `verify:iam` runs daily under OIDC · one secret rotated · the window still unbroken.

### G4 — The ladder fires; recovery proven *(2026-10-08 → 11-08 · = rev-7 Sprint 4 / Sitting H · co-pilot · one admin session ≈ 2–3 h)*

| # | Row | Court | Done when |
|---|---|---|---|
| G4.1 | **GP-P1** first rung mail + audit row seen (~10-16/17); final rung (~10-21); **then** the owner checks in; `check:ladder` clean | C observe · S check in after the final rung | entry closed |
| G4.2 | **GP-P5** restore drill with a decrypt (ceiling 11-08) | CP + S | `met:` recorded |
| G4.3 | **GP-U11(b)** failover re-exercise bundled with the drill if so ruled | CP + S 5-gate | R14.2 evidence dated 2026 |
| G4.4 | **GP-D11** three absence alarms (B17, B36, B29) via `NotifyMe` | S 5-gate → C | each seen red once |
| G4.5 | **B19** executed per GP-D17's ruling: `enable-key-rotation` **and** `ROTATION_INTENDED = true` in one commit; `verify:kms` green | CP | daily wall green |
| G4.6 | **GP-D12 C3** DMARC step-up after a fortnight of reports | S 5-gate → C | ruled or dated |
| G4.7 | **GP-P7 / U12** only if B5.0's reopen conditions are met; **GP-U15** the 10-21 review executed | S → C | per the entries |

**Done when:** the ladder has fired and cleared for a real owner · a restore that decrypts has happened · every unattended job has an absence alarm · §2 has zero open Claude/co-pilot rows and zero rulings owed. Then ROADMAP revision 9 absorbs this file; Sprints 5–8 proceed on their events.

### What "closed" means for this plan

`verify:dogfood` READY · `beta:status` one `confirmed` verifier · `check:ladder` rungs sent > 0, none overdue · the heartbeat has been seen red once on a planted health path · `gates.d3-restore-drill.met` present · the one-liner's open count equals exactly the §3 barred rows plus the event-gated ones (`c4…`, `requirable-factors…`, `tenant-separation…`, `no-entity…`, `the-auth-and-react…`, `the-read-only-identity…` unless a workflow closes it) · `TZ=UTC npx vitest run lib/ops/revisit-dates.test.ts` green · every §2.R row struck.

---

## 5. Claude-court task detail

One PR per task on a branch from `master`; explicit `git add <paths>`; no trailer; `npm run gate` green and `npx tsc --noEmit` after every edit. The harness pre-push hook runs `next build` + `npm test` and blocks the whole command on a failure.

### Task 5.1: The register — one new rule, two clerical edits, three nod-gated edits

**Files:** Modify `PROJECT.yaml`; Modify `lib/ops/project-yaml-parses.test.ts` (existing guard, `:159-180`).

**Interfaces:** consumes the `deferred:` entry shape at `PROJECT.yaml:2054` (`id`, `owner`, `opened`, `what`, `why`, `ends_when`, optional `closed`, `held`, `blocked_on`, `revisit`, `revisited`). The existing test already asserts owner + `ends_when` on open entries and **exempts `held`/`blocked_on`** — keep that carve-out.

- [ ] **Step 1: Add the one genuinely new rule to the existing test file** (do not create a third file):

```ts
it('an entry with revisited.outcome CLOSED also carries closed:', () => {
  const bad = parsed().deferred
    .filter((e) => !('closed' in e) && e.revisited?.outcome === 'CLOSED')
    .map((e) => e.id);
  expect(bad).toEqual([]);
});
```

- [ ] **Step 2:** `npx vitest run lib/ops/project-yaml-parses.test.ts` → FAIL naming exactly `nothing-turns-red-when-a-revisit-lapses`.
- [ ] **Step 3 (GP-R2, Claude's):** add to that entry `closed: 2026-08-30` and `closed_by: "PR #43 (128e3cf) — revisit-dates.test.ts; proven by planting four ways (see revisited:). The closed: key was omitted; added 2026-09-12."`
- [ ] **Step 4 (GP-R13, Claude's):** in `the-reminder-ladder-has-never-fired.ends_when` replace the literal `2026-09-21T15:49Z` with "the live owner's 75 % rung as `npm run check:ladder` prints it on the day (it moves with any owner write)".
- [ ] **Step 5:** test green; one-liner → **70 total, 25 open**. Commit `PROJECT.yaml lib/ops/project-yaml-parses.test.ts` — message: `Register: the revisit-lapse entry says closed; the ladder entry stops asserting a dead date (gap plan R2, R13)`.
- [ ] **Step 6 (nod-gated, GP-R1):** on Steve's nod, `web-analytics-collects-but-cannot-be-read` gains `closed: 2026-09-01`, `closed_by:` naming `the-funnel-walk-spoke-for-a-half-it-could-not-see`, **and** a `queryability_assertion_lives:` line with Steve's answer (or `partial: clause 3 open` if he declines to decide).
- [ ] **Step 7 (nod-gated, GP-R4):** on the nod, `verify-live-cannot-enter-ci` gains `ends_when: >- arms-length money has moved (a gates.g4-class event) — D4's ruling is "deferred until the first paying customer" — OR Steve re-rules earlier.`
- [ ] **Step 8 (GP-R3, Claude strikes ROADMAP; the entry stays open):** covered in task 5.2 step 3b.
- [ ] **Step 9:** commit the nod-gated edits separately — message: `Register: R1 closed with clause 3 answered; D4 gains its ends_when (gap plan R1, R4)`.

### Task 5.2: ROADMAP, CLAUDE.md and verify-stripe.ts strikes in place (GP-R5, R10)

**Files:** Modify `ROADMAP.md`, `CLAUDE.md`, `scripts/verify-stripe.ts` (comments only).

- [ ] **Step 1:** §2-C C1.0 — prefix `~~🔴 …~~ ✅ CLOSED 2026-08-30 (`dmarc-had-no-rua-so-no-report-could-arrive`)`; tick §6 Sitting C's C1.0.
- [ ] **Step 2:** §2-B B28 — prefix `✅ CLOSED 2026-09-10 (PRs #69, #73; row 1.4)`; strike the "do not read this row as closed" clause.
- [ ] **Step 3:** §2-D D1 deadline cell → `next fires 2026-09-24 17:25Z; re-derive: tail -1 docs/verify-live-runs.jsonl`. **3b:** §2-D D21 "✅ DONE 2026-09-03 via OIDC" → `✅ role + migration 040 both regions (PRs #60 + #61, 2026-09-02); ⚠️ the register entry the-read-only-identity-is-not-in-the-cloud is CORRECTLY OPEN — its ends_when needs one of the five .env.ro verifications observed in CI; a11y's mint is not one of them`.
- [ ] **Step 4:** E1.8 in §2-E, §3.5 §B2, §4's `2026-10-07` row, `CLAUDE.md`'s `verify:stripe` comment ("EXPIRES 2026-10-07"), and `scripts/verify-stripe.ts:31,94,138` → `re-paired 2026-09-10, expiry 2026-12-10; the scheduled path reads STRIPE_READONLY_KEY`.
- [ ] **Step 5:** §3.5 "Claude-court rows opened by the beta sprints" — strike 1.5 and 1.6 with `✅ 09-10` (keep the ids in the text; `roadmap-court.test.ts` checks `sec.includes(id)`).
- [ ] **Step 6:** §4 calendar — add **2026-09-17** rows for A0.2's moved revisit and the cohort's fourth deferral (the table has no `Court` column; the parser ignores it). Strike `ROADMAP.md:1219`'s `2026-09-26 03:49Z | the 90% rung` and §3 row 3.1's date → `both rungs per npm run check:ladder; they move with any owner write`.
- [ ] **Step 7:** §6 — tick Sitting A `[x] A0 — done 2026-08-29`; Sitting B `[ ] B10 Remove the Gmail rule` → strike, `no delete action (b10_prime)`; Sitting E — strike A7.0, E1.7, B10.d with dates; Sitting F — strike C2.2 `STRUCK 2026-09-10, moot; do not re-open`.
- [ ] **Step 8:** `CLAUDE.md` `verify:iam` paragraph: "has never been run against the real policy" → `first live run 2026-09-10 (B28 found_2026_09_10: 5 principals held)`.
- [ ] **Step 9:** above `### Sprint 4 — Recovery proven` insert: `> ⚠️ Sprints 4–8 keep revision 7's numbering; Sprints 1–3 above are revision 8's. Sprint 4 follows rev-8 Sprint 3 in the calendar — see docs/gap-closure-plan-2026-09-12.md §4 G4.`
- [ ] **Step 10:** `npx vitest run lib/ops/roadmap-court.test.ts lib/ops/g-lane-names.test.ts` → green (a struck row reads as CLOSED and relaxes the court rule).
- [ ] **Step 11:** commit the three paths — message: `ROADMAP/CLAUDE.md/verify-stripe: twelve places that still asked for done work are struck in place (gap plan R5, R10)`.

### Task 5.3: Six documents catch up (GP-R7, R8)

**Files:** Modify `docs/sitting-2026-09-12.md`, `docs/beta-cohort-handoff.md:10,26`, `docs/backlog.md:635`, `docs/product-readiness-assessment-2026-08-16.md:13`, `docs/standby-sprint-plan.md` §3a (`:216-239`), `docs/user-journeys.md:486,503,573,1577,2267`.

- [ ] **Step 1:** sitting sheet banner: `> ✅ RAN 2026-09-10 (ruled forward). B28 closed 09-10; A0.2 moved to 2026-09-17. Nothing fires 09-13 (revisit-dates.test.ts 7/7 on 09-12). Kept as the record.`
- [ ] **Step 2:** cohort handoff `:10` → `⏰ Fourth deferral recorded 2026-09-10, revisit 2026-09-17 (ratified.beta-cohort-deferred-four-days.fourth_deferral_2026_09_10)`; `:26` → `✅ READY since 2026-08-29 (verify:dogfood)`.
- [ ] **Step 3:** backlog `:635` → `✅ SHIPPED 2026-09-03 as B5.1 phase B (PR #58); S4-4 stays specified-not-written behind B5.0`; extend the top banner with the pointer written in task 5.6.
- [ ] **Step 4:** readiness assessment `:13` block: `C1.0 closed 2026-08-30; C2 answered by Resend 2026-09-03 (Outlook = reputation, no remedy; C2.2 struck).`
- [ ] **Step 5:** standby plan §3a, after `:239`: `✅ DONE before beta: a deleted account's session answers 401 — scripts/e2e-stepup.ts:231, run in every verify:live chain since 2026-08-21.`
- [ ] **Step 6:** user-journeys, at each of the five lines, append: `→ ✅ 4a and 4b live-proven by npm run verify:request (scripts/e2e-request.ts:241,342,445); 4c both paths live-proven 2026-08-31 (B15.3, 22/22), re-run by npm run verify:escalation.`
- [ ] **Step 7:** `npx vitest run lib/ops/journey-state.test.ts` → green (the only test that reads one of these files).
- [ ] **Step 8:** commit the six paths — message: `Docs: six files that still described 08-17..09-10 states as open are banner-ed (gap plan R7, R8)`.

### Task 5.4: `/audit` renders a sentence for every owner-visible action (GP-D2) — **after the GP-U13 nod** · size **M**

**Files:**
- Create: `lib/audit/action-labels.ts`, `lib/audit/action-labels.test.ts`, `lib/ops/audit-actions-are-labelled.test.ts`
- Modify: `src/app/(owner)/audit/AuditPageClient.tsx:191`

**Interfaces:** Produces `labelForAction(action: string): string` (a sentence for a known action; the raw string, unchanged, for an unknown one — never throws, never hides data) and `OWNER_VISIBLE_ACTIONS: readonly string[]`, **derived independently of the label map** by enumerating the action literals, constants (`RELEASE_NOTICE_UNDELIVERED_ACTION`, `fire_drill_*`, `verifier_silence_notified`, …), ternaries (`approval_granted|approval_rejected`, `standby_marked_|unmarked_break_glass_only`, `standby_rejected|resigned`), `IntegrityAction` values (`lib/db/integrity.ts:42-46`) and the template `release_transition_${state}` × `ReleaseStateValue` (`lib/release/state-machine.ts:38,335`). Consumes the existing `ACTION_LABEL` in `src/app/(verify)/verify/VerifyClient.tsx:68-73` and `describeIncident` in `lib/audit/incident-record.ts:90-165`; the header comment states why three maps exist and which owns which surface.

- [ ] **Step 1: Enumerate** — `grep -rhoE "action: ['\"][a-z_]+['\"]" lib src --include=*.ts --include=*.tsx --exclude=*.test.* | sort -u`, then add the constants/ternaries/template cases by hand from the four files named above. Mark internal actions (`kms_wrap_requested`, `policy_materialized`, `ref_integrity_*`, `ai_intake`) as out of scope — they fall through.
- [ ] **Step 2: The both-way binding test** (copy the shape of `lib/ops/verify-timeline-is-labelled.test.ts`):

```ts
// lib/ops/audit-actions-are-labelled.test.ts
import { describe, it, expect } from 'vitest';
import { OWNER_VISIBLE_ACTIONS, LABELS } from '../audit/action-labels';

describe('every owner-visible audit action has a sentence, and no label is orphaned', () => {
  it('labels every owner-visible action', () => {
    const missing = OWNER_VISIBLE_ACTIONS.filter((a) => !(a in LABELS));
    expect(missing).toEqual([]);
  });
  it('has no label for an action nothing emits', () => {
    const orphans = Object.keys(LABELS).filter((a) => !OWNER_VISIBLE_ACTIONS.includes(a));
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 3:** run → FAIL (module missing). **Step 4:** implement `action-labels.ts` with `OWNER_VISIBLE_ACTIONS` first (the independent list), then `LABELS` in the product's voice, past tense. `estate_irreversibility_acknowledged` → `'Irreversibility was acknowledged for a trigger type that is no longer offered'` (neutral, per GP-U13). Unit test in `action-labels.test.ts`: the undelivered-release sentence; unknown → unchanged.
- [ ] **Step 5:** in `AuditPageClient.tsx:191` mirror the actor column (`:181-190`): the sentence on the first line, the raw action on a visible `text-t1 text-muted` second line. No `title=`.
- [ ] **Step 6:** `npx vitest run lib/ops/audit-actions-are-labelled.test.ts lib/audit/action-labels.test.ts` → PASS; `npx tsc --noEmit`; `node scripts/a11y-audit.mjs` with `A11Y_OWNER_EMAIL` = the fixture owner (it audits `/audit`, `scripts/a11y-audit.mjs:79`) → 0 serious/critical.
- [ ] **Step 7:** commit the four paths — message: `/audit reads as sentences; the raw action stays visible on a second line; the label map is bound both ways to what the service emits (F-p reclassified, gap plan D2)`.

### Task 5.5: Tag Property 17 (GP-R6)

- [ ] `lib/import/csv-parser.test.ts:70` — add `// Feature: relay-h0-mvp, Property 17: CSV import deduplication` above the `it(`.
- [ ] `.kiro/specs/relay-h0-mvp/design.md:929-933` and `tasks.md:36-44` — replace "untagged" with `tagged 2026-09-12`.
- [ ] `grep -c "Property 17" lib/import/csv-parser.test.ts` → 1. Commit the three paths.

### Task 5.6: The `/sprint` skill resolves a live queue (GP-R9)

- [ ] Rewrite `.claude/sprint-state.json` per its D17 convention: `backlogSource: "docs/gap-closure-plan-2026-09-12.md §5 — the G0 Claude lane"`, `sprint: "Gap-closure G0"`, `calendar` (G0–G4 dates), `court` (tasks 5.1–5.3, 5.5–5.10 Claude; 5.4 nod-gated), **`iterationsRemaining: 5`** with a `_comment` line explaining the skill's first resolution bullet reads it; keep `rowsClosed` intact and append as PRs merge.
- [ ] `docs/backlog.md` banner: append `The live Claude queue as of 2026-09-12 is docs/gap-closure-plan-2026-09-12.md §5; /sprint reads .claude/sprint-state.json first, which points there.`
- [ ] Verify: `~/.claude/commands/sprint.md` §1.1 step 2 bullet 1 now resolves; done-when = the orient step names this file. Commit both paths.

### Task 5.7: Options brief for GP-U10

- [ ] Create `docs/g11-quorum-and-challenge-window-options.md`: for (a) recovery and release quorums on one social graph and (b) the owner-challenge window per trigger type, two or three options each with what the code does today (`lib/release/`, `lib/people/`, `CHALLENGE_WINDOW_SECONDS` in `lib/release/access-request.ts`), what each changes, what it must not change (the seven edges), a recommended default. No code. Add both to §6. Commit.

### Task 5.8: Estate banners on six public artefacts (GP-D4 files) — ✅ verified present 2026-09-12, no edit (Q31)

- [x] All six (`DEVPOST-PASTE-READY.txt`, `demo-out/x-thread.md`, `demo-out/youtube-metadata.md`, `demo-out/narration-script.md`, `demo-out/teleprompter.html`, `docs/blog-post.md`) already open with `HISTORICAL H0 ARTEFACT — DO NOT REUSE THIS COPY. IT SELLS A CAPABILITY RELAY DOES NOT HAVE` (the `.html` as a comment), placed by ROADMAP Sprint 0 row 0.7 (B39). `head -2` on each, 2026-09-12. Remaining half of B39 is Steve's: the public YouTube description or unlist, and the X-thread check (G1.9).

### Task 5.9: Two canary health assertions (GP-D1)

**Files:** Modify `lib/ops/canary.ts` (the check list at `:102-117`), `lib/ops/canary.test.ts` (or the existing canary test file); no workflow change — `production-canary.yml` and `scripts/heartbeat-local.ts` both run `scripts/canary.ts`.

- [ ] **Step 1:** failing test: the check list contains entries for `/api/health/scheduler` and `/api/health/reminders` expecting status 200 and a body whose `status`/`healthy` field is the healthy value (read the exact field names from `src/app/api/health/scheduler/route.ts` and `reminders/route.ts`).
- [ ] **Step 2:** add the two checks in the same shape as the three existing ones; a 503 or a non-healthy body is a finding with the route's own reason text in `detail`.
- [ ] **Step 3:** proof-of-red: `CANARY_BASE_URL=https://relaystandby.com/nonexistent-prefix node scripts/canary.ts` locally → exit 1 naming both; then a normal run → exit 0. Then one `relay-heartbeat` cycle observed `ok` in `.heartbeat/runs.jsonl`.
- [ ] **Step 4:** update `PROJECT.yaml` B12's entry: the two dead-men are now watched off-GitHub every 15 min; the GitHub tier remains what `check:cadence` says it is. Commit the three paths — message: `Canary: the scheduler and reminder dead-men are probed by the off-GitHub heartbeat too (gap plan D1, B12)`.

### Task 5.10: B10 re-scope and residue (GP-D13)

- [ ] In `PROJECT.yaml` `the-alarm-of-record-delivers-to-trash`: add `closed_revised_ends_when: 2026-08-30 — the filter was read and named (b10_prime); delivery proven`; open a new entry `relay-alarms-land-in-trash-for-an-unknown-reason` (owner claude, `ends_when`: the mechanism is named, or a daily Trash read for the alarm label is in place and has been seen to surface one). Re-read the newest alarm's headers via the Gmail connector (`has:userlabels in:trash newer_than:7d` — `label:` returns nothing) and record what the message itself shows (`X-Gmail-Labels`, whether "Delete" appears in filter actions). Commit.

---

## 6. The rulings pack — one sheet for Steve

≈5 min each. Recommended default first; a ruling licenses the edit in its row. Rows 1–4 are G0; 5–24 are Sitting D-2 in G1; 25–26 are `/safe-execute` sittings in G3; 27–29 land 10-01.

| # | Ruling | Recommended default | Licenses |
|---|---|---|---|
| 1 | **GP-U13** reclassify F-p; neutral label for the retired estate action | obliged; neutral past-tense label | task 5.4 |
| 2 | **GP-D15** B27 validity checks + Dependabot security updates | yes | two settings |
| 3 | **GP-R1 / R4** nods; **GP-P6** one-line confirmation | yes; yes; "that property is B15.6" | task 5.1 steps 6–7; P6 tick |
| 4 | **GP-U9** the ladder proof window | **(a)** natural date after G1's last owner write; quiet window to ~10-21 | G2–G4 calendar |
| 5 | **GP-D3** B22 `executor`: document as design, or strike with a migration | **document** (after the live-rows read) | one comment |
| 6 | **GP-D5** B38 name Cloudflare + Google | yes | edit + test |
| 7 | **GP-D6** B41 "one business day" | soften to "we read every message" until a reader exists | copy |
| 8 | **GP-D6** B42 Reply-To/From | align | header |
| 9 | **GP-D10** B20 IAM template | match the live policy | template |
| 10 | **GP-D16** B21.3 CSP report retention | 30 days | a cron line |
| 11 | **GP-D17** B19 CMK auto-rotation | **enable — `enable-key-rotation` and `ROTATION_INTENDED = true` in ONE commit, `verify:kms` green after; ~$24/yr recurring; rotated material is not removable; execute in G4** | G4.5 |
| 12 | **GP-D17** B25 bulk session revocation — build / defer with trigger / accept "rotate `NEXTAUTH_SECRET`" | **accept and document**; defer a built control to the first stranger. (A raw `session_epoch` bump skips `revokeChallenges` and would meet DSQL's per-transaction row cap one day — not a runbook line) | runbook sentence |
| 13 | **GP-D17** B26 Q6 / Q16 | defer with F-b | register |
| 14 | **GP-U1** §18 incapacity verification | defer; trigger = first regulated-partner conversation (G7) | register |
| 15 | **GP-U2** §19 SOC 2 / GDPR-CCPA / DPA | defer; trigger = G3 signature | register |
| 16 | **GP-U3** §20 legible trust | defer to G5 | register |
| 17 | **GP-U4** §21 open standard | strike | register |
| 18 | **GP-U5** §22 SLOs / ledger | defer to G4 | register |
| 19 | **GP-U6** `business` / `travel` selectable | keep | none |
| 20 | **GP-U7** Mobile | strike until partner pull | register |
| 21 | **GP-U8** Req 13.6 plan preview | defer into §2-F under F-o | register |
| 22 | **GP-U10** G11 quorums / challenge window | read task 5.7's brief | register |
| 23 | **GP-U11** failover | (a) record the master-push secondary read as **R14.1** evidence now; (b) the cut-over with the drill (G4) | register + G4.3 |
| 24 | **GP-U15** D23 what 2026-10-21 reviews | "is report-bridge still the precedence, and did G1 move" | register |
| 25 | **GP-D9** 5-gate: create `relay-iam-wall-ci` | yes (additive; rollback = delete role) | G3.1 |
| 26 | **GP-D8** 5-gate: rotate the admin key | yes, after runbook §5b exists; Steve's hands, no secret in chat | G3.2 |
| 27 | **E4.2** (10-01) flip or extend | **extend, dated revisit** | `beta-free-release.revisited` |
| 28 | **E5** billing check in an automated chain | no | register |
| 29 | **E7** Stripe Tax | Claude reads first, then rule | — |

Struck from revision 1's pack, because they were already ruled on 2026-08-30: D25 demo (RETIRE, executed), D14 (LEAVE IT), D20 (PURGE, executed), B15.4 (RATIFY), E4.1 (KEEP INITIATE-ONLY). B10's "re-prove once" is struck because delivery is proven and the entry itself moves the residue to Claude.

---

## 7. Explicitly not in this plan

- Anything in §3. Not scheduled, not started, not prepped.
- A new monitor, register, or dashboard. GP-D1 adds two assertions to the canary that already runs; nothing is bought.
- Any migration (GP-D3's "strike" option would need one and is therefore not the default). Widening `PERMITTED_TRANSITIONS`, `USER_SELECTABLE_TRIGGER_TYPES`, `VALID_ROLES`, the signup `LIMIT`, or `verify:orphans`'s ignore list.
- Running `scripts/reset-demo.ts` (barred by name) or re-creating `/api/demo/simulate` (retired by ruling).
- Rewriting `ROADMAP.md` wholesale. Revision 9 absorbs this file; task 5.2 is the minimum that keeps revision 8 honest until then.

## 8. Re-derive before acting

`npm run verify:dogfood` · `npm run beta:status` · `npm run check:ladder` · `npm run check:cadence` · `tail -1 docs/verify-live-runs.jsonl` · `tail -1 docs/verify-journeys-runs.jsonl` · `tail -1 .heartbeat/runs.jsonl` · `TZ=UTC npx vitest run lib/ops/revisit-dates.test.ts` · the `yaml` one-liner · `git log --since=2026-09-12 --format='%h %s'`. If any disagrees with §0.2, this file is stale on that row; the live value wins and the row is re-scoped before it is worked.
