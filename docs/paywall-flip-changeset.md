# The paywall flip, assembled

> **2026-08-20. NOTHING IS FLIPPED HERE.** `TIER_LIMITS.free.canRelease` is still `true`. This is
> the change-set for the day it is not, written while there is no time pressure — because
> `ratified.beta-free-release` comes up for its **2026-10-01** revisit, and the alternative is an
> afternoon of archaeology on the day of the decision.
>
> The flip itself is Steve's, and it is one line. Everything else on this page is what has to move
> with it.

## Preconditions — all met as of 2026-08-20

The flip converts an expired card into a **blocked release** — the one thing the product exists to
do, stopped by a billing event. These are what make that survivable rather than silent:

| # | Precondition | State |
|---|---|---|
| 1 | A failed renewal tells the owner (S3-1) | ✅ `lib/billing/lapse-notice.ts`, wired into the webhook |
| 2 | The final lapse tells them too | ✅ same module, deduped on the subscription id |
| 3 | `/terms` says what a lapse does to their data (S3-2) | ✅ "If you stop paying, nothing is deleted" |
| 4 | The post-lapse behaviour is pinned by tests | ✅ `lib/ops/post-lapse-state.test.ts` |

**Without 1 and 2, the flip means somebody's release stops working because of an email they never
got.** That was the state until this sprint.

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
