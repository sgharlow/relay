# Security remediation plan v2 — replace hand-rolled crypto primitives

> **v2, 2026-07-03, on `exp/security-remediation`. SUPERSEDES v1 IN PLACE** (v1 drafted the same
> day on `exp/g1-caregiver-landing`, commit `2162947`; this file on this branch is now the single
> authoritative copy — the `exp/g1-caregiver-landing` copy is superseded and must not be executed).
>
> **Why a v2:** the 7-03 staging run (commit `93ee10a`) proved v1's jose section unimplementable
> as written. v1 demanded "swap internals to jose with the existing tests passing **UNCHANGED**" —
> but jose v6 is Promise-only (WebCrypto; it has no sync API), while `lib/auth/recipient-token.ts`
> and `lib/auth/verifier-token.ts` export **synchronous** functions consumed synchronously by 415
> lines of harness tests (`recipient-token.test.ts` 367 + `verifier-token.test.ts` 48) and by the
> production call sites. A sync→Promise change is a public-interface change, so "internals-only
> swap + tests unchanged" is self-contradictory. Also latent in v1: jose evaluates expiry via
> `new Date()` by default, which the harness's `vi.spyOn(Date, 'now')` clock mocking does **not**
> intercept — v1's gate would have failed even after an interface change. v2 replaces that section
> with the coordinated async migration design below, whose mechanisms were verified against the
> installed `jose@6.2.3` (types and dist source), not guessed.
>
> **Sequencing rule (binding):** execute **post-verdict only** — this is the first move after the
> H0 verdict disposition. No master pushes until then; master stays at `2614718`.
>
> **Claim ladder (honest state as of `93ee10a`):**
> - **TOTP swap = built** — otplib adapter shipped on this branch, adapter + harness tests green
>   (`vitest` 443/443 incl. 11/11 pre-existing `totp.test.ts` unchanged). *Not live-proven*: no
>   deployed environment has run the otplib path yet.
> - **Token (jose) migration = idea → designed** — no migration code exists; §B below is the
>   executable design. The 22 negative-vector tests exist and are green against the *current*
>   hand-rolled modules; they are the acceptance vectors for the migration.

---

## ✅ §B EXECUTED 2026-08-08 — and two ways this plan had gone stale

Both modules now sign and verify through jose. All four §B.6 gate items pass: 22/22 negative
vectors and the full recipient/verifier harness green under **mechanical sync→async edits only**
(no assertion message, vector, secret or clock mechanism was touched — verify with
`git show --stat`), full suite + `tsc --noEmit` + `next build` clean, and the completeness grep
returns zero un-awaited call sites.

**Two corrections future readers need, because this plan was written 2026-07-03 and executed after
six more sprints landed:**

1. **§B.4 says "all five production sites — exhaustive, grep-verified". There were TEN.** Sprints
   2–6 added `lib/access/closure.ts`, `api/access/code/route.ts`, `api/access-requests/route.ts`,
   `api/verify/code/route.ts` and `api/verify/[token]/route.ts`. Its line numbers had drifted too.
   **Three of the five it missed produced NO TypeScript error** — `closure.ts` because an
   `as unknown as` cast swallowed the type, and the two `code` routes because `NextResponse.json()`
   accepts anything. Those three would have shipped a `Promise` serialised as `{}` into a live
   token field: a recipient or verifier emailed a link that could never work, discovered by a
   stranger mid-emergency. This is precisely why §B.6 item 4 demands a grep and not a clean `tsc`.
   **An exhaustive list in a plan is only exhaustive on the day it was written — re-derive it.**

2. **jose was 4.15.9, not the 6.2.3 the plan verified against** — and it was only present as
   next-auth's transitive dependency, never a direct one. Now pinned directly at ^6 (6.2.8). Every
   §B.2/§B.3 mechanism was re-verified against what is actually installed: `currentDate` at
   `types.d.ts:618` (not :545), the `epoch(currentDate || new Date())` fallback at
   `jwt_claims_set.js:121` (not :137), `exp <= now - tolerance` at :132 (not :154). The mechanisms
   hold exactly as designed; only the citations had rotted.

