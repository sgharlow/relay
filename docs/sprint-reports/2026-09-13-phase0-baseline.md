# Phase-0 claim-conversion — instrument proof and baseline (2026-09-13)

**What this is.** Gap plan G2.4 asks for `scripts/phase0-report.ts` run against the pre-registered ~50 % claim-conversion floor once Sprint 2's cohort sends have gone out. The sends have not gone out (Sprint 2 opens 2026-09-17). This file proves the instrument runs and records the baseline it printed **before** any cohort send, so the post-send report has a zero to be measured against rather than a memory of one.

**Run.** `npx tsx --env-file=.env.local scripts/phase0-report.ts` — read-only (no INSERT/UPDATE/DELETE in the script; verified by grep), 2026-09-13.

| channel | issued | opened | claimed | stepped down | open % | claim % | of-opened % |
|---|---|---|---|---|---|---|---|
| owner | 2 | 0 | 0 | 0 | 0 % | 0 % | — |
| **total** | **2** | **0** | **0** | **0** | **0 %** | **0 %** | — |

The two issued codes are the real circle's (Sitting A, 2026-09-10 — one recipient, one verifier, both on the owner arm). Neither has been opened. That is not a demand reading; it is the state before the ask has been made in person.

**What the threshold means, restated from the sprint plan so it cannot move after the result:** below roughly 50 % the fallback path carries more traffic than the primary one, the surface and distribution arguments collapse, and the ranking swings back toward durable artifacts. Decide against that line, not against whatever the next run prints. And N matters: twenty invitations is a directional read, not a decisive one.

**Re-run** after A3.4's owner-arm sends and again at the end of the quiet window; the post-send report replaces this file's role, not its record. Names never appear here: the roster is gitignored and holds real people.
