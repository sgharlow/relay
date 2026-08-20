# Binding wrapped data keys to an EncryptionContext — the design

> **2026-08-20. DESIGN ONLY. No crypto code changed.** `docs/backlog.md` Sprint 4 gates this:
> *"Its output is a plan someone can execute with credentials at their elbow — not a merged crypto
> change nobody has watched work."* Steve has not lifted that gate, so S4-3 (the wrap/unwrap change)
> is **not** in this branch. What is here is S4-1 (this document), S4-2 (the migration, authored and
> not applied) and S4-5 (the roll-forward and roll-back notes).
>
> **The finding** (`PROJECT.yaml → deferred → tenant-separation-at-the-kms-boundary-is-not-cryptographic`,
> B5): `generateDataKey` and `decryptDataKey` pass no `EncryptionContext`, and `DecryptCommand`
> names no `KeyId`. Any blob wrapped under the CMK unwraps for any caller the *application* lets
> through. The application-layer hole that permitted — a body-supplied `wrapped_data_key` acting as
> a cross-tenant oracle — was found and closed on 2026-08-13. **The structure that allowed it is
> unchanged.**

## 1. What the context should be, and why it is not the item

**`{ owner_id }`. Not `{ item_id }`, and not both.**

This is settled by a fact about the existing flow rather than by preference:

> **The wrap happens before the item exists.** `CryptoService.encryptForUpload`
> (`lib/crypto/crypto-service.ts`) POSTs `/api/kms/wrap` **first**, encrypts with the returned key,
> and only afterwards is the item POSTed and given an id. At the moment the data key is generated,
> there is no item id to bind to.

Binding to the item would therefore mean one of:

- the client generating the UUID before wrapping — a change to the id-allocation contract across
  every write path, for a threat the next paragraph shows is already covered; or
- a re-wrap after insert — two KMS calls per item and a window where the row and its key disagree.

**And owner-scoping is what the finding is actually about.** The 2026-08-13 oracle was
*cross-tenant*: one owner submitting another tenant's blob. `{ owner_id }` makes that refusal
happen **inside KMS**. What it does not stop is an owner unwrapping their own *other* item — which
is not a threat, because an owner is authorised for all of their own items anyway.

### Both call paths already hold the owner id

Verified by reading, not assumed. **No new query is needed on either path**, which is most of why
this design is small:

| Path | Where `owner_id` comes from |
|---|---|
| `/api/kms/wrap` | `getOwnerSession()` — already resolved, already in scope |
| `/api/kms/unwrap`, owner branch | the row lookup is already `WHERE id = $1 AND owner_id = $2` |
| `/api/kms/unwrap`, recipient branch | `evaluateRecipientUnwrap()` **already returns `ownerId`** |
| `lib/access/dashboard.ts` | the same gate, same resolved owner |

Four call sites in total — one wrap, three unwraps. All four are enumerated in §5.

## 2. 🔴 How a legacy blob is recognised — and the answer that must not be used

Every data key wrapped before this change has **no context and must decrypt forever**. The server
cannot read plaintext, so no migration can ever re-wrap a row. This is the same permanent-legacy
rule `lib/crypto/secret-payload.ts` already lives under.

The obvious implementation is to try with context and fall back without it on failure.

**That is wrong, and it is wrong in the specific way that matters: it re-opens the exact hole the
change closes.**

```
attacker submits a foreign wrapped_data_key
  → Decrypt with EncryptionContext { owner_id: attacker }   → fails (good)
  → fall back: Decrypt with no context                      → SUCCEEDS
```

A fallback path with no context is a permanently available bypass, reachable by anyone who can make
the first attempt fail — which is exactly what an attacker submitting somebody else's blob does. The
change would look implemented, every test written against legitimate blobs would pass, and the
oracle would still be open.

**So the era is a stored fact, decided BEFORE the KMS call, and never inferred from a failure.** A
decrypt that fails with the context its row claims is an **error**, not a prompt to try something
weaker.

