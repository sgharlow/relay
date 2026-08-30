# D20 — the purge, RUN 2026-08-30

**Ruled 2026-08-30 (Sitting D-1): purge. GO given by Steve the same day. Executed.**

| | |
|---|---|
| counted before | **28** — `verifier_codes` 17, `break_glass_codes` 10, `recipient_codes` 1 |
| rows deleted | **28** |
| remaining | **0** |
| `verify:orphans` after | **exit 0** — *"Orphan census: nothing unowned in any table the cascade purges."* |

The predicate matched exactly what the census matched, which is the property it was
scoped for. `DANGLING_BASELINE` was lowered 28 → 0 in the same commit, as the constant's
own comment demanded.

> The statements below are kept verbatim as the record of what ran. They are no longer a
> proposal.

> ⚠️ **This is a destructive production write with no undo.** It is drafted here rather
> than typed at a prompt so the exact statements can be read before they run, and so what
> ran is recoverable afterwards from something other than shell history.

---

## What the rows are

28 rows whose `owner_id` points at a `users` row that no longer exists — residue of a
hand-written `DELETE FROM users` during the 2026-08-08..14 fixture cleanup, which did not
run the cascade. This schema has no foreign keys, so nothing stopped it.

| table | column | rows |
|---|---|---|
| `verifier_codes` | `owner_id` | 17 |
| `break_glass_codes` | `owner_id` | 10 |
| `recipient_codes` | `owner_id` | 1 |

**Confirmed inert three times, not twice.** The newest is 2026-08-14. On 2026-08-29
fifteen disposable accounts were created and closed and added **zero**. On 2026-08-30
three browser-walk runs created and closed **twelve** more and again added **zero** — so
both cascades demonstrably work and this is a closed historical set, not a leak.

`auth_challenges` was a fourth table in the original finding and has **emptied itself**;
those rows expired, exactly as the register predicted.

## Why purge rather than accept

A permanently-red `npm run verify:orphans` is a check that stops being read, and it is red
today for this and nothing else. The rows are unreachable through the application: every
redemption path re-checks `owner_id` against a live user, so they are inert as well as
invisible.

## The statements

Each is scoped by the same predicate the census uses, so a row that has *become* reachable
between the count and the run is not touched. Run them in this order, one at a time,
reading the row count after each.

```sql
-- 1 of 3
DELETE FROM verifier_codes
 WHERE owner_id IS NOT NULL
   AND owner_id NOT IN (SELECT id FROM users);

-- 2 of 3
DELETE FROM break_glass_codes
 WHERE owner_id IS NOT NULL
   AND owner_id NOT IN (SELECT id FROM users);

-- 3 of 3
DELETE FROM recipient_codes
 WHERE owner_id IS NOT NULL
   AND owner_id NOT IN (SELECT id FROM users);
```

⚠️ **`NOT IN (SELECT id FROM users)` and not a literal id list.** A hand-written list is how
these rows were created; the predicate is the census's own, so the statement cannot delete
something the count did not see.

⚠️ **Which identity.** These need write access, so `.env.admin` — `.env.ro` is SELECT-only
and will refuse, which is the correct outcome if the wrong file is named.

## Before, and after

```bash
npm run verify:orphans          # expect: FAIL, 28 rows across the three tables
# ... run the three statements ...
npm run verify:orphans          # expect: no dangling rows; only the audit_log NOTICE
```

The second run is the proof and is not optional: the count is the only thing that says the
predicate matched what the census matched.

## And one follow-up that is easy to forget

`lib/ops/orphan-health.ts` carries `DANGLING_BASELINE = 28`, recording this exact set so
the daily probe alarms on *growth* rather than on known residue. **Lower it to 0 in the same
commit as the purge.** A baseline left above the real count is a blind spot exactly the size
of the difference — which is how a tolerance becomes a place for the next leak to hide.

*(That constant ships in PR #35 and is not on `master` yet; if the purge runs first, the
baseline should be written as 0 from the start.)*

## Rollback

**There is none.** These rows cannot be reconstructed — they are hashes of codes that were
issued to people who no longer have accounts. That is why the ruling asks for an explicit
GO rather than treating this as routine housekeeping, and why the argument for running it
rests on their being unreachable rather than on their being unimportant.
