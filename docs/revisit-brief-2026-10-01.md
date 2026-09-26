# Revisit brief for 2026-10-01 — three rulings, one question each

*Written 2026-09-25 (Steve: "DO: one-page brief for 10-01"). Every fact below was read live on
2026-09-25 evening; re-read the two live probes on the day before ruling. Answer each item in
`PROJECT.yaml` with `revisit_outcome:` / `revisited:` as the entry itself says, or the revisit
guard (`lib/ops/revisit-dates.test.ts`) goes red on 10-02.*

---

## 1. `the-delivery-webhook-monitor-has-gone-mute` — revisit 2026-10-01 (deferred twice: 9-17 → 9-23 → 10-01)

**Live 2026-09-25 22:2x MST — `GET https://relaystandby.com/api/health/delivery-webhook` → 503:**
`everHeard=true, totalEvents=54, lastEventAt=2026-09-14 13:09:42Z (ageSeconds 1008344 ≈ 11.7 days),
ripeSends=4, ripeSendsHeard=4, refusedSends=0, systemicRefusals=0, writerProven=true,
orphanEvents=3, healthy=false`. Unchanged from the 9-17 measurement except the age.

**What it means (the endpoint's own words):** three delivery events arrived for messages with no
send record, so `recordSendAttempt` has stopped writing. It swallows its own failures by design, so
without those rows the check "silently reverts to reporting healthy no matter what happens to the
mail." `refusedSends=0` with `ripeSendsHeard=4` → mail is being delivered. **Instrumentation
outage, not a delivery outage.** The endpoint's remediation text names "a privilege or schema
change on `email_send_attempts`" (migrations 031/032).

**What binds:** the standing rule — do NOT touch `email_send_attempts` grants
(`feedback-relay-heartbeat-mutes-its-own-delivery-switch`). The obvious fix is the prohibited one,
which is why this has been "keep watching" twice. Watching a mute watchdog for a third fortnight
is the failure the register exists to name.

**The one question:** which of these, on 10-01?
- **(a) Diagnose read-only, then rule.** Steve runs the read-only grant/privilege check on
  `email_send_attempts` (no GRANT, no DDL) and records the CAUSE in the entry. Then (b) or (c)
  with a cause on record instead of a guess.
- **(b) Fix under `/safe-execute`.** The grant change goes through the 5-gate: documented problem
  (this entry), snapshot of the current grants, rollback = re-issue the prior grants (< 2 min),
  isolated test on the DSQL scratch path used by the restore drill, explicit Steve approval. The
  prohibition memory says *why* the last touch bit; the gate is the mechanism that answers it.
- **(c) Re-scope in writing.** State what replaces the check (e.g. alert on `orphanEvents` growth
  only; or the monitor reads Resend's own delivery log instead of the local table) and close the
  entry with that. "It went green again" is not an answer.

Recommendation: **(a) first, same day**, because both (b) and (c) are guesses without the cause.

### Diagnosed 2026-09-25, read-only, after this brief was written

Done as relay_ro the same evening: `email_send_attempts` 8 rows (last 2026-09-13 21:54Z); `relay_app`
holds INSERT on it (`has_table_privilege` true; `verify:roles` green in both regions). **The 3 orphans
are the three "[relay] heartbeat: delivery FAILING" mails of 2026-09-14** (12:39, 12:54, 13:09Z; Gmail
thread `1a09fee24b3548db`), each delivery event two seconds after its alert. This is the false-positive
class recorded 2026-09-03: `scripts/heartbeat-local.ts` sends by raw fetch and bypasses
`recordSendAttempt`, so its own mail trips `mute`; and the heartbeat alerts *because* the monitor reads
mute, so it loops. **Not a grants problem, not an instrumentation outage.** The 10-01 question is now
only the boundary fix: **(a)** the heartbeat records its own attempt (the in-app operator alert already
does, `lib/notify/operator-alert.ts:53`), or **(b)** operator-alert mail is excluded from the orphan
count and `attributableToRelay()`'s invariant is corrected. Options (b)/(c) above are withdrawn; the
grants prohibition stands and was never the issue.

### Resolved 2026-09-25 late evening — nothing left for 10-01 on this item

Deeper cause found and fixed the same night (PR #107): the 9-03 fix had never *run* — under bare
Node the alert's ledger import failed with ERR_MODULE_NOT_FOUND (`.heartbeat/task.log`), so every
alert was an orphan. The heartbeat now runs under tsx (pinned by a runtime test), and Steve
approved a 5-gate backfill of the three 9-14 attempt rows (dry-run in a rolled-back transaction
first, then commit). **Live: `/api/health/delivery-webhook` → 200, orphanEvents 0, ripeSends 7/7.**
The register entry is closed; item 1 of this brief is answered.

---

## 2. `ratified.beta-free-release` (E4.2) — revisit "at every /daily-priority from 2026-10-01"; decision_due 2026-11-15

**State:** `TIER_LIMITS.free.canRelease` is still `true`. Ruled EXTEND 2026-09-13
(`ratified.sitting-d2-2026-09-13.e4_2_paywall`): E1-prime (the renewal-failure notice reaching an
owner) is still `wired`, so flipping the paywall now would turn an expired card into a silently
blocked release. The ladder's first real rung was expected ~10-16.

**E4.1 (`releases-may-or-may-not-be-billing-gated`) is already CLOSED 2026-09-13** — KEEP
INITIATE-ONLY, and `/terms` has said so since 8-30. Its `revisit: 2026-10-01` line sits on a closed
entry; if the guard still counts it, record that the outcome is the 9-13 closure.

**The one question:** on 10-01, does EXTEND still stand? It does unless E1-prime has been
live-proven since 9-13 (check `E1-prime` in the register and the ladder's first rung). If not
proven: re-affirm EXTEND, one line, and the cadence re-raises weekly until 11-15 — not a
decision, per the entry's own `cadence_only` note. If proven: the flip is one line + the `/terms`
§2.7 sentence + un-skipping `lib/billing/entitlements.test.ts`, one PR, Steve approves the merge.

---

## 3. `g1-arms-length-demand` (due 2026-12-31; revisit from 10-01) and `g1-caregiver-wtp` (due 2026-10-02, superseded)

**State:** `g1-caregiver-wtp` is `superseded_by: g1-arms-length-demand` (paid-traffic instrument
retired 8-16, never runnable). Its `due: 2026-10-02` passes next week on a gate that no longer
measures anything. `g1-arms-length-demand` needs ONE arms-length person who pays or states in
writing they would pay at a seen price; count today: 0.

**The instrument is the editorial lane, and it has not moved since 8-18.** `docs/g1-editorial-lane.md`
§Sequence: step 1 (outlet research) DONE 8-16/8-18 — **caregiver.com first** (named editor, Word
attachment, 500–1500 words), **The Caregiver Space second** (finished article via web form, "we
don't review pitches"), Next Avenue closed, AARP is a second-round target and **blacklists
AI-generated pitches permanently**. Steps 2–5 (draft angle 3, pitch, declare the `ed-` src,
verify:funnel) are not started. The 12-31 date was derived from "draft ~1 week, pitch ~1 week,
editor 2–4 weeks, publication 2–6 weeks": a draft that starts mid-October still lands inside the
window; one that starts in November does not.

**The one question (two parts):**
- On 10-02, record `g1-caregiver-wtp` as **superseded — outcome tracked on g1-arms-length-demand**
  (no separate outcome; the ratified numbers stay as history). Yes/no.
- Who writes angle 3, and by when? **(a)** Steve drafts by a named date (the AARP rule makes the
  author question a real one for the second round; caregiver.com does not state an AI policy, but
  a byline is a byline); **(b)** Claude drafts a first pass that Steve rewrites in his own voice
  before any submission; **(c)** park the editorial lane and let B2B2C carry G1 — in which case
  the 12-31 date should be re-derived from the B2B2C path, not left standing.

---

### Not on this brief (checked and quiet on 9-25)
- `/api/health/scheduler` 200 (lastRunAt 05:00Z, failures 0) · `/api/health/reminders` 200
  (1 owner examined, 0 unhonoured, 0 blind).
- Admin-key deletion (G4) done 9-25 on evidence — entry closed (PR #102).
- Next dated items after these: `d3-restore-drill` 2026-11-08; cadence revisit 2026-12-13.
