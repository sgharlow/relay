# Rolling the EncryptionContext change out, and back

> **2026-08-20 (S4-5).** Companion to `docs/encryption-context-design.md`. That document settles
> *what* to build; this one settles *what a half-deployed state looks like in each direction, and
> which one is safe* — because on this path being wrong is not recoverable by trying again.
>
> Nothing here has been done. Sprint 4 is gated to design only.

## The one asymmetry everything else follows from

A migration and a deploy cannot land at the same instant, so there are always two half-states. On
most changes both are survivable. Here they are not:

| Half-state | What happens | Safe? |
|---|---|---|
| **Migration applied, code not deployed** | A nullable column exists that nothing reads or writes | ✅ Completely |
| **Code deployed, migration not applied** | Every vault read `SELECT`s a column that does not exist → `42703` | ❌ **Outage** |

The second is migration 029's incident in a new costume: code that required `auth_challenges`
shipped before the table did, and passkey sign-in threw for four minutes. Nothing in this repo
handles `42703` today — a missing column is an unhandled error, not a degraded path.

**So the migration goes first, always, and it is safe to sit there indefinitely.** Verified: every
`vault_items` read in the codebase names its columns explicitly — there is no `SELECT *` — so adding
a column cannot disturb a single existing query.

## 🔴 The point of no return, and where it actually is

It is **not** the migration, and it is **not** the deploy that starts reading the era. It is the
first row written with a context.

```
before:  every row has kms_context_era = NULL, decryptable with no context
after:   some rows have 'owner_v1', decryptable ONLY with { owner_id }
```

Rolling the **code** back after that point produces a build that does not pass a context — and those
rows then cannot be decrypted **at all**. Not by the old code, not by the new code, not by anyone.
The data is intact and unreachable, which for this product is the same thing as gone.

**A code rollback is therefore safe right up until the first context wrap, and catastrophic
immediately afterwards** — with no signal at the boundary, because the deploy that crosses it looks
exactly like the deploy before it.

## What that implies for how it is built

**The writing side must be separately switchable from the reading side.** If "start wrapping with a
context" is a code path selected by a deployed build, then turning it off means shipping a different
build, and the rows written in between are stranded. If it is a flag, turning it off is one
environment variable and the reading side — which is what those rows need — stays in place.

So the change is **three deploys, not one**, and the middle one is the whole point:

| Phase | What ships | Reversible? |
|---|---|---|
| **A** | Migration 037, both regions. No code | ✅ `DROP COLUMN` — nothing has a value |
| **B** | Code that **reads** the era and always wraps **without** context. A no-op: every row is `NULL`, so every decrypt takes the legacy path | ✅ Revert the deploy; no row has a context |
| **C** | Flip the flag so new wraps carry `{ owner_id }` and stamp `'owner_v1'` | ⚠️ **Flag off, not deploy back** |

Phase B is the one a hurried plan skips, and skipping it is what makes the rollback impossible. It
buys the property that matters: **by the time anything writes a context, the ability to read one is
already deployed, proven in production, and cannot be lost by reverting the change that introduced
it.**

## Rolling back, by phase

- **After A:** `ALTER TABLE vault_items DROP COLUMN kms_context_era;`. Clean — no row has a value.
- **After B:** revert the deploy. The column stays, still all `NULL`, still read by nobody. Clean.
- **After C:** **turn the flag off.** New wraps go back to no context; rows already stamped
  `'owner_v1'` keep decrypting, because phase B's reading code is still deployed and still routes on
  the era.

  ⛔ **Do not revert the code after C.** That removes the reading side, and every row written since
  the flag went on becomes permanently undecryptable. If a revert has already happened, the recovery
  is to redeploy a build that reads the era — the rows are fine, the *code* is what is missing —
  and the sooner that is understood the smaller the window of customers who cannot reveal.

## The two questions to answer before phase C

