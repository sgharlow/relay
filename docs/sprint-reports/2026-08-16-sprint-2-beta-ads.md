# Sprint 6 — the instruments that measure the bet

**Branch:** `sprint/2026-08-16-2` · **Iterations:** 5 of 5 · **Date:** 2026-08-16 (UTC)
**Scope:** *"relay repo and focus on getting us live in beta with ads running and testing our
hypothesis."* Relay only — nothing here touches domo-ssrs or report-bridge.

## 1. Backlog source

`.claude/sprint-state.json` → `sprint5.deferred` / `nextTop3` / `debtCreated`, `PROMPTS.md` §6
(Steve's 2026-08-12 scope ruling), `docs/g1-sitting-sheet.md`, and a repo survey across the seven
axes. **Not inferred.**

**The verdict on the scope, stated first because it is the finding that matters.** Sprint 2 already
concluded that *engineering was not the blocker on the ads*, and that is still true — every
upstream item of `g1-launch-checklist.md` is closed and step 8 is Steve's card. The beta is the
same shape: `docs/standby-sprint-plan.md` §"Blockers to a beta cohort" lists five items, all ✅, and
*"none are code"*. Both were re-checked live this sprint rather than read from a document, and both
held.

So the sprint went where the value actually was: **the instruments the flight will be read
through.** Four of the five items are defects in things that measure, or in the guards over them.
None was on any list; four came from the survey. The fifth was a security gap that sprint 5 wrote
down and left open.

## 2. Baseline

| Gate | Start | End | Command |
|---|---|---|---|
| Types | green | green | `npx tsc --noEmit` |
| Lint | green | green | `npm run lint` |
| Build | green | green | `npm run build` |
| Tests | 2443 passed, 1 skipped | **2469 passed, 1 skipped** | `npm test` |
| Schema (2 regions) | green, 25 tables | green, 25 tables | `npm run verify:schema` |
| Roles (2 regions) | green | green | `npm run verify:roles` |
| **IAM wall** | *did not exist* | **green** | `npm run verify:iam` |
| Funnel instrument | *unrun since sprint 5 touched both trackers* | **7/7 live** | `npm run verify:funnel` |
| **Flight pre-flight** | *had no command* | **green, 0 leads** | `npm run flight:snapshot` |

No newly skipped tests. The single skip is the pre-existing paywall test, pinned by
`lib/ops/gates.test.ts`. `verify:live` was not re-run — it needs a running dev server and nothing
this sprint touched a route handler.

### Two things checked before any work, because the sprint depended on them

- **Production is current.** Sprint 5's once-per-session guard is in the deployed bundle —
  `relay.g1.qualified.sent`, `relay.g1.intent.sent` and `relay.g1.channel` all present in the live
  chunks, read from `relaystandby.com`, not inferred from the merge.
- **The G1 instrument survived sprint 5.** `PROJECT.yaml` `market.g1_instrument_verified` says
  *"re-probe if the instrument is touched — a 200 response proves nothing about attribution"*, and
  sprint 5 touched both trackers (I4, I5). It had not been re-probed. It passes 7/7, with both
  events agreeing on `src`.

---

## 3. Shipped

### I1 · correctness · `b40fb0c` — the ad prompts cited warm hexes and described a dark page

The 2026-08-15 Warm Archive migration swapped the **hexes** in `docs/ad-assets/PROMPTS.md` and left
the **English**. Five prompt blocks shipped reading, verbatim, *"on a deep near-black slate surface
(#f7f4ee)"* — a near-white hex introduced by the words *near-black slate* — beside *"a dark, moody
still-life render"*, *"a refined dark-mode data visualisation"*, *"an empty dark slate field"*,
*"generous dark margin"* and *"the tiles are dark slate"*.

An image model reads the sentence, not the hex. Every one of those would have produced a dark plate
for a warm, **light** landing page: the exact mismatch `ratified.d5` was decided to end. It is also
why D6 sat in the deferred queue described as *"NOW fully unblocked — D5 ruled, prompts correct"*.

`lib/ops/ad-copy.test.ts` passed the whole time because it had been proven by planting a wrong
**hex** — the half that was already right.

| Criterion | Met by |
|---|---|
| AC1 no prompt describes a light hex in dark words | sentence-scoped check over the fenced blocks |
| AC2 the authority file's colour row is correct | `g1-ad-creatives.md` read *"Amber on near-black, matched to the landing page"* — the opposite of the page it claims to match |
| AC3 fails on the text that shipped | 3 failed / 27 passed before the fix, naming all seven passages |
| AC4 nothing weakened | the hex assertions are untouched and still pass |

**Proven by:** three new assertions, each failing against the real tree before the fix. The dark
-ground rule deliberately still passes *"a faint darker grid … in the background"* — a darker
element **on** paper is correct; what fails is dark qualifying the ground.

### I2 · correctness · `e3138e9` — beta traffic would have biased the gate toward killing the product

`PROMPTS.md` §6 wrote both the finding and the remedy and left the remedy unbuilt, on the grounds
that no beta campaign existed:

> "If a beta or founding-family campaign is ever revived, this becomes a pre-flight blocker again:
> every tagged non-excluded `src` counts toward N … the ratio would be biased **down** — toward a
> false KILL on the gate that decides the product. A Vercel Analytics event cannot be deleted, so
> the exclusion has to exist **before** the first such ad, not after."

This sprint's scope is that condition, in the user's own words. `isGateQualifyingSrc` is a
deny-list, so anything tagged and unlisted counts. The asymmetry is what makes it a rule rather
than a note: a beta recruit is offered the **free** plan, so they land in the denominator and can
never appear in the priced numerator.

A **prefix**, not a list — a list works only if whoever composes the next beta link guesses the
string this file guessed first. Anchored at the start, so `reddit-ads-beta` and `betamax-forum`
both still qualify; that is asserted, because a substring rule would silently drop bought traffic.

**Proven by:** the exclusion test fails against the old resolver. Written into
`docs/first-invitations.md`, where such a link is actually composed, and into the N-counting table
in `g1-flight-log.md`, which is where the verdict is written from.

⚠️ **Preventive, and the report says so plainly:** no beta-tagged link exists today and the claim
flow does not touch this funnel. It is here because the cost of adding it *after* the first such
link is a permanently wrong reading.

### I3 · wiring · `94c80b6` — the free-plan cap is a live contract restated eleven times

`TIER_LIMITS.free.items` is what the product enforces — `assertWithinItemCap` refuses the import
and tells the visitor *"The free plan holds N items"*. That number is hand-copied into six places
in `g1-ad-creatives.md`, four in `PROMPTS.md` §3 and into `SECONDARY_CTA_LABEL`, the landing page
the ads point at. Nothing tied any of them to it.

Both documents already knew, and both answered with a convention. `PROMPTS.md` §3: *"verify three
things against the source and not against this file — `TIER_LIMITS.free` … **both have moved
before**."* Recipients moved 1 → 4 once already.

**Proven by:** planting the change at its **source** — `free.items: 15` in `entitlements.ts` alone
fails both new tests and names all twelve restatements, including the three written as the word
*"ten"*. Reverted; the commit touches two files and `entitlements.ts` is not one of them.

Two exclusions, both named in the file rather than dodged with a looser regex: the §1b overflow
audit (records of **rejected** drafts, whose numbers must not be edited), and M3's *"the 8 accounts
a family would need first"*, which is a seed-size suggestion and is the reason this cannot simply
assert that every number beside "accounts" is the cap.

### I4 · completeness · `d0e98e9` — the pre-flight line that had no command, and the daily read

`docs/g1-sitting-sheet.md` lists three things to run before the card comes out. Two were commands.
The third — *"live `caregiver_leads` count · **0 rows** — the flight starts from zero or N is
contaminated from day one"* — was a sentence, so the person satisfying it had to hand-write a query
against production mid-sitting. The same sheet then asks for a daily snapshot for four weeks.

Neither number is side material. The read is ratified **directional**
(`ratified.g1-flight-power`), so a ship-or-kill call on the ratio alone is not permitted for this
flight, and verdict lines 3 and 4 — the count of contactable humans and **their notes, quoted** —
are expected to carry the decision. Both come from `caregiver_leads` and nowhere else.

`npm run flight:snapshot` prints the row ready to paste, quotes the notes, flags any lead whose
notification leg failed, and **exits 1** when the table is not empty before the window opens. It
learns whether the window is open by reading the flight log's own `Window start` row rather than
holding a second copy of that fact; an unparseable row reads as *not started*, the direction that
costs a false alarm rather than a silent pass.

It deliberately does **not** print N. Vercel Analytics is read in the dashboard, and a second path
to the denominator would be a second definition of the number the gate turns on.

**Read-only twice over:** only `SELECT`s, and it connects as `relay_dev`, for which
`caregiver_leads` is the one product table with `SELECT` and nothing else. A stray write is refused
by the database, not by the author having been careful.

**Proven by:** 9 unit tests with planted counts (including that it never fails once the window is
open — a daily check that goes red the moment a lead lands is switched off in week one); a live run
against production, exit 0, 0 rows, which satisfies the sitting sheet's line 3 today; and the
refusal path proven by planting a synthetic row **in the real script** and watching it exit 1, then
restoring and re-running green. A live run against an empty table passes whether the check works or
not.

### I5 · security · `a744914` — the IAM half of the wall was watched by nothing

Sprint 5 recorded this and left it: *"the IAM half is not automated — re-adding
`dsql:DbConnectAdmin` would go unnoticed by `verify:roles`."*

`verify:roles` re-measures what a role may do **once connected**. It structurally cannot see the
half that decides something prior and stronger: whether the production principal can obtain an
admin connection at all. `dsqlIdentity()` returns `admin` whenever `DSQL_ROLE` is unset, so while
the policy grants `dsql:DbConnectAdmin` the wall is one environment variable deep. One
`aws iam create-policy-version` restores it — in no diff, no test run, no build — and the
application keeps working, which is exactly why nobody would notice.

`npm run verify:iam` refuses **three** routes back, because a check matching only the first would
be the fourth check in this repo to pass on the defect it was written for:

| Route back | Caught by |
|---|---|
| the literal action re-added to the managed policy | exact match on the **default** version |
| a wildcard — `dsql:*`, `*` — conferring it without naming it | prefix matching, not equality |
| an **inline** user policy | `ListUserPolicies`, a different API call entirely |

`NotAction` is handled for the same reason and matching is case-insensitive because IAM is. It also
asserts the **positive** half: a policy stripped to nothing grants no admin and takes the site
down, and a wall check happiest when the product is broken is measuring the wrong thing.

**Proven in both directions against real AWS data, with no IAM mutation.** Policy v1 is retained as
the documented rollback and still carries the grant, so pointing the reader at it is a live
negative control that changes nothing: exit 1, naming the statement. The live default v2 reads
clean, exit 0. Nine unit tests carry the shapes, with v2 and v1 as verbatim fixtures.

Read-only throughout — five IAM read calls, no writes.

**Also corrected, and found while writing it:** `CLAUDE.md` said *"Production is still on the admin
path … Vercel moves to `relay_app` as a separate, explicit step"* while its own `verify:roles`
section 110 lines below said the cutover was done. One file, two answers, about which identity the
live site holds.

---

## 4. Blocked

### BLOCKED: step-8 · Launch the paid lanes
Category: **human-send by design** (co-pilot contract) · Owner: **steve**
Goal: Reddit lane 1 submitted so the first ad is approved and serving by ~2026-08-28.
Stopped at: card entry and submit are Steve-only. Parked by Steve on 2026-08-15 to 2026-08-16 —
**that date is today, and the park has expired.**
Attempt 1: re-verified every engineering precondition rather than re-reporting the old status —
destination 200, instrument 7/7 live, `caregiver_leads` 0, copy pinned, `src` values qualifying.
All hold.
Attempt 2: closed the two defects that would have degraded the sitting itself — the sitting sheet's
line 3 is now a command (I4), and the creative palette contradiction is fixed (I1).
**Need from you:** the ~45-minute sitting. `docs/g1-sitting-sheet.md`, 13 screens, pure
transcription.
Est. unblock cost: 45 minutes. Downstream impact: the entire G1 gate; the slack absorbs exactly one
rejection cycle.
Partial work: nothing left behind — all preparation is committed.

### BLOCKED: LEAD-WRITE · the demand-capture INSERT has never run under the production role
Category: **decision needed (a write to production data)** · Owner: **steve**
Goal: prove that a real lead submission succeeds now that production connects as `relay_app`.
Stopped at: `verify:roles` confirms `relay_app` **holds** `INSERT` on `caregiver_leads` in both
regions, and `verify:live` ran under `relay_dev`, which by construction **cannot** exercise that one
write. So the grant is verified and the path is not. The only proof writes a row, and the D1 ruling
(2026-08-15) reserves non-product database writes to Steve — so **Claude can create the row and
cannot delete it.**
Attempt 1: looked for a non-contaminating proof. The honeypot and too-fast paths return 200 without
writing, and an invalid address 400s before the write — none of them exercises the INSERT.
Attempt 2: built `flight:snapshot` (I4), which now makes any such row visible, attributed and
loudly reported, and would exit 1 on it before the flight.
**Need from you:** either a one-line authorisation to submit one lead through the live form and
delete the row afterwards, or do it during the sitting — it is two minutes at the top of the sheet.
Est. unblock cost: 2 minutes. Downstream impact: verdict line 3 is *the count of contactable
humans*, and the ratified read expects lines 3 and 4 to carry the decision.
Partial work: nothing written; residual risk assessed as **low** (catalog grant verified in both
regions, app observed serving as `relay_app`) but not zero, and not proven.

---

## 5. Deferred queue, ready to seed the next run

| id | Item | Score | Note |
|---|---|---|---|
| D6 | Generate the 7 ad image assets | 4 | **Now genuinely unblocked** — the prompts were wrong until I1, which is why the last two sprints' "fully unblocked" was not true. Needs Gemini; blocks only the Meta lane, which is day 3+ and only if Reddit under-delivers |
| ALLOWLIST | Make N an allow-list of declared paid lanes rather than a deny-list | 7.5 | **Steve's call — it changes the gate's definition, so it was deliberately not taken.** I2 closed the beta case as pre-committed. The general case remains: any tagged `src` nobody foresaw still counts. An allow-list fails loudly (a new lane reads zero, which you notice); the deny-list fails silently and toward the kill |
| PLACEMENTS | Automatic placements without a 9:16 asset | — | `PROMPTS.md` §6 open item 3. Supply the vertical crop or restrict to Feed. Steve's |
| J9-5-7 | reversal receipt, re-arm confirmation, thank-you | 3 | Deferred a **third** time. Sprint 5 said "do not carry it a third time" — drop it or build it after the flight |
| DMARC-RUA | the one DNS change worth making | — | Steve's; unchanged |
| scrollable-regions-css | raw CSS and `overflow-y` still need the rendered audit | 2 | unchanged |
| email_send_attempts | retention — one row per outbound message forever | 2 | unchanged |

## 6. Debt created

| Debt | Follow-up |
|---|---|
| `verify:iam` is not in CI — CI holds no AWS credentials, the same reason `verify:schema`, `verify:roles` and `verify:live` are not. It is a command a person runs. | Add it to the pre-release list beside `verify:roles`; a scheduled runner is the real answer and needs a credential decision |
| The `amber`/`ochre` word drift in three prompt blocks was fixed but deliberately **not** pinned. A model given `warm amber (#b4703a)` renders `#b4703a`, so it is an inconsistency rather than a contradiction — but it is the same class this sprint just fixed | Pin it if it recurs |
| `flight:snapshot` prints the lead half of the row and leaves the analytics cells to the dashboard, on purpose. The daily obligation is therefore still partly manual | Only worth automating if a Vercel Analytics read can be made authoritative; a second path to N is worse than a manual one |
| `@aws-sdk/client-iam` added as a devDependency for one script | None — it is the same SDK family already present, and the alternative was shelling out to a CLI that needs a Norton CA-bundle workaround on this machine |

## 7. Recommended top 3 for the next sprint

1. **Do the sitting.** It is the only thing standing between this product and its first real
   measurement, the park on it expired today, and every engineering precondition was re-verified
   live this morning. Ten days to the submit-by.
2. **Settle the allow-list question before traffic exists.** I2 closed the case that was
   pre-committed; the general one — any unforeseen tagged `src` counting toward N — is a
   definition change and therefore Steve's. It costs nothing today and is unrecoverable later,
   which is the same argument that made I2 worth taking.
3. **Prove the lead INSERT, at the top of the sitting.** Two minutes, and it closes the last
   unproven link in the path that produces verdict lines 3 and 4.
