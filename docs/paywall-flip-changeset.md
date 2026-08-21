# The paywall flip, assembled

> **2026-08-20. NOTHING IS FLIPPED HERE.** `TIER_LIMITS.free.canRelease` is still `true`. This is
> the change-set for the day it is not, written while there is no time pressure — because
> `ratified.beta-free-release` comes up for its **2026-10-01** revisit, and the alternative is an
> afternoon of archaeology on the day of the decision.
>
> The flip itself is Steve's, and it is one line. Everything else on this page is what has to move
> with it.

## Preconditions — ~~all met as of 2026-08-20~~ three of four; row 1 was not (corrected 2026-08-21)

The flip converts an expired card into a **blocked release** — the one thing the product exists to
do, stopped by a billing event. These are what make that survivable rather than silent:

| # | Precondition | State |
|---|---|---|
| 1 | A failed renewal tells the owner (S3-1) | ⚠️ **was BROKEN when this table was written** — see below |
| 2 | The final lapse tells them too | ✅ same module, deduped on the subscription id |
| 3 | `/terms` says what a lapse does to their data (S3-2) | ✅ "If you stop paying, nothing is deleted" |
| 4 | The post-lapse behaviour is pinned by tests | ✅ `lib/ops/post-lapse-state.test.ts` |

**Without 1 and 2, the flip means somebody's release stops working because of an email they never
got.** That was the state until this sprint.

> 🔴 **Row 1 read `✅ lib/billing/lapse-notice.ts, wired into the webhook` on 2026-08-20 and the
> notice could not have fired.** The handler read `invoice.subscription`, a field the pinned API
> version (`2026-07-29.dahlia`) does not put on an Invoice — it moved to
> `parent.subscription_details.subscription`. `subId` resolved to `undefined`, the case broke, and
> the endpoint answered `{received:true}`: a clean 200 in Stripe's dashboard for an event that told
> nobody anything. Fixed 2026-08-21, both shapes now read, with a unit test per shape
> (`src/app/api/stripe/webhook/route.test.ts`).
>
> **The lesson for this page, not just for that bug:** every precondition in the table above was
> established by reading code and greps, and this one passed both — the module existed, the webhook
> called it, and a test asserted the call. What no check asked was whether the payload it reads
> looks like the payload Stripe sends. Row 1 is now `built`, not `live-proven`; **E1-prime is still
> the open half**, and that is a precondition of the flip rather than a nicety
> (`PROJECT.yaml → deferred → the-lapse-notice-is-wired-not-live-proven`).

## The three artifacts, grep-verified

Found by searching for `canRelease` across `lib/`, `src/` and `docs/` rather than from memory:

| # | Artifact | Where | Change |
|---|---|---|---|
| 1 | The flag | `lib/billing/entitlements.ts` — `TIER_LIMITS.free.canRelease` | `true` → `false` |
| 2 | The skipped test | `lib/billing/entitlements.test.ts` — `it.skip('blocks release on free …')` | remove `.skip` |
| 3 | The manual's promise | `public/guide/index.html` §2.7 — *"the free limits apply only to adding more"* | correct it, and the PDF beside it |

Three other files mention `canRelease` and **need no change**: `lib/billing/beta-flag.test.ts` and
`lib/ops/post-lapse-state.test.ts` are the guards that fire, and `lib/billing/lapse-notice.ts`
mentions it only in a comment explaining why the notices exist.

⚠️ **The manual ships twice.** `public/guide/index.html` and `public/guide/relay-guide.pdf` are the
same document, and `scripts/guide-pdf.mjs` exists because the two were able to drift. Re-run it.

## 🔴 The flip does NOT paywall releases. It paywalls one of four ways a release starts.

> Added 2026-08-21. **This is an open decision, not a finding with a fix**, and it belongs to Steve
> before the flip rather than after it.

`assertCanRelease` is called in exactly **one** place — inside `initiateTrigger`, in
`lib/release/triggers.ts`. Found by grepping `assertCanRelease` across `lib/`, `src/` and
`scripts/`, the same way the three artifacts above were found. But `armed → pending` is reached from
**four** places, and `lib/release/*.ts` imports nothing from `lib/billing` except that one file:

| # | Path | File | Function | Who starts it | Gated today |
|---|---|---|---|---|---|
| 1 | Owner presses Initiate | `lib/release/triggers.ts` | `initiateTrigger` | the owner, deliberately | ✅ yes |
| 2 | Missed check-in | `lib/release/heartbeat.ts` | the missed check-in sweep | the **cron**, on silence | ❌ no |
| 3 | Owner consents to an access request | `lib/release/challenge.ts` | the consent handler | a recipient asks, the owner agrees | ❌ no |
| 4 | Owner silent on a challenge | `lib/release/escalation.ts` | the escalation timeout | **nobody** — the clock | ❌ no |

Re-derive the list rather than trusting this table. The paths are the transitions out of `armed`,
and finding them is two commands:

```bash
# every path that starts a release, and every place the gate is actually applied
grep -rn "'armed', 'pending'" lib/release/ | grep -v '\.test\.'
grep -rn "assertCanRelease" lib/ src/ scripts/ | grep -v '\.test\.'
```

> ⚠️ **This table carried line numbers when it was written on 2026-08-21, and two of them were
> already wrong in the same working tree that produced them** — nine lines were added above
> `assertCanRelease` by other work in the same sitting, so `triggers.ts:135` had moved from being
> path 1's transition to being the gate call itself: the most confusing possible way to be wrong.
> The offsets are gone rather than corrected, because a corrected offset buys a day at most — the
> ruling this page is written for is dated **2026-10-01**. This is the repo's own "volatile numbers
> live in one place" rule firing inside the commit that introduced the violation.

