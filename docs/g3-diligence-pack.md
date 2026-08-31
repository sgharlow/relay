# G3 diligence answer pack

**A6.5, written 2026-08-30.** The answers a benefits-side partner's diligence will ask for, prepared
before the first meeting rather than during it.

> **The premise this pack is built on, and it is unusual: there is no legal opinion, and the pack
> says so first.** `gates.g2-counsel-opinion` was **DECLINED** on 2026-08-14 — not failed, not
> pending. No counsel has been engaged and none is planned at this stage. A partner's diligence will
> ask questions that an opinion would have answered, and the honest position is that this pilot is
> one of the things that would fund getting one.
>
> Saying that plainly is also the only version that survives contact. A one-person product claiming
> a cleared legal position it does not have is the claim that gets found, and being found is worse
> than being small.

---

## 1 · Legal status — Q1, Q3, Q11

**The answer to all three is the same: no opinion exists, and this is the shape of the risk.**

| Question | Position |
|---|---|
| **Q1** — Is Relay a *custodian* under RUFADAA for the vault contents? | Unanswered. Relay stores ciphertext it cannot read and releases it to people the owner designated. Whether that makes it a custodian, with the disclosure obligations and immunity provisions that follow, has not been opined on. |
| **Q3** — Does operating the release make Relay a *fiduciary*? | Unanswered. `/terms` disclaims legal authority explicitly and repeatedly, and the product confers none — but whether a disclaimer is effective is exactly the question counsel would answer. |
| **Q11** — Does distributing through a **regulated** partner change Relay's status or add surface (GLBA vendor obligations, state insurance rules)? | Unanswered, **and it is the partner's question more than ours.** A regulated distributor's own vendor-diligence process will have a view, and that view is worth more to us than a purchased opinion. |

**What to say in the room:** *"No legal opinion exists. A pilot with you is one of the things that
would pay for one, and your diligence process will ask better questions than I would have
commissioned."*

⚠️ One of the declined gate's own `revisit:` triggers is **"the first B2B2C conversation with a
bank, wealth manager or benefits provider"**. That trigger fires the day this meeting happens —
recorded on `gates.g2-counsel-opinion.declined.revisit`.

---

## 2 · Accepted residual risk — Q4, Q5, Q7

These are **open risk, not future work**, and the g2 brief says so in its own header. They are about
the product as shipped and would apply whether or not `estate` existed.

**Q4 — credential release and third-party ToS.** Relay releases owner-stored credentials to a
recipient who may then log into a third party. Those third parties' terms typically prohibit
credential sharing, and unauthorised-access statutes sit behind ToS violations. Relay's exposure for
*facilitating* that, and the recipient's for doing it, is unopined.

*What the product does about it:* the owner designates specific items for specific people under
specific triggers; nothing is released without a configured rule; every release is
verifier-attested, audited on a hash-chained log, and **reversible**. That is mitigation, not a
defence, and it is described as mitigation.

**Q5 — does the analysis differ for a deceased owner?** ⚠️ **Yes, and the honest answer names the
gap rather than the feature.** `estate` is permanently withdrawn as a user-selectable trigger — but a
deceased owner's **emergency** trigger still fires on the missed-check-in sweep, verifiers confirm,
access opens, and **nothing closes it**, because only the owner can. `/terms` states this outright
("It does not stop when you do"). It is the sharpest unopined question in the product and it is not
softened here.

**Q7 — do the N-of-M verifiers take on a legal role by attesting?** Unopined. Verifier consent
language does not currently address it. A partner supplying verifiers from its own member base will
care about this more than we do, and should.

---

## 3 · Subprocessors

Derive rather than quote — `/privacy` is authoritative and is the page a partner will actually read:

```bash
grep -A 30 "Who else is involved" src/app/privacy/page.tsx
```

> 🔴 **This command returned NOTHING until 2026-08-31.** It grepped for the word *"subprocessor"*,
> and `/privacy` does not use it — the section is headed **"Who else is involved"**, in plain
> English, deliberately. So the first instruction in the pack handed to a partner produced an empty
> result, in the section whose entire argument is *derive rather than quote*.
>
> The page was right and the command was wrong, which is the more embarrassing way round: a reader
> following it would conclude the list does not exist. `lib/ops/diligence-pack.test.ts` now runs
> this exact grep and fails if it stops returning the vendors named below.

