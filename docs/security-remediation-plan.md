# Security remediation plan — replace hand-rolled crypto primitives (docs-only today)

> **SUPERSEDED BY `docs/security-remediation-plan.md` v2 on branch `exp/security-remediation`
> (2026-07-03, commit `254c21d`). Do NOT execute this v1** — the 7-03 staging run proved its jose
> section ("internals-only swap, tests unchanged") unimplementable: jose v6 is Promise-only, so
> the sync token interface cannot be preserved. v2 replaces it with the verified coordinated
> async migration design. TOTP (§ otplib) is already BUILT on that branch (`93ee10a`).

> Drafted 2026-07-03 on `exp/g1-caregiver-landing` (in-lock relay prep). Closes the 7-01 audit
> finding: "hand-rolled TOTP (RFC 6238) + hand-rolled HS256 JWTs — unaudited bespoke security
> primitives." **No code changes until the H0 verdict** (master is the judged artifact). Timing
> recommendation: do this FIRST post-verdict if the disposition is commercialize — it is cheap,
> and everything downstream (G4 billing, G5 audit) gets safer for free.

## Inventory (live-verified 2026-07-03)

| Module | Lines | Hand-rolled surface | Replacement |
|---|---|---|---|
| `lib/auth/totp.ts` | 119 | RFC 6238 TOTP (`generateTotpCode`, `validateTotpCode`) | **otplib** |
| `lib/auth/recipient-token.ts` | 197 | HS256 JWT sign/verify; payload carries `release_state_id` + `version` | **jose** (`SignJWT`/`jwtVerify`) |
| `lib/auth/verifier-token.ts` | 112 | same HS256 pattern (`issueVerifierToken`/`verifyVerifierToken`) | **jose** |

Existing tests: `totp.test.ts` (124) + `recipient-token.test.ts` (367) + `verifier-token.test.ts`
(48) = **539 lines, and they are the point**: they become the compatibility harness.

## Approach — adapter-first, wire-compatible

1. Keep every module's **exported API and payload shape identical**; swap only the internals.
   Existing property/unit tests must pass **UNCHANGED** — that is the acceptance gate. A test that
   needs editing to pass is a red flag, not a chore.
2. Wire compatibility requirements:
   - TOTP: same base32 `TOTP_SECRET`, 30s step, 6 digits, same skew window as the current
     implementation (read it off the code at build time — do not widen it silently).
   - JWTs: same claim names and semantics — especially the **version-invalidation invariant**
     (a token whose `version` ≠ current `release_state.version` is rejected; re-arm revokes
     access). This is a core correctness property, not a serialization detail.
3. Add negative-vector tests only (additive): `alg:none` rejection, tampered signature, wrong key,
   expired token, cross-token-type confusion (recipient token presented as verifier token).
4. Dependencies: `otplib` + `jose` — both widely audited, zero-native-dep, Edge/Node compatible.

## Explicitly out of scope here (tracked elsewhere)

- Third-party security audit + pen test → pre-GA milestone (audit's G5), scheduled once G4 exists.
- KMS custom key store / threshold secret-sharing / recovery quorums → spec §20 productionization,
  post-G3 scale work.
- NextAuth session hardening review → fold into the G5 audit scope.

## Estimate & sequencing

One session: swap internals + negative vectors + full-suite verify (405+ green, tsc, build).
Sequence: **verdict → this swap → G1 sends begin** (the landing is static, so the swap and the G1
test can also run in parallel without conflict). Before ANY paying customer regardless of path.
