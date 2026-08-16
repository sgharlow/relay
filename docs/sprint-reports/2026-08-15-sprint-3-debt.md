# Sprint report — 2026-08-15 (sprint 3: the three unblocked items)

Branch: `sprint/2026-08-15-3` (3 commits, off `sprint/2026-08-15-2`)
Iterations used: **3 of 5**. Stopped because the requested queue was exhausted.

---

## Headline

**D8 was not tidiness — it was a data-corruption path with a date on it.**

The subscription INSERT hardcoded `11900`, so the column recording what a customer *paid* was a
restatement of the list price. `PriceCard.tsx` reads a runtime price override deliberately —
*"Runtime-configurable so a price test does not require a deploy (J1-R8)"* — and the G1 gate is
*"click-to-intent AT A REAL PRICE POINT"*. Show $99, charge $99, record $119: every row agreeing
with each other and with nothing that happened, in the column any revenue question is answered
from. **The ad flight starting this month is the thing that would have done it.**

And the two palette items turned out to be one root cause, found by two independent checks
agreeing.

## D5 — decided before the work

**Ruled by Steve: match the destination.** The creatives are warm paper (`#f7f4ee` / `#1f1b16` /
`#b4703a`), and every prompt has been rewritten.

The decision was settled by the repo, not by taste. This project has answered the question twice,
in red, in its own source:

- `src/app/icon.svg`: *"Every browser tab advertised a product that looked nothing like the one
  behind it."*
- `public/assets/brand/social-card.svg`: *"Both currently advertise a product that looks nothing
  like the one behind the link… a share card for this product competes in a feed full of shouting,
  and the thing being offered is calm."*

Both treated the mismatch as a **defect to fix**, not a contrast to keep. The slate in the ad
prompts was never an art direction — it was un-migrated legacy from before Warm Archive existed.

The alternative was real and is recorded rather than dismissed: the brand has a **sanctioned dark
mode** in `relay-mark-inverse.svg` (ink ground, ochre lifted to `#f6ead9` because ochre on ink is
3.4:1). If a lane ever needs feed contrast, that is the dark to use — not the retired slate.

## 1. Backlog source

`.claude/sprint-state.json` → `sprint2.unblockedNext`, written at the end of the previous sprint and
named by this sprint's scope. **Not inferred.**

## 2. Baseline

| Check | Start | End |
|---|---|---|
| Types / lint / build | green | green |
| Tests | **2364 passed, 1 skipped** | **2376 passed, 1 skipped** |
| Ad instrument (live) | green 7/7 | green 7/7 |

+12 tests, no newly skipped.

## 3. Shipped

### D8 · correctness · `311bfc9` — the row recording a payment was a constant

| AC | Proven by |
|---|---|
| One definition, in `lib/offer.ts` | `content.ts` re-exports; every existing import untouched |
| `price_cents` = what Stripe charged, parameterized | webhook test: `amount_total: 9900` → `9900` in params, and the SQL no longer matches `/\b11900\b/` |
| Falls back to the definition when Stripe sends no amount | test with `amount_total: null` |
| UI restatements consume it | 4 files interpolate `PRICE_YEARLY_LABEL` |
| A literal cannot return | `price-single-definition.test.ts`, proven on **both** units — planted `$119` and planted `11900` |

**The fix is not a shared constant.** Stripe already says what it charged (`amount_total`,
`unit_amount`), so the row records the authority. That is the move this handler already makes for
status: *"Re-reading the subscription from Stripe at handling time makes the question disappear
instead… idempotent by construction rather than by discipline."* The list price survives only as a
fallback. **The webhook had no test at all**; all three new ones failed before the change.

### D7 + D5 · correctness · `1fe6f7b` — the share card for the page ads land on was still slate

`raw-color.test.ts` exempts `opengraph-image.tsx` for a real reason (Satori resolves no CSS
variables). **Nothing checked which literals they used** — so when Warm Archive landed on
2026-08-13 the root card was rebuilt and the *caregivers* card was missed. Of all the files to
miss: it is the link preview for the exact page paid ads land on.

Its copy was also still second person attached to an emergency — *"Opens for **you** in a real
emergency"* — the shape §1a rules out and the landing page was rewritten to remove.

Fixed both, and **verified by rendering it**, not by compiling it. `og-palette.test.ts` closes the
exemption's hole: a literal is allowed, an invented one is not.

> **The checks composed, which is the part worth recording.** Fixing the OG card *broke*
> `ad-copy.test.ts`: three greys in `PROMPTS.md` had been justified **only** by that stale file. The
> prompts' evidence that their palette came "from the shipped product" was a file nobody had
> migrated. Two independent checks, one root cause.

### D2 · correctness · `b0facb6` — code that queries a table nothing creates

The complement to `verify:schema`, and the item **filed as debt yesterday rather than shipped**.
The naive parse returned 183 candidates, almost all English prose ("from a", "from anyone"). SQL now
comes only from template literals that read as SQL, after comments are stripped — because comments
here *quote* SQL to explain it.

Green on the current tree with **zero false positives**, which is the bar it failed before. Two
vacuity guards: >20 statements found, and `users`/`vault_items`/`release_state`/`audit_log` all
present. Proven by a planted `INSERT INTO caregiver_leads_typo`.

## 4. Blocked

**None.** Every item in scope shipped.

## 5. Deferred queue

| ID | Item | Score | Note |
|---|---|---|---|
| D6 | Generate the 7 ad image assets | 4 | Now fully unblocked — D5 is ruled and the prompts are correct. Needs Gemini; blocks only the Meta lane |
| Step 8 | The ad sitting | — | **Parked to 2026-08-16.** `docs/g1-sitting-sheet.md` is ready |
| P3/P4 | Least-privilege: Vercel cutover, strip `DbConnectAdmin` | — | Needs your go-ahead; rollback is one env var |
| D3 | Environment guard for product email | 5 | Needs the same ruling shape as D1 — a blanket gag breaks `verify:live` |
| D4 | Migration ledger in the database | 5 | Infra change; 5-criteria gate |

## 6. Debt created

**None.** No test weakened or skipped, nothing stubbed.

**One threshold changed, and it is worth stating plainly rather than burying.** The `PROMPTS.md`
vacuity guard asserted "at least 5 distinct colours", a number calibrated to the old slate set;
Warm Archive uses four, so it failed on *correct* input. Lowering it to 4 is precisely how a guard
becomes a rubber stamp, and the next migration would have met the same argument with less
resistance. It now **names** paper, ink and ochre — a stronger assertion than any count, and one no
threshold adjustment can wave through.

**Housekeeping:** a `next dev` process (PID 53732) left over from the Phase 2 test in an earlier
sprint was still running against the cluster. Terminated.

## 7. Recommended top 3

1. **The sitting, tomorrow.** Submit-by is ~2026-08-26 and the slack absorbs exactly one
   rejection-and-resubmit cycle. Everything else is ready.
2. **D6 — generate the seven assets.** Now genuinely unblocked: the ruling is made, the prompts are
   in the right palette, every matrix row has a block, and the avatar is a render of `icon.svg`
   rather than a generation. Only blocks the Meta lane.
3. **Decide on P3/P4.** Production still authenticates as DSQL `admin` with full DDL rights. Local
   dev is already on the restricted role and proven, so the remaining step is one env var and a
   redeploy.