**One check this plan did not ask for, and should have:** tokens issued by the OLD code are still
in flight when the new code deploys — recipient links live 24h, verifier links 72h. Every other
test issues and verifies with the same implementation, so both halves would move together and
agree perfectly while agreeing with nothing already sitting in someone's inbox.
`lib/auth/token-migration-compat.test.ts` issues with the pre-migration hand-rolled algorithm and
verifies with jose. It was confirmed able to fail: injecting `requiredClaims: ['jti']` turned it
red, and removing it turned it green again.

**Still not live-proven at time of writing** — deployed, but no real recipient or verifier link has
been round-tripped against production since the swap. That is the next check, not an assumption.

## Inventory (live-verified 2026-07-03)

| Module | Hand-rolled surface | Replacement | Status |
|---|---|---|---|
| `lib/auth/totp.ts` | RFC 6238 TOTP (`generateTotpCode`, `validateTotpCode`) | **otplib v13** | ✅ **DONE** (`93ee10a`, built) |
| `lib/auth/recipient-token.ts` | sync HS256 JWT sign/verify; claims carry `releaseStateId` + `version` (24h TTL) | **jose v6** (`SignJWT`/`jwtVerify`) | designed (§B) |
| `lib/auth/verifier-token.ts` | same sync HS256 pattern (`issueVerifierToken`/`verifyVerifierToken`, 72h TTL) | **jose v6** | designed (§B) |

---

## A. TOTP — ✅ DONE (shipped in `93ee10a`)

`lib/auth/totp.ts` internals replaced with otplib v13 behind the **exact** existing exported
interface (`generateTotpCode`/`validateTotpCode`, base32-or-hex `TOTP_SECRET`, 30s step, 6 digits,
±1-step skew window). Evidence:

- Pre-existing `totp.test.ts` passes **UNCHANGED** (11/11) — the compatibility harness held.
- New additive `lib/auth/totp.adapter.test.ts`: RFC 6238 Appendix B known-answer vectors,
  hex/base32 secret equivalence, exact-window pinning.
- **Behavior delta (accepted, strictly tighter):** otplib enforces a **≥16-byte secret**
  guardrail the hand-rolled code lacked. A `TOTP_SECRET` under 16 bytes now throws at use.
  Env secrets are 20 bytes, so no production impact; anyone provisioning a new environment must
  respect the floor.

Remaining for this section: nothing to build. Rides the normal post-verdict deploy to become
live-proven.

---

## B. Recipient/verifier tokens — COORDINATED ASYNC MIGRATION to jose (designed)

v1's "internals-only" constraint is dropped. The modules, their five production call sites, and
the three test files migrate **together in one change** — that is the only shape jose v6 permits.

### B.1 New module signatures (the public interface change)

`lib/auth/recipient-token.ts`:

```ts
export async function issueRecipientToken(
  recipientId: string,
  releaseStateId: string,
  version: bigint,
): Promise<string>;

export async function verifyRecipientToken(token: string): Promise<RecipientTokenPayload>;
```

`lib/auth/verifier-token.ts`:

```ts
export async function issueVerifierToken(
  verifierId: string,
  releaseStateId: string,
): Promise<string>;

export async function verifyVerifierToken(token: string): Promise<VerifierTokenPayload>;
```

Payload types (`RecipientTokenPayload`, `VerifierTokenPayload`), claim names/semantics, TTLs
(24h / 72h), HS256, env-var secrets, and the **version-invalidation invariant** (token `version`
≠ current `release_state.version` ⇒ rejected; re-arm revokes access) are all **unchanged**. The
secret continues to be read per-call from `process.env` (`Buffer.from(secret, 'utf8')` is a
`Uint8Array`, which jose accepts directly as an HS256 key).

### B.2 Clock handling — the verified mechanism (do not deviate)

Verified against installed `jose@6.2.3`:

