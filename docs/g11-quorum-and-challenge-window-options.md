# G11 — two design decisions with no owner ruling: options

**Drafted 2026-09-12** for `ROADMAP.md` §2-G row G11 / gap plan GP-U10. No code. Each option says what the code does today, what would change, what must **not** change, and a recommended default. Steve rules; Claude records on the register.

**What must not change under any option:** `PERMITTED_TRANSITIONS` stays at seven edges; ARMED stays the safe default; silence never resolves toward open; no migration is proposed (a barred option is marked as such).

## (a) Recovery and release quorums on one social graph (`docs/user-journeys.md` Part VI, decision table row 4)

**Today.** The *release* quorum is the verifier roster: N-of-M, `validateNofM` (`lib/release/provisioning.ts:112`, Property 8), counted over **confirmed** participants only (`docs/standby-architecture.md` §4.3), a verifier who is also a recipient on the same release does not count (§3.7 rule 6), the owner never counts (rule 7). *Recovery* is not a quorum at all: eight recovery codes regenerable from `/account` under step-up, plus the §3.6 break-glass single-use code for an unclaimed contact or a lost authenticator. "Social-recovery shares and time-locked recovery quorums" are Build Spec §20 Phase 2 — unbuilt, barred as G3.

| Option | What changes | Cost / risk | Note |
|---|---|---|---|
| **A1 — Keep them separate (recommended)** | Nothing. Recovery = codes + break-glass; social recovery stays in G3 behind its unlock | none | Matches principle 4 (no new state) and the demand gate; the question is answered by *not* coupling them until a stranger asks for social recovery |
| A2 — When social recovery is built, reuse the verifier roster as the recovery quorum | one graph, one setup; the same N people who can *open* the vault could also *reset the owner's authenticator* | coercion surface doubles: a colluding quorum gets both the contents and the account; Risk 3 (coercion) in the standby architecture argues the other way | Only ever a G3 decision; record the objection now so it is not re-derived |
| A3 — A distinct recovery roster | a second graph, second set of claims and confirmations | setup burden on an owner who already struggles to name one verifier (N = 0 since 08-12) | Also G3; note the burden |

**Ruling asked for now:** A1, with A2's objection recorded so G3 starts from it.

## (b) The owner-challenge window per trigger type (J6-R7)

**Today.** `CHALLENGE_WINDOW_SECONDS` (`lib/release/access-request.ts`): emergency 2 h · travel 4 h · business 4 h · caregiver 6 h · estate 72 h (unreachable — estate is not selectable). When the window lapses, the request becomes verifier-actionable (§4.4) — derived on read *and* by the hourly cron; both paths live-proven 2026-08-31 (B15.3, 22/22, `verify:escalation`). A lapse never releases anything; it asks the verifiers. The file's own comment says these are "starting proposals, not evidence".

| Option | What changes | Cost / risk | Note |
|---|---|---|---|
| **B1 — Ratify the table as shipped (recommended)** | Nothing; the comment becomes "ratified 2026-09-xx" | none | Proven on production; no observed case argues for a different number; Phase-0 will produce the first real data |
| B2 — Shorten emergency to 1 h | one constant | a real owner asleep for an hour has their verifiers contacted; nothing opens, but the circle is alarmed more often | Defer until a real request has been observed |
| B3 — Owner-configurable per trigger type | a column and a settings control | **needs a migration — barred (§7)**; also J5-R3's shape (per-trigger cadence), which is F-k | Not now |

**Ruling asked for now:** B1; revisit the numbers when the Phase-0 report or the first real access request gives a reason.