1. **Has the live proof run?** `docs/encryption-context-design.md` §4 lists what it must assert,
   including the two a hurried implementation drops: that a cross-tenant unwrap is refused **by
   KMS**, and that a context-era row whose decrypt fails **errors** rather than retrying weaker.
2. **Does `verify:reveal` pass against production?** It is the walk that exists because the
   product's most valuable moment had no end-to-end proof, and it is the only check that exercises
   the whole chain a grieving person actually walks.

Phase C without both is a change to the crypto path that nobody has watched work.

## What this does not cover

**A multi-Region CMK.** `docs/kms-region-proposal.md` is a separate decision, currently ruled
**Option A** (accept the single-Region key until the first arms-length customer). If it is ever
taken, it interacts with this work: rows would carry two different `kms_key_id` values *and* two
context eras, and the decrypt path would route on both. Doing them together would be two
irreversible changes in one deploy.

**Do them in separate quarters, not separate commits.**


---

## Phase B build sheet — B5.1, drafted 2026-09-01 after Steve lifted the B5.0 gate

**Status: NOT BUILT.** The gate was lifted in the 2026-09-01 co-pilot sitting, which authorises
this work; it was deliberately not written the same evening. The reason is in this document's own
§"The point of no return": this is the one path in the product where a mistake is **unrecoverable**
— rows become intact and unreachable, which for this product is the same thing as gone — and the
B5 roadmap row names *"**any** change on the wrap/unwrap path"* as a trigger that reopens the gate.
Shipping it as the last act of a six-hour session is the shape this repository's rules exist to
refuse. It is a morning task, and this sheet is what makes it a short one.

### Why it is now more urgent than the roadmap assumed, not less

The roadmap argued for lifting the gate early because *"the compatibility risk is empty today (zero
vault items)"*. Measured 2026-08-30: `vault_items` holds **one** real row. That does not weaken the
argument, it sharpens it — every item added before phase C is another row a rollback must stay
compatible with, and the window the plan called cheapest is open and narrowing.

### The surface, measured 2026-09-01

Contained, which is the good news: **two functions and four call sites.**

| File | Change |
|---|---|
| `lib/kms/kms-client.ts` | `generateDataKey(context?)` — accepts an optional `EncryptionContext`, and **passes nothing while the flag is off**. `decryptDataKey(wrapped, era)` — routes on the era: `NULL` → today's call exactly, `'owner_v1'` → pass `{ owner_id }`. Also name `KeyId` explicitly on `DecryptCommand` (today it is inferred from the ciphertext blob; naming it is required before a context is ever used, and is a no-op until then) |
| `src/app/api/kms/wrap/route.ts` | one call site — reads the flag, still wraps without context |
| `src/app/api/kms/unwrap/route.ts` | two call sites (lines ~154, ~216) — must SELECT `kms_context_era` alongside `wrapped_data_key` and pass it |
| `lib/access/dashboard.ts` | one call site (~496) — same: add the column to the SELECT, pass the era |

### The three properties the tests must pin

1. **It is a no-op today.** Every existing row has `kms_context_era = NULL`, so every decrypt takes
   the legacy path byte-for-byte. Prove it by asserting the `DecryptCommand` carries **no**
   `EncryptionContext` for a NULL-era row.
2. **The reading side works before anything writes.** Feed a synthetic `'owner_v1'` row and assert
   the context IS passed, with the right owner. This is the property that makes phase C reversible,
   and it must be proven while nothing depends on it.
3. **An unknown era FAILS CLOSED.** A row with an era this build does not recognise must refuse to
   decrypt rather than silently falling back to no context — a silent fallback would make a future
   era's rows look decryptable-but-wrong instead of loudly unsupported.

### Before phase C, and not before

`verify:reveal` must run green against production after phase B is deployed. Phase B is a
**deploy**, not a merge: the property being bought is that the ability to read a context is *already
live and proven in production* by the time anything writes one. Merging phase B and flipping the
flag in the same sitting throws away the entire point of splitting them.
