# Sprint 11 — promises the database kept and the product did not

**Branch:** `sprint/2026-08-17-5` · **Iterations:** 3 of 5 · **Date:** 2026-08-17 (UTC)
**Scope:** next most critical items.
**Stopped at 3 because the material queue was exhausted**, not because the cap was hit — see §7.

> ## ⚠️ THIS BRANCH IS STACKED ON UNMERGED WORK
> It branches from `feat/secret-types-phase-0`, not from `master`, so it contains that work too.
> **That was deliberate:** `master` is known to carry two live defects which that branch fixes
> (recipients shown raw JSON, imported TOTP seeds discarded), and surveying `master` would have been
> surveying a tree already known to be wrong. The cost is that reviewing this means reviewing both.
> If Phase 0 is rejected, these three commits still apply cleanly — they touch different files.

## 1. Backlog source

**`.claude/sprint-state.json` → `sprint10.deferred`**, a real source of truth, **supplemented by a
fresh survey** and marked as such. The reason for supplementing: every item in that queue is either
owned by Steve (needs a migration) or scores 2. None of them is "most critical" by any reading.

## 2. Baseline

| | Start | End |
|---|---|---|
| `npm run gate` (types + lint + test + build) | **exit 0** | **exit 0** |
| `npm test` | 2592 passed, 1 skipped | **2610 passed, 1 skipped** |
| `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities |

No newly skipped tests. The single skip is the pre-existing beta-paywall case, owned and dated.
Re-derive the current count with the command in `PROJECT.yaml` → `derived.test_count`; the numbers
above are a measurement taken at the time, not a live figure.

## 3. Shipped

### I1 · wiring · `2b95d9c` — the consent record was written and read by nothing

Found by sweeping **every table** for read/write asymmetry. `consent_artifacts` has existed since
migration 009: `recordConsent` inserts a row and links it via `delegations.consent_artifact_id`, and
**nothing anywhere ever selected it back**. Writes 1, reads 0 — the only table in the schema with
that shape.

It matters because of what the screen collecting it says:

> *"This is kept as a record. It is what makes handing someone this help legitimate rather than
> simply convenient."*

An owner reads that, chooses *"They signed something on paper"*, types *"signed form in the blue
folder"* — and the product never shows it again. **The promise was kept by the database and broken by
the product.** If anyone later asked how a delegation was authorised, the answer existed and was
unreachable.

- **Acceptance:** the active delegation displays how consent was given and where the record is kept;
  a pending delegation displays nothing.
- **LEFT JOIN, and the test pins it.** A pending delegation has no artifact yet, and an inner join
  would silently drop exactly the rows that screen exists to act on — presenting as *"the helper I
  just invited has vanished"*, which is worse than the bug being fixed.
- **Proves it:** `lib/ops/consent-record-is-readable.test.ts`. **Proven to fail** — removing the join
  fails two of its six checks.

### I2 · journeys · `cc24ee9` — the verifier error state was a dead end

**Hard-priority ladder item 4.** The identical defect was fixed on `/claim` on 2026-08-16 and left
live here, because that sprint was aimed at *"what will the first beta invitee hit"* — and a verifier
is not an invitee.

**It is the more expensive of the two.** A recipient who gives up has failed to open their own
access. A verifier who gives up has failed to answer the question that opens it **for everybody**:
quorum never reaches its threshold, the release never advances, and the family waits on somebody
sitting in front of a screen with nothing to press. They give up *silently*, so it is
indistinguishable from a verifier who chose not to answer.

**Two different failures arrive at that branch and only one had been imagined.** The loader fails on
a bad code or link. The decision submit *also* sets an error — the crueller case, because they have
already made the decision and a network hiccup takes it away with no way to give it again. The
context object tells them apart: present means it survived, so only the error is cleared and they
land back on the decision screen; absent, and the token goes too.

- **Proves it:** `lib/ops/emergency-paths-have-a-way-back.test.ts`, covering **both** surfaces so the
  next one cannot be fixed alone. Restoring the original dead end fails **5 of 8**.
- **One of those five only failed after tightening.** The contact check first matched the *import*,
  so a leftover import line kept it passing on the very defect it was written for.

### I3 · completeness · `e10b0ba` + `ceafdf6` — keep the schema from drifting from the application

The sweep that found I1 was a throwaway script. This is the part worth keeping: every column declared
in the migrations must be named somewhere in `lib/`, `src/` or `scripts/`.

Four are not, and each is now listed with a reason that names what supersedes it:

| Column | Why it is unreferenced |
|---|---|
| `release_state.notified_at` | Superseded by `email_send_attempts` / `email_delivery_events`. Never written. |
| `release_state.first_access_at` | Superseded by `audit_log` — `closure.ts` already derives first/last access from `min(ts)`/`max(ts)`, which is hash-chained and cannot be back-dated |
| `verifier_confirmations.confirmed_at` | Written by its own `DEFAULT now()`. The audit chain carries the same fact, in order |
| `consent_artifacts.recorded_at` | Written by its own `DEFAULT now()`. The screen shows `delegations.granted_at`, which is when the delegation actually became active |

**None is dead weight to delete.** Dropping a column on DSQL is a migration and therefore a sysadmin
act, and three are genuinely populated — the data is real, it is simply never read. They are listed
so nobody re-investigates them.

- **Proven in both directions:** a planted unreferenced column fails the scan; an allow-list entry
  for a column that *is* used fails too, so wiring one up forces its entry to be removed rather than
  left as a stale claim that would mask a later regression on the same column.

## 4. Two failures of my own, recorded

**A check that reported "no findings" while blind.** My dead-end scanner pinned the closing paren to
one indentation level, so it reported a clean sweep on a screen whose error branch sits one level
deeper. It only surfaced because I planted the defect I had just fixed and watched the scanner miss
it. **A clean result from an unproven check is not evidence.** The committed guard now asserts it
parsed a plausible schema before trusting that it found no problems.

**A commit landed on a red gate.** I chained `npm run gate` with `;` instead of `&&`, so a non-zero
exit did not stop the commit. The failure turned out to be a *timeout*, not an assertion — my new
guard reads the whole source tree three times, which added enough wall-clock to push
`recipient-token`'s 100-run property test past its 5-second limit. Memoised in `ceafdf6`; suite run
twice end to end, green both times. The only file in the red commit was the new test, but the rule
exists precisely so nothing lands unverified.

## 5. Checked and found correct — recorded so nobody re-checks them

| Suspected | Reality |
|---|---|
| More dead-end error states | **None.** Sweep of every `.tsx` under `src/app` is clean — after the scanner was fixed and proven against a planted defect |
| Re-analysis overwrites the owner's root-credential override | **No.** `intake-agent.ts` reads `owner_set_root` and preserves it. The pattern is sound |
| The `consent_method` field I added might be dropped in transit | **It survives.** The route spreads the raw row; `ApprovalsClient` passes `body.delegations` straight through |
| The owner's stand-down control is hard to reach in an emergency | **Correctly wired.** Both pending-release emails link to `/triggers`, which is where the control lives |
| a11y is an open critical item (`0/34` per an old note) | **No.** `scripts/a11y-audit.mjs` audits access-mode pages signed out on a phone viewport — the mode CC8 names — and CI gates on serious/critical |
| `verifier_confirmations.confirmed_at` is lost data | **No.** Written by column default on every insert; simply never displayed |

## 6. Blocked

### BLOCKED: IRREPLACEABLE-MANUAL — an owner cannot mark an item irreplaceable
**Category:** change outside this repo (migration) · **Owner:** Steve
**Goal:** let an owner say "this is irreplaceable" so `CUSTODY_RISK` — the highest-consequence gap
type, covering deeds, wills and government IDs — can be raised for items the AI misjudged.
**Stopped at:** doing it correctly needs an `owner_set_irreplaceable` column, mirroring the proven
`owner_set_root` pattern. Setting `irreplaceable` directly instead would be silently overwritten by
the next analysis run — `intake-agent.ts` writes `irreplaceable = $3` unconditionally — which is the
exact bug the override pattern exists to prevent.
**Need from you:** a migration adding the column, or a ruling that the AI's judgement stands alone.
**Est. unblock cost:** 20 minutes plus a migration on both regions.
**Partial work:** none — nothing started, nothing left behind.

## 7. Deferred, with scores

| Item | Score | Note |
|---|---|---|
| `SECOND-FACTOR-MODEL` phase 1 | — | Steve. Migration. Design in `docs/secret-types-design.md` |
| `IRREPLACEABLE-MANUAL` | 8 | Now **blocked**, see §6. Mitigated meanwhile by the re-analysis control |
| `NO-SINGLE-ITEM-CIPHERTEXT-ENDPOINT` | — | Steve, ratified 2026-08-16. Revisit when a real vault needs field-level editing |
| `EMAIL-SEND-ATTEMPTS-RETENTION` | 2 | One row per outbound message forever. Years from mattering |
| `SCROLLABLE-REGIONS-CSS` | 2 | Guard reads utility classes only. Rendered a11y audit passes clean |
| `VERIFY-IAM-IN-CI` | — | Steve. Closing it means a credential in CI |

**Why the sprint stopped at 3.** Everything above is either Steve-owned or scores 2. Three separate
sweeps — dead-end error states, table-level read/write asymmetry, column-level reference — are now
clean or accounted for. Taking a score-2 item to fill the remaining budget would have been padding,
not progress.

## 8. Debt created

None. Two guards were added and one existing test was made less fragile by removing load, not by
relaxing it.

## 9. Recommended top 3

1. **Decide the two stacked branches.** `feat/secret-types-phase-0` fixes two live production defects
   and this branch sits on it. Everything here is blocked behind that one decision.
2. **`IRREPLACEABLE-MANUAL`** (§6) — one migration, and it closes the last owner-override asymmetry:
   an owner can overrule the AI about root credentials but not about what is irreplaceable, which is
   the higher-consequence of the two.
3. **The beta cohort.** Unchanged for five sprints, and the reason is unchanged: the product is
   measurably better than it was this morning and still has nobody in it.
