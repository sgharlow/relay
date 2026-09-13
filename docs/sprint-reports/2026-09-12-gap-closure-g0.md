# Sprint report — Gap-closure G0, "the record and the nods" (2026-09-12 → 09-13)

**Source of the sprint:** `docs/gap-closure-plan-2026-09-12.md` §4 G0 (revision 2, after the same-day adversarial QA). **Claude's lane is complete; Steve's is open.** Branches `ops/g0-*`, master @ the merge of PR #79.

## What ran, with its proof

| Row | What | PR | Proof (run, not quoted) |
|---|---|---|---|
| G0.1 / G0.9 / G0.14 | Register: `nothing-turns-red-when-a-revisit-lapses` gains `closed:`; the ladder entry's `ends_when` names the command instead of a dead date; B10 re-scoped to Claude with the Trash residue; three rulings and one closed record entered | #75 | new rule in `lib/ops/project-yaml-parses.test.ts` **red on the base register naming exactly one entry, then green**; one-liner 70/26 → 74/28 |
| G0.3 | ROADMAP, `CLAUDE.md`, `scripts/verify-stripe.ts`: twelve places that still asked for done work struck in place; §4 gains the three 2026-09-17 obligations; a numbering banner above Sprint 4 | #76 | `roadmap-court` + `g-lane-names` 15/15; `tsc`, eslint clean |
| G0.4 / G0.5 / G0.6 / G0.14 | Six docs banner-ed; the J6 note amended in five places; Property 17 tagged; `.claude/sprint-state.json` re-pointed with `iterationsRemaining`; the rulings pack re-derived; the G11 options brief; the plan itself enters the repo | #77 | `journey-state` + `csv-parser` + `roadmap-court` 30/30; `grep -c "Property 17"` = 1 |
| G0.8 | `lib/ops/canary.ts` probes `/api/health/scheduler` and `/api/health/reminders`; B12 widened | #78 | live `node scripts/canary.ts` **8/8** 2026-09-13T06:58Z; planted wrong-prefix run **red naming both** new checks; unit 10/10 |
| G0.7 | Six estate artefacts: banners **already present** (B39, Sprint 0 row 0.7) | — | `head -2` on each |
| reassess | ROADMAP revision 9 header; beta-ready cells R2/R7/R8; Sprint 2/3 pointers (owner-write block, quiet window) | #79 | `roadmap-court` + `g-lane-names` 9/9 |
| close-out | this report; the plan's G0 rows marked; `the-sprint-skill-resolves-a-spent-lane` closed; sprint-state rows appended | #80 | one-liner **74 / 27** |

## Two things the plan did not schedule, found while executing it

1. **Two stale disposable owners on production.** The 09-10 step-up walk (the attempt that hit the wedged `next dev`) left `relay-stepup-e2e-1789060836609@relay.test` and `…854390@relay.test` behind — 61 h old, zero rows, not held. `npm run verify:orphans` was red; the orphan monitor had gone red at 2026-09-12 13:43Z. **Closed via `deleteAccount()`** (the path the census prints; zero rows each), census clean at 06:44Z, monitor re-dispatched → success 06:46Z. Rev-8 row 1.5's "orphans clean" was true at 17:25Z on 09-10 and false by the next morning; the rule *"`verify:orphans` after every walk day"* is the fix and it was not applied that day.
2. **That alarm was in Gmail Trash, already read.** The read-only connector query `from:notifications@github.com subject:relay in:trash newer_than:14d` showed the two newest relay alarms (Orphan monitor 09-12, Cadence watch 09-11/09-12) in Trash, labelled, starred, important, **read**; Vercel bot PR comments in Trash **unread** within hours. That is B10's failure mode observed live: an unattended alarm nobody saw until a person searched Trash. Recorded on `the-alarm-of-record-delivers-to-trash.re_scoped_2026_09_12`; the mechanism is still unnamed (no Gmail filter deletes).

## What G0 leaves in Steve's court (unchanged from the plan, now the only thing between here and G1)

| # | Item | Where |
|---|---|---|
| 1 | **The ladder-window ruling** — accept the natural date (recommended) or shorten the interval to 14 d for the proof; **before the first owner write of Sprint 2**; revisit **2026-09-17** | `deferred.the-ladder-cannot-be-proven-while-the-owner-is-active` |
| 2 | Nod: reclassify F-p → task 5.4 (audit labels), with a neutral label for the retired estate action | plan §6 row 1 |
| 3 | Nod: B27 validity checks + Dependabot security updates | plan §6 row 2 |
| 4 | Nods: close `web-analytics-collects-but-cannot-be-read` with clause 3 answered; `ends_when` on `verify-live-cannot-enter-ci`; "that property is B15.6" | plan §6 row 3 |
| 5 | Then Sprint 2 as revision 8 wrote it, with every owner write inside the week and Sitting D-2's twenty rulings | `docs/rulings-pack-sitting-d.md`, bottom section |

## Numbers, derived at close-out (2026-09-13)

- Register: `74 total, 27 open` (the `yaml` one-liner). Open = 26 at the start − R2 − R9 + the three new rulings.
- `verify:orphans`: 0 reserved-domain accounts.
- `check:ladder`: rungs ever sent 0; live owner 2026-10-03 15:36Z / 2026-10-08 03:36Z **until the next owner write**.
- `.heartbeat/runs.jsonl`: the next `ok` after PR #78 merged is the first fifteen-minute run that probes the dead-men — read the tail, do not assume.

## Stop-rule reading

Pre-registered minimum: 3 rows closed per sprint. G0 closed **R2, R3 (strike), R5, R6, R7, R8, R9, R10, R11–R13, D1, D4 (verified), D13** — well above the floor. G1's number is set by Steve's calendar, not Claude's.