This is the single most important sentence in this document, and it is the reason S4-2 exists at
all: the marker column is not bookkeeping convenience, it is what keeps the fix from being
self-defeating.

### The marker needs no backfill, and that is not luck

`ALTER TABLE vault_items ADD COLUMN kms_context_era TEXT` leaves every existing row `NULL`, and
**`NULL` already means exactly the right thing**: written before the change, wrapped without a
context. Every row that exists on the day the migration runs is legacy by definition. New writes
stamp the era. There is nothing to compute and nothing that can be got wrong — unlike `secret_kinds`
(migration 035), which needed a client to declare something the server could not know.

## 3. The second half: naming the key on Decrypt

`DecryptCommand` currently names no `KeyId`, so KMS decrypts a blob under whichever CMK the blob
itself names. That is a separate weakness from the context and it is fixed in the same change:
passing `KeyId` makes KMS refuse a ciphertext wrapped under any other key.

It also matters to `docs/kms-region-proposal.md`: if a multi-Region key is ever adopted, rows will
carry two different key ids, and a decrypt path that names the key is the one that can route
correctly instead of silently succeeding on whatever it is handed.

## 4. What "done" means — the live proof (S4-4)

The script that proves S4-3 cannot be written until S4-3 exists, because it must call the new
signatures. What it must assert is specified here so it cannot be quietly weakened later:

1. **A new wrap round-trips.** Generate with `{ owner_id: A }`, decrypt with `{ owner_id: A }` →
   plaintext key returns.
2. **A cross-tenant unwrap is refused BY KMS.** Take the blob from (1) and decrypt with
   `{ owner_id: B }` → AWS refuses. This is the assertion the whole change exists for, and it must
   fail at the KMS boundary, not at an application check.
3. **A legacy blob still decodes.** A row whose marker is `NULL` decrypts with no context, byte for
   byte. Use a **real** pre-change row, not one manufactured for the test.
4. **There is no fallback.** A row marked as context-era whose decrypt fails must ERROR. Assert the
   error — a test that only proves the happy paths cannot distinguish this design from the
   self-defeating one in §2.
5. **`npm run verify:reveal`** end to end, because that is the walk covering the moment the product
   exists for.

⚠️ Assertions 2 and 4 are the ones a hurried implementation drops. They are the design.

## 5. The four call sites

| # | Site | Change |
|---|---|---|
| 1 | `src/app/api/kms/wrap/route.ts:30` | pass `{ owner_id }`; return the era so the write path can stamp it |
| 2 | `src/app/api/kms/unwrap/route.ts:154` (owner) | read the row's era; pass context iff the era says so |
| 3 | `src/app/api/kms/unwrap/route.ts:216` (recipient) | same, with `ownerId` from `evaluateRecipientUnwrap` |
| 4 | `lib/access/dashboard.ts:496` | same |

Plus `lib/kms/kms-client.ts` itself, whose two functions gain an optional context parameter and
`KeyId` on Decrypt.

⚠️ **The era must be read from the row, never accepted from the caller.** A caller-supplied era is a
caller-supplied instruction to skip the context — the body-trusting mistake of 2026-08-13 in a new
costume. The row already has to be loaded to get `wrapped_data_key`; the era comes back in the same
`SELECT`.

## 6. Why this is still gated

Everything above is reasoning that can be checked by reading. What cannot be checked without
credentials is whether AWS behaves as described — specifically assertion 2, that KMS refuses a
mismatched context rather than ignoring it. That is documented behaviour, and this product's most
valuable moment sits behind it.

**Sequencing when the gate lifts** (from `docs/backlog.md`, unchanged):

1. Steve applies migration 037 to both regions, then `npm run verify:schema`.
2. The unwrap paths learn to read the era **before** anything writes one — so a row can be read
   correctly whether or not it has been stamped.
3. Only then does the wrap path start stamping.
4. The live-proof script, then `verify:reveal`.

Steps 2 and 3 in that order and **never merged**: reading before writing means a half-deployed state
is always safe, and `docs/encryption-context-rollout.md` (S4-5) works through what each half looks
like.
