# The hardest part of a digital‑estate vault isn't storage — it's the release

*Building Relay for the H0 "Hack the Zero Stack" hackathon — Vercel + AWS Databases, hero database **Amazon Aurora DSQL**.*

**#H0Hackathon** · Built for Devpost's *H0: Hack the Zero Stack with Vercel and AWS Databases*. Created for this hackathon.

---

Everyone who has thought about "what happens to my accounts if I'm not around" reaches for the same mental model: a password vault you hand someone. But the vault is the easy 20%. The terrifying 80% is the **release** — the moment a system decides, on its own, to hand your private life to another person. Get that wrong and you've either leaked everything early or locked out the one person who needed in during an emergency.

So when I built **Relay** — a living‑continuity vault that grants scoped, reversible access to the people who'll need it — I treated the release as the actual product, and I picked the database to match. The release is a one‑way, correctness‑critical state transition that can be triggered by several actors at once. That is exactly the workload **Amazon Aurora DSQL** is built for, and it's why DSQL is the hero of this entry, not an implementation detail.

## The problem: an irreversible action that several people can trigger at once

Relay's release runs a state machine: `ARMED → PENDING → GRACE → RELEASED`. A trigger (a missed check‑in, a manual emergency request, or a verified estate event) moves it off `ARMED`; then it notifies the owner, requires **N‑of‑M trusted verifiers** to confirm, and observes a grace window before access opens. Emergencies are reversible — when the owner checks back in, access closes automatically. Estate handoffs are permanent.

Now picture the race that keeps you up at night: the scheduler fires the overdue‑check‑in sweep, the last verifier confirms, and the owner checks in to cancel — all in the same second. A naïve implementation double‑releases, or releases something the owner just revoked. The default‑safe state has to be `ARMED`, always, no matter who lost the race.

## Why Aurora DSQL — the choice *is* the architecture

1. **Strong consistency for a one‑way action.** Releasing a vault is irreversible. A stale read of the release state or of a recipient's scope is unacceptable — it leaks data or opens the wrong door. DSQL's strong consistency across regional endpoints is the right guarantee for "you only get to be wrong zero times."
2. **Availability at a moment no one schedules.** A release can land during a regional disruption — that's often *why* it's happening. DSQL's active‑active, multi‑region design keeps the recipient's access path live even if a region goes down. Relay demonstrates this with a live failover in the demo: flip traffic to `us‑west‑2`, and access keeps serving, strongly consistent.
3. **Optimistic concurrency that fits the workload.** A personal continuity vault is intrinsically low‑contention — one owner, rare release events. That's exactly where OCC shines. So every transition is a **compare‑and‑set**: `UPDATE … WHERE id = $ AND state = $ AND version = $`. If the row moved under me, the affected‑row count is zero, DSQL surfaces the conflict (SQLSTATE `40001`), and I retry with backoff — or, on exhaustion, **reset to `ARMED`**. The safe default is enforced by the database's concurrency model, not by hopeful application code.

## The DSQL habits I had to unlearn

- **No foreign keys.** DSQL doesn't enforce them, so referential integrity lives in the application layer (`assertOwns`, `cascadeDelete`, `assertNoCrossOwner`). It sounds like a downgrade; in a distributed system it's healthier — integrity becomes explicit, owner‑scoped, and testable, instead of an invisible constraint you hope fired.
- **Conflicts are a feature, not an error.** Snapshot isolation means concurrent writers collide as `40001`. Instead of reaching for a lock that doesn't exist, I leaned into compare‑and‑set + bounded retry. The release engine's correctness *is* its conflict handling.
- **Sign‑in without `ON CONFLICT`.** The user upsert originally relied on a unique index `ON CONFLICT (auth_sub)` — which DSQL may not enforce as a secondary‑index constraint. I rewrote it to an app‑level intent‑read (SELECT → UPDATE/INSERT under OCC retry), so authentication doesn't depend on a database feature that isn't guaranteed.

## The other invariant: the database never sees a secret

Relay is zero‑knowledge by construction. The browser generates a per‑item AES‑GCM‑256 data key, encrypts the secret locally, and only then calls AWS KMS to wrap the data key. The server stores **ciphertext + a wrapped key + non‑secret metadata** — never plaintext. The "smart" part of the product, an importance engine that ranks your accounts by what matters in a crisis (and flags that your primary email is the key that unlocks most password resets), runs over **metadata only**. It never touches a secret, so it can't leak one. A recipient's decrypt only unwraps when the release state is `RELEASED` *and* an access rule links that recipient to that item — checked before any KMS call.

## What I'd tell the next person building on DSQL

Model your correctness‑critical action as a compare‑and‑set with a safe default, and let the database own the invariant. Once "it can never double‑release" is guaranteed by strongly‑consistent OCC instead of by a distributed lock and a nightly reconciliation job, an entire category of code — and an entire category of 3am pages — simply never gets written. That's the same lesson whether you're releasing a vault, selling the last seat, or moving money: the hard part isn't storing the data, it's being *provably right* about the one transition that can't be undone.

*Relay is open source (MIT) and built on Amazon Aurora DSQL + AWS KMS + Next.js on Vercel.*
