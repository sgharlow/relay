# Sprint 4 — the monitoring was decorative

**Branch:** `sprint/2026-08-15-3` · **Iterations:** 5 of 5 · **Date:** 2026-08-15

Backlog source: `.claude/sprint-state.json` (sprint 3's deferred queue) plus a repo survey
across the seven axes. Not inferred — but the queue that came out of the survey is not the
queue that went in, and that is the story of this sprint.

## What the survey actually found

The deferred queue offered feature work. The survey found something worse and closer to home:
**three separate pieces of monitoring that could not report the failure they were built for**,
and one accessibility measurement that had never been taken at all. Nothing was red. Every
gate was green at the start and every gate is green now — which is precisely the problem this
sprint kept running into.

## Baseline

| Gate | Start | End |
|---|---|---|
| `tsc --noEmit` | green | green |
| `eslint --max-warnings=0` | green | green |
| `next build` | green | green |
| `vitest --run` | 2381 passed, 1 skipped | **2421 passed, 1 skipped** |
| `verify:schema` (both regions) | green (24 tables) | green (25 tables) |
| `a11y-audit.mjs` | 18 pages, owner mode never run | **34 pages, 0 serious/critical** |

No newly skipped tests. The single skip is the pre-existing paywall test, pinned by
`lib/ops/gates.test.ts`.

---

## Shipped

### I1 — Relay's production database was recording another product's mail · `18213e0`

**Axis:** security (personal data) + correctness. **Score 15.**

The Resend account is shared with report-bridge, and a Resend webhook endpoint is configured
per **account**, not per sending domain. Every event for every project on that account POSTed
to `/api/resend/webhook`, and Relay wrote all of them down without asking who sent them.

Measured on production, read-only:

```
113 rows in email_delivery_events
 70 of them report-bridge's, across 8 synthetic*.report-bridge.com domains that do not resolve
 25 Relay's own sends to relay.test (the reserved-TLD defect, now refused at the send seam)
 18 Relay's real recipients — gmail 14, outlook 3, relaystandby 1
```

The newest row in the entire table was another product's.

Two consequences, the first serious: today those addresses are synthetic probes, but the moment
report-bridge mails a real person, that person's address is in Relay's production database with
no relationship to Relay and no basis in Relay's own privacy policy. Second,
`latestDeliveryByEmail` keys on the address alone, so a collision would show a Relay owner a
delivery verdict for a message Relay never sent.

**Acceptance criteria, written first:** an event whose `from` is another domain is not written ·
one on our domain still is, bare or in `Name <addr>` display form · one with no `from` is still
written, because exclusion requires positive evidence · matched on domain so a future
`notifications@` still counts · a test fails before and passes after.

**Proven by:** 12 of the 26 assertions in the new `delivery-events.test.ts` fail against the
previous code. That module had no test file at all. The wiring test is the important one — it
catches the version of this fix where the rule is correct but never handed the field it reads.

### I2 — the mail dead-man's switch had been disarmed since its first event · `50d97a2`

**Axis:** correctness. **Score 7.5.**

`getDeliveryWebhookHealth` decided `healthy` from `count(*) > 0` over an append-only table. Once
the first event landed that was true forever, and 113 rows had landed. **The switch could no
longer fire for any reason.**

Everything above it was real: a public health endpoint, a daily GitHub Actions probe hosted off
Vercel so it could outlive what it watches, a retry so it would not cry wolf, an error message
naming the three things to check. The workflow's own header says *"that endpoint can be deleted
in a dashboard, or its signing secret rotated, and nothing in the application would notice"* —
and that remained exactly true with the monitor running daily.

Its previous header called the real check impossible, because the only send-side record is
`transcript.ts`, which is in-memory and refuses to arm in production since bodies carry live
access codes. Right about transcript, wrong about the conclusion: the switch never needed the
message, only the fact one was accepted. `email_send_attempts` (migration 031) holds Resend's id
and a timestamp — no recipient, no subject, no body, so it is strictly less personal data than
the events table it is compared against.

Three properties keep it quiet enough to survive, each pinned by a test: a quiet week cannot fire
it, one slow message cannot fire it, and it cannot latch.

**Proven by:** a mocked test cannot say whether the SQL correlates, and the SQL was the part most
likely to be wrong. Against production: one ripe send with nothing heard → `healthy: false`;
adding one that *had* been reported → back to true; both proof rows deleted, table back to zero.

**Found on the way:** migration 030's `GRANT … ON ALL TABLES` resolves once, so 031 locked
`relay_dev` out of the table it had just created — and every future migration would have done the
same, silently, at runtime. Migration 032 fixes the cause with `ALTER DEFAULT PRIVILEGES`
(verified supported on DSQL before being relied on). `verify:schema` now also probes readability,
because that rule binds to the creating role; planting a `REVOKE` fails it in both regions.

`notifications.test.ts` caught this change, correctly — it asserted no INSERT happened at all as
a proxy for its stated property, *no write to recipient code storage*. Rewritten as the property
itself, in two halves each stronger than the proxy.

### I3 — a button that fetches a route nothing serves · `a9a5717`

**Axis:** wiring. **Score 4.**

`api-reachability.ts` covers handlers with no caller. Nothing covered the other direction: a UI
control fetching a path no `route.ts` serves. Component tests mock `fetch`; route tests import
handlers directly; `tsc` has no opinion about the inside of a string. Both layers that could
catch it sit on the wrong side of the gap, and it surfaces as a 404 when somebody presses the
button.

The tree is clean — 63 fetch sites, 75 routes, all resolving — and that is the bar. A check
introduced alongside its own defect proves only that the author could write both.

**🔴 It was wrong twice on the way, and only the tree showed it.** First it flagged
`LimitsNotice.tsx`, whose fetch appends an optional query string inside an interpolation
containing a *nested* template literal; a lazy `${...}` match stopped at the first brace and
invented a missing route. The obvious repair — any segment containing a wildcard matches — made
the check **worse than useless**: `/api/access/acknowledgement` then matched
`/api/access/acknowledge`, and a real typo planted in that component passed green. Three checks
in this repo have already passed on the exact defect they were written for; this would have been
the fourth. Both cases are now in the file.

### I4 — owner mode had never been audited, and was hiding a keyboard trap · `c102c6f`

**Axis:** UI experience. **Score 3, promoted:** it was the only known *measurement* gap.

CI runs the signed-out 18 pages because GitHub Actions holds no database credentials. The owner
half needs a session, so it had never been run. Run properly with a disposable owner created
through the ordinary signup API and closed afterwards.

One serious violation: `/audit` at 390px, a horizontally scrolling table wrapper that could not
be focused — a keyboard user could see the right-hand columns and never reach them (WCAG 2.1.1).
The same page at 1280px is clean. An earlier fix had swapped `overflow-hidden` for
`overflow-x-auto` on that wrapper precisely so a phone could reach those columns by swiping: it
fixed the pointer case and created the keyboard one.

**axe could only ever see one of five.** That rule fires only on a region actually scrolling, so
whether it is caught depends on column count, viewport width and how much data the audited
account holds. `/import`'s preview and `/circle`'s roster are the same shape and passed only
because a disposable account holds almost nothing. So the convention became
`lib/ops/scrollable-regions.test.ts`, which reads markup rather than a rendered page — and it
immediately found a fifth no sweep could have: the `/how-it-works` comparison table is
`hidden md:block` with `min-w-[720px]`, so it scrolls between 768px and ~800px, in the band
between the two viewports the audit uses.

The convention existed and was forgotten, which is the argument for a check rather than a note:
`/demo` has carried `tabIndex`/`role`/`aria-label` since the 2026-08-13 sweep, with a comment
naming this exact rule, and the three tables written after it were written without.

`/demo`'s SQL box is fixed the other way — it wraps at its spaces, so the scroll class never
engaged; making it focusable would have added five empty tab stops to a page meant to be read
straight through. **The best fix for a scrollable region is often not to have one.**

**Proven by:** re-audited against the rebuilt product — 0 serious/critical across 34 pages.

### I5 — the switch I just rebuilt could be disarmed the same way · `a5e567f`

**Axis:** correctness. Self-audit of I2.

Everything in the new switch rests on `email_send_attempts` having rows. `recordSendAttempt`
swallows its own failures on purpose — telemetry must never be able to fail a send — so if it
stops writing, `ripeSends` falls to zero, that reads as a quiet week, and the check returns to
answering healthy forever. **The same defect, one layer down.** And not hypothetical: a
privilege change is exactly what already locked the application out of that table once.

Detectable exactly, because since I1 every event we store is about a message we sent, so an
event whose `provider_id` matches no attempt row is one the recorder missed. Bounded to events
at or after the first attempt — unbounded, deploying it would alarm on day one about mail sent
perfectly well, and an alarm that is wrong the first time it speaks is one nobody believes the
second time.

**Proven by:** live on production in isolation — `ripe=0`, the exact state that used to read as
a quiet week, with `orphans=2` correctly returning `healthy: false`. Cleaned up and restored.

---

## Blocked — all of it is in Steve's court

### BLOCKED: FOREIGN-ROWS · 70 rows of another product's recipient data on production

- **Category:** decision needed (destructive write)
- **Goal:** remove personal data Relay was never entitled to store
- **Stopped at:** the D1 ruling — only Steve, acting as sysadmin, writes to the database outside
  the product's own APIs. A `DELETE` is destructive and reversible only from backup.
- **Attempt 1:** fixed the cause instead — the boundary now refuses foreign events, so the count
  stops growing. Verified: no new foreign row can be written.
- **Attempt 2:** confirmed there is no live collision — every foreign address is on a
  `synthetic*.report-bridge.com` domain, none of which is in any Relay circle.
- **Need from you:** one word. The statement is
  `DELETE FROM email_delivery_events WHERE email LIKE '%@synthetic%.report-bridge.com'`
  (70 rows, all `.report-bridge.com`, none Relay's). A recovery point exists
  (`cba21459-8dcf-4cd5-b4ff-3aca1aea3113`).
- **Est. unblock cost:** 2 minutes
- **Downstream:** `totalEvents` and `lastEventAt` on the health endpoint keep describing another
  product's traffic until this is done. Nothing else depends on it.

### BLOCKED: DEPLOY · every fix in this sprint is inert until the branch ships

- **Category:** decision needed
- **Stopped at:** production is on `master` @ `ff696dc`. The webhook boundary, the rebuilt
  switch and the a11y fixes are all on `sprint/2026-08-15-3`.
- **Need from you:** merge and deploy, or say when. **Foreign events keep arriving until then**,
  and the daily monitor keeps passing on a condition that cannot fail.
- **Est. unblock cost:** ~10 minutes plus `/pre-deploy-check`

### BLOCKED: REPORT-BRIDGE PROBES · a live reputation drain on the shared Resend account

- **Category:** change outside this repo
- **Stopped at:** report-bridge's synthetic monitor mails
  `synth-probe-…@synthetic.report-bridge.com`, which is **NXDOMAIN**. Every probe is a
  guaranteed hard bounce on the account Relay's mail shares, and it is still running — the most
  recent was 2026-08-15T19:43. It generates a new nonexistent subdomain per run.
- **Need from you:** direction. This is the strongest surviving explanation for Relay's Outlook
  junk-filing, and it is not fixable from this repo.

### Carried, unchanged

- **DMARC `rua=`** — the one DNS change worth making; `dmarc@relaystandby.com` requires a
  Cloudflare forward, and forwarding is what breaks it against Google's `p=reject`.
- **Ad sitting** — parked by Steve to 2026-08-16; `docs/g1-sitting-sheet.md` ready; submit-by
  ~2026-08-26.
- **P3/P4 least-privilege** — Vercel cutover to `relay_app`, then strip `DbConnectAdmin`.
  Rollback is one env var. `verify:live` under `relay_dev` is the recommended gate first.
- **`.relay-dev-key.json`** → 1Password, then delete.

---

## Debt created

| Item | Follow-up |
|---|---|
| `email_send_attempts` grows one row per outbound message, forever | Low volume by design. Revisit as retention, not correctness, if sending ever becomes routine. |
| `scrollable-regions.test.ts` reads utility classes only | Scroll introduced from raw CSS, and `overflow-y-auto`, are still only visible to the rendered audit. Stated in the file. |
| `verify:schema` probes SELECT, not INSERT | A grant that allows reads and refuses writes would still pass. Not seen; worth knowing. |

## Recommended top 3 for the next sprint

1. **Deploy this branch, then watch the endpoint go from `writerProven: false` to `true`.** That
   transition is the proof the whole of I2 and I5 rests on, and it cannot be observed anywhere
   else. Until it happens, the switch is correct and untested in the only environment that counts.
2. **`npm run verify:live` under `relay_dev`, then P3.** It is the named gate before the Vercel
   cutover and it has not been run since the privilege split.
3. **J9 steps 5–7** — reversal receipt, re-arm confirmation, thank-you-the-recipient. The only
   remaining gap in the journey the product calls its differentiator. Deliberately *not* taken
   this sprint: the demand gate is unmet, and every hour here bought monitoring that works
   instead of a feature nobody has asked for yet.

**And the thing no sprint changes.** `wtp_evidence: none`, `demand_signal: none`, invitations
sent zero. Five iterations made the product's telemetry honest. None of it is demand.