- `jwtVerify` accepts **`currentDate?: Date`** — "Date to use when comparing NumericDate claims,
  defaults to `new Date()`" (`node_modules/jose/dist/types/types.d.ts:545`; used at
  `dist/webapi/lib/jwt_claims_set.js:137-138`: `const now = epoch(currentDate || new Date())`).
- `SignJWT.setIssuedAt(input?)` / `.setExpirationTime(input)` accept explicit epoch-second
  numbers (`dist/types/jwt/sign.d.ts:27-28`); with **no** argument, `setIssuedAt()` also falls
  back to `new Date()`.

`new Date()` does **not** route through `Date.now`, so both defaults are invisible to the
harness's `vi.spyOn(global.Date, 'now')`. Therefore, inside the modules:

- **Issue:** compute `const now = Math.floor(Date.now() / 1000)` and pass it explicitly:
  `.setIssuedAt(now).setExpirationTime(now + TOKEN_TTL_SECONDS)`.
- **Verify:** pass `currentDate: new Date(Date.now())` in the `jwtVerify` options.

Both paths then flow through `Date.now()`, which **is** interceptable — the existing tests keep
their `vi.spyOn(Date, 'now')` clock mechanism verbatim (no fake-timer rewrite, no injected-clock
parameter added to the public API). Leave `clockTolerance` unset (0): jose's expiry comparison is
`payload.exp <= now - tolerance` (`jwt_claims_set.js:154`), which at tolerance 0 is exactly the
current strict `exp <= now` rejection — the `exp === now` negative vector stays valid.

### B.3 Error-contract preservation (required for the acceptance gate)

The 22 negative-vector tests assert **message substrings**. jose's raw errors do not all match
(e.g. `JWTExpired.message` is `'"exp" claim timestamp check failed'` — no "expired";
`JWSSignatureVerificationFailed.message` is `'signature verification failed'` — compatible).
Each module therefore keeps its thin validation shell and translates:

1. **Keep the pre-checks, in the current order, before calling jose:** 3-segment structural
   check (`'expected three dot-separated segments'`), header base64url/JSON decode check, and the
   explicit `alg === 'HS256'` header check (`'unsupported algorithm'`). This preserves the pinned
   precedence: a downgraded-alg token with a garbage signature must fail on **alg**, not
   signature.
2. **Delegate signature + expiry to `jwtVerify(token, secret, { algorithms: ['HS256'], currentDate: new Date(Date.now()) })`**,
   catching jose errors and re-throwing the existing messages keyed on `err.code`:
   - `ERR_JWT_EXPIRED` → `'Invalid token: token has expired'`
   - `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` → `'Invalid token: signature verification failed'`
   - `ERR_JWS_INVALID` / `ERR_JWT_INVALID` / anything else → the module's existing structural
     message (fallback `'Invalid token: signature verification failed'` is NOT acceptable here —
     map structural failures to the structural messages the harness pins).
3. **Claim-presence checks stay app-level, after jose:** `recipientId` / `releaseStateId` /
   `version` (recipient) and `verifierId` / `releaseStateId` (verifier) — these produce the
   `'missing … claim'` messages the shared-secret cross-type-confusion vectors pin.

### B.4 Call-site changes (all five production sites — exhaustive, grep-verified)

