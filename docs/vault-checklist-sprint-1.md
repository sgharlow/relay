# Relay Sprint 1 — the owner's vault, full checklist

**Moved into the repo 2026-08-27** (ROADMAP.md revision 4, §6 Sitting A) from
`__project-docs/relay-vault-checklist-SPRINT-1.md`, which now carries a supersession banner. It is
here so that `PROJECT.yaml → deferred → the-owners-vault-is-empty` cites a file the register can see.

> ▶️ **Relay is RESUMED, not parked** (`ratified.relay-resumed-2026-08-21`). report-bridge's
> 2026-09-12 GO-LIVE keeps precedence for Steve's attention until that day; this walk is scheduled
> for **2026-09-12** (`deferred.the-owners-vault-is-empty.sprint_1_calendar_lapsed.revisit`). ⚠️
> Nothing turns red on that date — no guard reads a `revisit:` (ROADMAP §2 A0.dm).
>
> **~20 minutes of clicking, ~10 of verification.** Nothing here is hard. It has stayed undone
> through six sprints because it is the only item that cannot be done by an agent.

---

## Why this is the item that unblocks the others

1. **`invite:cohort --commit` structurally REFUSES while the vault is empty.** The beta cohort
   cannot be invited at all until this is done — an invitee would be standing by for nothing.
2. **`ladder: dogfooded` describes the 2026-08-08 demonstration, not the system as it stands**
   (`ladder_evidence.as_of`). The only production account holds zero items and names nobody.
3. **The op-ed's landing experience and the readiness banner both assume a vault with something in
   it.** The demand lane's own instruments read empty.
4. **The restore drill's criterion 3** (one real item through Reveal against a restored cluster)
   needs a real item to exist *at backup time* — a backup taken today carries nothing to unwrap.

Measured 2026-08-27 (`npm run verify:dogfood`, read-only as `relay_ro`): **NOT READY — 5 pieces
missing**, the same five as on 2026-08-20.

---

## Before you start

- [ ] **B1.** Be signed in at **relaystandby.com** as the owner. Not a demo account.
- [ ] **B2.** Have real material to hand — see "What to put in it" below.
- [ ] **B3.** Baseline the probe so you can watch it move:
      ```bash
      cd ~/CascadeProjects/relay && npm run verify:dogfood
      ```
      Expect **NOT READY — 5 pieces missing**. Exit 1 = not ready, exit 2 = the probe could not run.

### 🛑 The two things that would waste the whole exercise

**Do not run `scripts/reset-demo.ts`.** It satisfies every count in seconds and proves nothing. The
probe excludes demo-flagged owners *for exactly that reason*; ROADMAP §2 A0 and §6 Sitting A bar it by
name, and §7 bars seeding with fixtures.

**Do not press Initiate.** On `/triggers` that fires a real release and emails your verifier.

### ⚠️ One more, new since the original checklist

**People you name in `/circle` here must NOT also appear in `.relay-cohort.json`.** `invite:cohort`
creates each person first and **stops the whole run on the first duplicate**. People named here get
their codes via `scripts/phase0-invite.ts`; new people go in the cohort file (ROADMAP §2 A3.2).

---

## The walk — six screens, in the order the product makes them possible

### [ ] 1. `/vault/new` — a real login, with all three fields

Fill **Secret value**, **and** the **Two-factor code** field (`otpauth://…` URI or the setup key),
**and** **Recovery codes**. The two extra fields are what set `factors_required`; a secret-only item
leaves the declaration path — `verify:factors`' entire subject — unexercised.

### [ ] 2. `/vault/new` — a second item, type **document** or **instruction**

The document class has its own rendering and reveal path.

### [ ] 3. `/vault` — press **Needs a code?** on the login row and answer it

This is the declaration *answer* path; without it the factor fields are stored but never read back.

### [ ] 4. `/circle` — one recipient **and** one verifier

⚠️ **Nobody is emailed.** Invitations are owner-delivered by design. Use real people you intend to
tell. ⚠️ **A verifier is not optional** — with none, no release can ever complete. One person can
wear both hats: tick both boxes, enter them once.

### [ ] 5. `/rules` — one rule: item + recipient + trigger `emergency` → **Add rule**

Items and people without a rule between them are two lists, not a plan. `release_state` is
provisioned by this step, not by naming a person — do it **before anyone claims an invitation**.

### [ ] 6. `/triggers` — set the check-in interval and required confirmations, save

🛑 **Save. Do not press Initiate.**

---

## What to put in it — this is the part that makes it real, not the clicking

| slot | good choice | why this one |
|---|---|---|
| Login #1 | an account you would genuinely want someone to reach in an emergency — email, password manager, bank | it should carry a real TOTP seed and real recovery codes, or step 1 is half-done |
| Item #2 | a document or instruction — "where the will is", "who to call first", an insurance policy number | exercises the non-credential class and its separate reveal path |
| Recipient | the person who would actually act | they receive nothing until you tell them |
| Verifier | someone who could confirm you are genuinely unreachable | must be someone who would answer |

---

## Verification — what Claude does the moment you say it's done

- [ ] **V1.** `npm run verify:dogfood` → must read **READY**, 0 pieces missing.
- [ ] **V2.** A0.t (ROADMAP §3 Sprint 1 row 1.t) — set/confirm the release configuration and confirm the readiness banner
      reports something *true* (via a minted owner session **only with your permission**, or
      Claude-in-Chrome in your signed-in browser).
- [ ] **V3.** A0.t — `npm run verify:orphans` (standing rule after every walk day).
- [ ] **V4.** The ladder: `ladder_evidence` in `PROJECT.yaml` is re-stamped present-tense, **or**
      states plainly that it still describes 2026-08-08. ⚠️ If the vault was seeded rather than
      real, it must be the second.
- [ ] **V5.** Re-derive ROADMAP §0.1's counts and confirm they are no longer zero.

**Done when:** the production counts are non-zero, and a cohort invitee would find something to
stand by for.

---

## What this unblocks, in order

1. **ROADMAP §2 A3** — `invite:cohort --commit` becomes possible at all. It has been deferred
   **three** times; a fourth deferral needs a revisit date.
2. **The ladder claim** stops being a statement about a demonstration.
3. **The demand lane's instruments** stop reading empty.
4. **The restore drill (Sprint 4)** gains the real item its criterion 3 needs.
