# A decision for Steve: should the CMK be multi-Region?

> **Written 2026-08-20. NOT TAKEN, and deliberately not taken.** This is a proposal under the
> Infrastructure Change Policy — a change to a working system needs a documented problem, a rollback
> inside ten minutes, a snapshot first, an isolated test, and **Steve's explicit request**. Four of
> those are satisfiable and the fifth is not mine to supply. Nothing in this document has been done.
>
> The finding it addresses is `PROJECT.yaml → deferred → the-failover-does-not-carry-the-ability-to-decrypt`
> (`B3`). The limitation itself is now written where a person meets it: `CLAUDE.md`'s failover
> invariant and `docs/backup-restore-runbook.md`.

## The documented problem

`lib/db/connection.ts` keeps a primary and a secondary pool, and `DSQL_USE_SECONDARY=true` moves
every query to us-west-2. `lib/kms/kms-client.ts` builds **one** `KMSClient` from `AWS_REGION`
(default `us-east-1`) against **one** CMK, and nothing moves it.

So the failover moves the data path and not the crypto path. In a us-east-1 KMS impairment:

| What a person sees | What is actually true |
|---|---|
| Site up, pages render, sign-in works | Correct — none of that needs the CMK |
| Vault list loads, item titles show | Correct — titles are metadata, not ciphertext |
| **Reveal fails. Every item, both regions.** | The wrapped data key cannot be unwrapped anywhere |
| New items cannot be saved | `GenerateDataKey` is in the same Region |

**The deceptive part is the first two rows.** Somebody flipping the switch under pressure sees a
working site and concludes the failover worked. The product's one irreplaceable moment is the only
thing broken, and it is the moment it exists for — a family in an emergency, pressing Reveal.

**Scope, stated honestly: this is an availability problem and not a durability one.** No data is
lost and nothing is exposed. Reveals resume when the Region does. A regional KMS control-plane
impairment is rare and historically short. That is the argument for it being a *decision* rather
than an incident.

## Option A — do nothing, and say so (the default)

Keep the single-Region key. The limitation is now written in both places a person would meet it,
and the runbook says what to tell an affected customer.

- **Cost:** none.
- **Risk accepted:** during a us-east-1 KMS impairment, Relay cannot open anybody's vault. For a
  product whose promise is *access at the worst moment*, that is a real thing to accept knowingly
  rather than by omission — which is the state it was in until today.
- **Reopens when:** the first arms-length customer, a partner's diligence (they will ask), or the
  first time a Region actually wobbles.

## Option B — a multi-Region CMK

AWS multi-Region keys are one primary plus replicas that **share key material and key id**, so a
ciphertext wrapped by the primary is decryptable by a replica without re-wrapping anything.

- **What it costs:** one CMK per Region (~$1/month each) plus per-request charges in whichever
  Region serves. At this scale the money is not the argument in either direction.
- **The migration shape, and the reason this is not a five-minute job:** **an existing
  single-Region CMK cannot be converted.** A multi-Region key must be created as one. So every
  existing wrapped data key stays bound to the old key forever — the server cannot read plaintext,
  so nothing can re-wrap them — which means the old key can never be retired and the code must be
  able to unwrap under **either**. That is the same permanent-legacy rule
  `lib/crypto/secret-payload.ts` already lives under, and `vault_items.kms_key_id` already records
  which key each row used, so the information needed to route a decrypt is already stored.
- **Rollback:** point `KMS_KEY_ID` back and redeploy. Under ten minutes, because new wraps are the
  only thing that changes and old rows were never touched. This is the property that makes Option B
  *safe*; it is not an argument that it is *needed*.
- **What it does not fix:** a Region loss still takes new-item creation with it unless the wrap path
  also fails over, and that is a second change. Do not buy half of this and record it as done.

## Option C — a second, independent CMK in us-west-2

Two ordinary keys, chosen by Region at wrap time.

**Recommended against.** It has all of Option B's migration complexity and adds a real hazard: two
key materials means an item wrapped in one Region and read in the other simply fails, and the
failure would be per-item and intermittent rather than total — far harder to diagnose than an
outage. Recorded here so it is not re-proposed as the "simpler" option.

## Recommendation

**Option A until the first arms-length customer, then re-argue Option B under the 5-gate policy.**

The reasoning is this project's own sequencing rule rather than a technical judgement: `demand_signal`
is `none`, the exposure is availability during a rare regional event, and the mitigation's real cost
is not the dollar-a-month — it is a permanent two-key decrypt path in the most dangerous code in the
repository, taken before a single stranger has stored anything in it. The same logic declined
counsel and it applies unchanged here.

⚠️ **What makes Option A honest rather than lazy is that the limitation is now written down and the
customer-facing answer is prepared.** It was neither before 2026-08-20.

## If Option B is chosen, the order is not negotiable

1. Create the multi-Region primary in us-east-1. Do not touch anything else.
2. Add the replica in us-west-2. Verify `verify:kms` passes against **both**.
3. Teach the unwrap path to route by `vault_items.kms_key_id`, with a test that a row carrying the
   OLD key id still decrypts. This is the step where a mistake is unrecoverable.
4. Only then point new wraps at the new key. Old rows keep their key id and are never rewritten.
5. Snapshot before, rollback rehearsed, and `npm run verify:reveal` against production after — the
   walk that exists because the product's most valuable moment had no end-to-end proof.

**Steps 3 and 4 in either order but never merged**, and never in the same change as anything else.