| # | Site | Current | Edit |
|---|---|---|---|
| 1 | `lib/access/dashboard.ts:92-98` (`verifyTokenOr403`) and its callers `:150`, `:191` | sync helper returns `verifyRecipientToken(token)` inside try/catch | helper becomes `async function verifyTokenOr403(token: string)` with `return await verifyRecipientToken(token);` (the `await` **inside** the `try` is load-bearing — without it the rejection escapes the catch and the 403 mapping breaks). Callers `getAccessDashboard` (:150) and `decryptAccessItem` (:191) are already `async`; each adds `await`: `const payload = await verifyTokenOr403(token);` |
| 2 | `lib/notify/notifications.ts:48` (`notifyRecipientsOfRelease`) | sync `issueRecipientToken(...)` inside a `.map()` already wrapped in `Promise.all` | make the map callback async: `recipients.rows.map(async (r) => { const token = await issueRecipientToken(r.id, params.releaseStateId, BigInt(params.version)); … return sendEmailBestEffort({ … }); })` — `Promise.all` shape and best-effort semantics unchanged |
| 3 | `lib/notify/notifications.ts:80` (`notifyVerifiersForTrigger`) | same pattern with `issueVerifierToken(v.id, releaseStateId)` | identical shape: `verifiers.map(async (v) => { const token = await issueVerifierToken(v.id, releaseStateId); … })` |
| 4 | `src/app/api/triggers/[id]/confirm/route.ts:32` | `payload = verifyVerifierToken(token);` inside try/catch in the (already async) `POST` | `payload = await verifyVerifierToken(token);` (await inside the `try`, keeping the 403 mapping) |
| 5 | `src/app/api/kms/unwrap/route.ts:56` | `payload = verifyRecipientToken(token);` inside try/catch in the (already async) `POST` | `payload = await verifyRecipientToken(token);` (same rule) |

Doc follow-up (non-code): the `npx tsx -e` snippet at `docs/e2e-verification.md:116` calls
`issueRecipientToken` synchronously — update it to `await` in the same change.

### B.5 Harness migration (the three test files — mechanical, no semantic edits)

Files: `lib/auth/recipient-token.test.ts` (367 lines), `lib/auth/verifier-token.test.ts` (48),
`lib/auth/token-negative-vectors.test.ts` (count via `npx vitest --run lib/auth/token-negative-vectors.test.ts`). Two mechanical transforms only:

- Happy-path calls: `const token = issueRecipientToken(…)` → `const token = await issueRecipientToken(…)`;
  same for `verify*` result assertions (`(await verifyVerifierToken(token)).verifierId` …).
- Throw assertions: `expect(() => verifyX(token)).toThrow('…')` →
  `await expect(verifyX(token)).rejects.toThrow('…')` (and issuance-throw cases likewise:
  `await expect(issueRecipientToken(…)).rejects.toThrow(…)` for the missing-secret tests).
- **Clock mocking: unchanged.** Because of §B.2, every `vi.spyOn(global.Date, 'now')` block keeps
  working as-is — that is the design's point. If any clock test fails, the module deviated from
  §B.2; fix the module, not the test.
- Assertion messages, secrets, vectors, and test names: **unchanged**. A message edit means §B.3's
  translation table was implemented wrong.

### B.6 ACCEPTANCE GATE (v2 — replaces v1's contradictory gate)

1. All **22 negative-vector tests in `lib/auth/token-negative-vectors.test.ts` pass against the
   jose implementation** with only the mechanical sync→async edits of §B.5 — no assertion-message
   changes, no clock-mechanism changes, no vector deletions.
2. The 415-line recipient/verifier harness passes under the same mechanical-edit-only rule.
3. Full suite green (`npx vitest --run`; 443 as of `93ee10a` — rederive, don't quote), plus
   `npx tsc --noEmit` clean and `next build` clean.
4. Grep proof of completeness: `grep -rn "issueRecipientToken\|verifyRecipientToken\|issueVerifierToken\|verifyVerifierToken" --include="*.ts"`
   shows zero remaining un-awaited call sites outside the modules.

---

## Explicitly out of scope here (tracked elsewhere — unchanged from v1)

- Third-party security audit + pen test → pre-GA milestone (audit's G5), scheduled once G4 exists.
- KMS custom key store / threshold secret-sharing / recovery quorums → spec §20 productionization,
  post-G3 scale work.
- NextAuth session hardening review → fold into the G5 audit scope.

## Estimate & sequencing

Section A is done. Section B is **one post-verdict session**: modules + five call sites + three
test files land as a single commit, gated by §B.6. Sequence: **verdict disposition → §B migration
→ G1 sends begin** (the G1 landing is static, so §B and the G1 test can run in parallel without
conflict). Complete before ANY paying customer regardless of disposition path.
