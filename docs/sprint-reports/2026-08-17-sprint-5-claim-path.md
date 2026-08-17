# Sprint 9 — the path the first beta invitees will actually walk

**Branch:** `sprint/2026-08-17-3` · **Iterations:** 3 of 5 · **Date:** 2026-08-17 (UTC)
**Scope:** next prioritised sprint tasks. **Stopped at 3 because the material queue was exhausted**,
not because the cap was hit — see §5.

## 1. Backlog source

**Inferred**, and deliberately so. `.claude/sprint-state.json` and the prior deferred lists were
written for a paid-ads world retired two days ago, and every item in Steve's court is blocked on
input he has deferred. The queue came from a fresh survey across the seven axes, aimed at one
question: **beta invitations are built and queued to go out — what will the first real invitees
hit?**

That aim paid: all three defects sit on the claim path, and none was on any list.

## 2. Baseline

| | Start | End |
|---|---|---|
| `npm run gate` (types + lint + test + build) | **exit 0** | **exit 0** |
| Tests | 2507 passed, 1 skipped | **2513 passed, 1 skipped** |
| `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities |

No newly skipped tests. The single skip is the pre-existing beta-paywall case, owned and dated.

## 3. Shipped

### I1 · correctness · `53ec678` — the claim page pointed invitees at an email never sent

`/claim` said, three lines apart: *"Type the code they gave you — they may have read it out, texted
it, or written it down"* … `<label>Code from your email</label>`.

The paragraph is right; the label contradicted it, and was wrong for the arm the product
**defaults** to. `BETA_INVITE_CHANNEL='owner'`, and `first-invitations.md` says it plainly: *"the
owner-delivered arm sends no email at all."* Someone told their code by phone reads that label,
concludes they missed a message, and stops.

**Not a global find-and-replace, and that is the point.** The same string is on `/access` and
`/verify`, where it is **correct** — those codes really are emailed under adaptive minting.
Replacing all three would have made two accurate surfaces inaccurate. The test asserts that too: it
requires those two to *keep* their email wording.

**Proven by:** `lib/ops/claim-copy.test.ts` fails on the original wording. The guard strips comments
first — not a loophole, but because the comment beside the fix has to quote the wrong wording to
explain it, and the test caught exactly that on its first run. Re-planting the real defect afterwards
still fails it.

### I2 · journeys · `d44cac6` — the claim error state was a dead end

**Hard-priority ladder item 4**, which is why it jumped a higher-scored copy item.

Mistype one character of a code shaped like `4KMPQ-7XR2W` and you got a message, no retry control,
no link out, and the browser back button — which you had to think of. People give up, and they do it
**silently**: an abandoner sends no signal, so the failure is indistinguishable from nobody wanting
it.

- **"Try the code again"** clears the token; `if (!token)` is evaluated above the error branch, so
  the form returns
- *"couldn't open that link"* → *"that invitation"* — the emailed link is deliberately bare, so most
  people arriving here typed a code and never used a link
- *"or ask us."* was prose with nothing to click; now a real `mailto:` to the address in
  `lib/contact.ts`

**Proven in a browser, not by string-matching.** Reached the error state via `?token=`, saw the new
heading, button and live mailto, clicked the retry, and confirmed the code form returned with an
empty field and a working Continue.

### I3 · correctness · `c6be204` — Phase 0 counted people who stepped down as claims

`count(claimed_at)` alone overstates the number this report exists to produce. Stepping down nulls
`claimed_user_id` on the **person** row but deliberately leaves the invitation untouched — *"DEGRADE,
NEVER DELETE"* — so `claimed_at` stays set and the resigner kept counting.

The error runs in the **optimistic** direction, which is the dangerous one: the threshold is a
floor, and an inflated numerator hides a breach of it. It matters past the funnel too — principle 1
is conditional on claim conversion and adaptive minting assumes verifiers reach `confirmed`; both
need people who are *still there*.

**Fixed while N is still 0, deliberately.** Nothing records the moment a claim was undone, so once
real data exists the two populations cannot be separated retroactively.

**Proven two ways, because no real resigner exists to observe:** the query runs clean against
production, proving the three-table join and every column name against the real schema; and the
`FILTER` predicate was exercised read-only against synthetic rows — it counts *"claimed then stepped
down"* (1) and ignores *"claimed and still bound"*, *"never claimed"* and *"unbound but never
claimed"* (0 each). That last is the case that could be confused with a resigner, and it is not.

## 4. Checked and found correct — recorded so nobody re-checks them

| Suspected | Reality |
|---|---|
| `?code=` in the claim URL is ignored | **Correct by design.** `claimUrl` deliberately omits the code and the page reads `?token=`. Putting a live credential in a URL is what the standby architecture exists to prevent |
| The invitation promises a "step down" button that may not exist | **It exists**, on `/standby`, wired to `/api/standby/leave` — which even distinguishes *"I don't know this person"* from *"I'm stepping down"*. Requiring authentication first is correct, or an interceptor could decline on someone's behalf |
| `delivery-webhook-monitor` had never run | **Wrong — it runs daily** at 08:47 UTC and fell outside the 20 most recent runs. All five workflows active and green |
| `/demo` says "Hack the Zero Stack" | **Correct in context.** `/demo` is linked *only* from `/security`, the page that deliberately keeps the hackathon artefacts because there they are an asset |
| `/about` claims the site avoids "we" | **True as scoped** — it says *"this page does not use it"*, and it doesn't |

## 5. Considered and rejected

**The legal pages say "there is no company" and then "we" 36 times.** Real inconsistency, and I
chose not to fix it. In a privacy policy "we" conventionally denotes the *service*, not a headcount;
a sole trader writing *"we do not sell your data"* is standard and not misleading. Rewriting 36
substantive privacy and security claims for a stylistic point would carry real risk in the worst
place to carry it, for no user benefit.

## 6. Deferred, with scores

| Item | Score | Note |
|---|---|---|
| `email_send_attempts` retention | 2 | one row per outbound message forever. At current volume this takes years to matter; the repo's own note calls it *"a retention question, not a correctness one"* |
| `scrollable-regions` raw-CSS coverage | 2 | the guard reads utility classes only. The rendered a11y audit passes at 0 serious/critical, so this is guard coverage, not a live defect |
| `verify:iam` not in CI | — | CI holds no AWS credentials. Closing it means putting a credential in CI — an infra change needing Steve |

## 7. Debt created

None. All three changes are net-subtractive in risk: two copy corrections and one query that makes
an existing metric more honest.

## 8. Blocked — one, and it is a judgement call

### The `/demo` hackathon badge, if the audience ever changes
Owner: **steve** · Category: decision needed
Correct today because `/demo` sits behind `/security`. **If a future op-ed or the homepage ever links
to `/demo` directly**, the same reasoning that reframed the `/caregivers` badge applies to it. Not
changed — extending this morning's ruling is Steve's call, not mine.

## 9. Recommended top 3

1. **Merge and deploy.** All three fixes are on the claim path, and beta invitations are queued.
   Shipping them *after* the first cohort is worth much less than shipping them before.
2. **Then send the beta list.** The path is now measurably better than it was this morning, and
   Phase 0 has been at N=0 since 2026-08-12.
3. **The op-ed rewrite** — still the only item nobody else can do.