(`lib/release/simulate.ts` holds a fifth transition and is not in scope: it is the demo control,
route-gated to demo accounts, and `getEntitlement` resolves a demo account to `paid` regardless.)

**So after the flip, a free or lapsed owner cannot press Initiate — and a missed check-in, an
access request they consent to, or an unanswered challenge still releases.** Whether that is the
product or a hole is genuinely undecided, and both readings are defensible:

- **Only the manual path is paywalled** (leave as is). The dead-man's-switch is the promise Relay
  makes to a family; a card that expired while somebody was in hospital is the exact moment not to
  enforce billing. This is the same argument that put `past_due` inside `ACTIVE_STATUSES`.
- **All four are paywalled.** Otherwise the paywall is on the one path an owner controls and off
  the three that fire on their behalf, which is close to no paywall at all — and paths 2 and 4 need
  no owner action, so a lapsed account would keep doing the paid thing indefinitely.

⚠️ **The current change-set does not detect this.** "Proven: flipping `canRelease` to `false` turns
three tests red" is true and does not help — none of those three asserts *where* the gate is
applied. That is `feedback-a-guard-on-the-wrong-gate` exactly: assert **where** a check runs, not
only that the helper works. Whichever way the ruling goes, the flip commit should carry a test
naming all four paths and asserting the gate sits on each one that is meant to be gated — a table
that fails when a fifth path appears, rather than a comment asking the next author to remember.

**Also unwritten either way:** `/terms` and guide §2.7 describe what the free plan can do. If paths
2–4 stay ungated, that is a *feature* a free owner has and neither document mentions it; if they
are gated, both documents become wrong on the day of the flip. One of those edits belongs in the
same commit.

## What already couples them — and what did not

**Two of the three were already coupled** when this item was picked up, which is worth recording
because the backlog assumed none of them were:

- `lib/billing/beta-flag.test.ts` (pre-existing) ties the **flag** to the **manual**. Flip the flag
  and it goes red saying §2.7 is now untrue.
- `lib/ops/post-lapse-state.test.ts` (added in S3-2, earlier this sprint) pins the flag's value
  without claiming that value is right.

🔴 **The third was not coupled to anything.** Flipping the flag with the `.skip` still in place would
enable the paywall while the one test that proves it works stayed switched off — and the suite would
be green, because *a check that is not running looks exactly like a check that is passing.* That
coupling was added here.

**Proven:** flipping `canRelease` to `false` and changing nothing else now turns **three** tests red
— the manual guard, the skip guard, and the pin — each naming what to fix.

## The skipped test: read, and confirmed still correct

The contract for this item required this rather than assuming it, because *"a test skipped since
before the beta may assert something the product has since changed, and un-skipping a stale
assertion on flip day is the worst possible moment to find out."*

```ts
it.skip('blocks release on free (re-enable when the beta paywall is turned on)', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
    .mockResolvedValueOnce({ rows: [] } as never);
  await expect(assertCanRelease('o-1')).rejects.toThrow(EntitlementError);
});
```

**It is still correct**, on three checks:

1. **The harness shape is current.** Its passing sibling three lines below (`allows release on paid`)
   uses the *same two mocks in the same order* — `is_demo_account`, then the subscription row — and
   that test runs green today. So the mock sequence still matches what `getEntitlement` actually
   queries.
2. **The fixture still means "free".** The second mock returns `rows: []` — no subscription row —
   which `getEntitlement` resolves to the free tier.
3. **The assertion matches the behaviour the flip enables.** `assertCanRelease` throws
   `EntitlementError` exactly when `TIER_LIMITS[tier].canRelease` is false. Today free is `true`, so
   the test would fail — which is why it is skipped, and the skip is honest rather than stale.

## The change-set, in one commit

```
lib/billing/entitlements.ts        canRelease: true -> false, and update the comment
                                   above it, which currently says FLIP TO false WHEN
                                   BETA ENDS and explains why it is true
lib/billing/entitlements.test.ts   remove `.skip`
public/guide/index.html            §2.7 — the free limits no longer "apply only to
                                   adding more"; a free or lapsed account cannot release
public/guide/relay-guide.pdf       re-run `node scripts/guide-pdf.mjs`
PROJECT.yaml                       record the ruling on ratified.beta-free-release
                                   AND the ruling on the four armed->pending paths
lib/release/<per the ruling>       if paths 2-4 are to be gated, the call goes on each
                                   one — plus a test that names all four, so a fifth
                                   path cannot appear ungated and unnoticed
/terms + guide §2.7                whichever way the ruling goes, one of them is
                                   currently silent on what a free plan can still do
```

**Then run:** `npm run gate`, and `npm run verify:live` — the paywall sits on the release path, and
that is the walk which exercises it.

⚠️ **Also worth deciding in the same change, though not strictly part of the flip:** the `/account`
screen does not currently tell a free owner that releases are unavailable, because today they are
not. After the flip that is a live gap on the surface an owner would look at.

## What this document is not

It is **not** a recommendation to flip. `ratified.beta-free-release` is dated 2026-10-01 and the
decision belongs to Steve — including the option of extending the beta, which is a legitimate answer
and would need only a new date. `lib/ops/gates.test.ts` continues to guard the ordering and is green.