The shape: infrastructure and database (AWS), hosting (Vercel), transactional mail (Resend),
payments (Stripe), and an LLM provider used **on non-secret metadata only**. That last boundary is
enforced in code — `lib/ai/metadata-query.ts` is the sole accessor for the AI routes and excludes
ciphertext, wrapped keys and key ids — and it is worth showing, because "we don't send secrets to
the model" is a claim most vendors make in prose and few make in a module.

---

## 4 · Encryption, and the one limitation stated up front

**What holds:** per-item AES-GCM-256 generated in the browser, wrapped by an AWS KMS customer master
key. The server stores ciphertext and a wrapped key and never sees a plaintext data key. A recipient
decrypt unwraps only when the release state is `released` **and** an access rule links that recipient
to that item.

**🔴 The limitation, volunteered rather than discovered:** the CMK is **single-Region**
(`us-east-1`). The database fails over between two regions; the ability to decrypt does not. A
us-east-1 KMS impairment leaves the site up, the dashboard rendering, and Reveal alone failing.

- **Ruling:** knowingly accepted — `deferred.the-failover-does-not-carry-the-ability-to-decrypt`.
- **Reversal path:** a multi-Region CMK, costed and written up in `docs/kms-region-proposal.md`. It
  is an infrastructure change to a working system, so it carries the 5-gate policy and has not been
  taken unilaterally.

That combination — a named limitation, a dated ruling, and a written reversal path — is a better
diligence answer than an unqualified "encrypted at rest", and it is checkable.

---

## 5 · SOC 2 / DPA posture (G9)

**No SOC 2. No Type I, no Type II, none in progress.** A one-person product with a live service.

What exists instead, and can be demonstrated rather than asserted:

| | |
|---|---|
| Least privilege | Three separate identities; production cannot obtain database admin **by permission**, not merely by configuration. Re-measurable: `npm run verify:roles`, `npm run verify:iam` |
| Key custody | Daily automated check that the CMK is present, enabled, not pending deletion, and still grants only the runtime principal — and it has been seen to fail three ways |
| Audit | Append-only, hash-chained per owner. Audit writes **block** the operation they record, by design |
| Backups | Daily, with an **absence** alarm — the thing that alarms is the backup not happening |
| Incident process | `docs/security-incident-runbook.md`, evidence-first, with a one-command evidence bundle |
| Recovery | ⚠️ **The restore drill has not run yet.** Gate `d3-restore-drill`, due 2026-11-08 — stated because a partner will ask, and "we back up daily" without a proven restore is the answer that ages badly. ✅ **Pre-flighted 2026-08-31** and recorded on the gate: three of its four criteria hold today — the CMK is present, enabled and not pending deletion; a real decryptable item exists; both clusters are ACTIVE with deletion protection and backups 21.2h fresh, byte-identical across Regions. What is missing is the restore itself, to a scratch cluster. **Pre-flighted is not proven, and the gate says `preflight:` rather than `met:` for exactly that reason** |

**Verified live 2026-08-31, so a reader's spot-check does not find the first crack:**
`npm run verify:roles` — 3 roles across both Regions, the split intact, none holding DDL.
`npm run verify:kms` — the CMK Enabled, not pending deletion, policy still granting only the runtime
principal. `npm run verify:csp` — no product code blocked. Zero `UPDATE`/`DELETE` statements against
`audit_log` anywhere in the source, which is what "append-only" has to mean to survive a review.

**A DPA can be signed.** There is no entity — Steve Harlow trades as an individual — and a partner's
template is likely to be the practical route.

---

## 6 · What we want from the pilot

Stated so the meeting has a shape: **one design partner, a small cohort of their members, and
permission to learn from it.** Not a logo, not a reseller agreement, and not a signature at the first
meeting — `gates.g3-b2b2c-pilot-loi` measures a *meeting* first for exactly that reason.
