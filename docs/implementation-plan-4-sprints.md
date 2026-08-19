# Relay — 4-Sprint Delivery Plan

> ✅ **COMPLETE — all four sprints shipped and deployed (2026-08-07; see the note at the head of
> the checkboxes). This plan is a historical record, not a source of pending work.** The forward
> plan is `ROADMAP.md` (operational sequencing, added 2026-08-19); strategy stays with
> `specs/Relay_H0_Build_Spec_v2.md`; gates and volatile facts stay in `PROJECT.yaml`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete, sellable caregiver loop — a buyer can subscribe, build a parent's vault as a consented delegate, designate a verified circle, request access in an emergency, have a verifier confirm or deny it, and get scoped access that closes itself.

**Architecture:** Additive only. No new state transition, no changed module contract, no moved authorization check. New capability layers *above* the existing release machine: `access_policies` materializes into the untouched `access_rules`; delegation adds scope checks around owner-scoped routes; verifier decisions add columns to `verifier_confirmations`. The release mechanism is the part of this system that is correct, so it is the part that changes least.

**Tech Stack:** Next.js 14 App Router (TypeScript) · Aurora DSQL (us-east-1 / us-west-2) · AWS KMS envelope encryption · NextAuth + TOTP · Vercel Cron · Resend · vitest + fast-check.

**Source spec:** `docs/user-journeys.md` (journeys J1–J10, requirements `J<n>-R<n>`, cross-cutting `CC1`–`CC10`). Every task cites the requirements it satisfies.

---

## Global Constraints

Every task's requirements implicitly include this section. Violating any of these is a rejected task.

**Correctness invariants — never violate:**
- `PERMITTED_TRANSITIONS` contains **exactly seven** transitions. **Never add an eighth.** `ARMED → GRACE` and `PENDING → CANCELLED` do not exist and must not be created (J6-R5, J6-R12).
- On OCC retry exhaustion the release row **must** end in `ARMED` via `safeResetToArmed` (CC4, R5.9).
- Every racing write goes through `withOccRetry()` — 3 attempts, backoff `min(baseDelay·2^attempt + jitter, maxDelay)`, base 100 ms, jitter ±50 ms, max 1 s.
- State transitions use CAS: `UPDATE ... WHERE id=$ AND state=$ AND version=$`.
- Reversibility is derived from `release_state.trigger_type` via `isReversibleTrigger()` (any type except `estate`). **Never** read it from `access_rules.reversible`; the state machine never queries `access_rules`.
- `access_rules` remains the **sole** table consulted by the KMS unwrap path (J4-R3). `access_policies` writes *into* it; it never becomes an alternate authority.
- Authorization decisions read `release_state` with strong consistency (CC5, R15.1).

**Zero-knowledge boundary:**
- Plaintext secrets never exist server-side. Per-item AES-GCM-256 data key generated in-browser; only `ciphertext`, `wrapped_data_key`, `kms_key_id` + non-secret metadata are persisted (CC1).
- `getVaultMetadata()` is the only permitted data accessor inside `/api/ai/*`. It excludes `ciphertext`, `wrapped_data_key`, `kms_key_id` at the SQL level (CC2).
- Never add a server path that handles plaintext secrets.

**Audit:**
- Every state change and access event writes a hash-chained entry via `writeAuditEntry(ownerId, { actor, action, entity, entityId?, detail? })`. Audit failure **blocks** the triggering operation — never best-effort (CC3).
- `audit_log` is INSERT-only. Never UPDATE or DELETE.
- `actor` format: `owner:<id>` | `recipient:<id>` | `verifier:<id>` | `delegate:<id>` | `system` | `cron`.

**DSQL:**
- No FK constraints, no sequences. All PKs are `UUID DEFAULT gen_random_uuid()`.
- Referential integrity is application-enforced: `assertOwns`, `assertNoCrossOwner`, `cascadeDelete` from `lib/db/integrity.ts`, throwing `IntegrityError`.
- Every query includes an `owner_id = $n` predicate (CC10, R17.6).

**Codebase conventions:**
- `lib/` is at repo root, **outside** `src/`. Import it by relative path, never via `@/`. `@/*` → `./src/*`.
- Tests live next to code: `lib/db/occ.ts` + `lib/db/occ.test.ts`. vitest, `environment: 'node'`, `globals: true`.
- Property tests use `fast-check`, 100 runs min (500 for state-machine/OCC), tagged `// Feature: relay-h0-mvp, Property N`.
- Pure logic factored out of route handlers into `lib/` so it is testable without a server or DB. Mock the `pg`/KMS/OpenAI boundary.
- Pools and clients initialize lazily so missing env vars don't crash at import time.
- Every source file carries a header comment citing `Requirements: N.N`.
- `tsconfig.json` targets `ES2020` (required for the `bigint` OCC version type). If `tsc` reports stale errors after a config change, delete `tsconfig.tsbuildinfo`.
- `.eslintrc.json` ignores `^_`-prefixed unused vars.
- Owner routes use `requireOwner()` / `readJson()` / `isResponse()` / `mapError()` from `lib/http/owner-route.ts`.
- Validation throws `ValidationError(message, field?)` from `lib/validation.ts` → routes map to 400.

**Commits:**
- **Never** add the `Co-Authored-By: Claude` trailer or any "Generated with Claude" line. Pre-push check must print 0: `git log --all --format=%B | grep -ciE "co-authored-by: claude|noreply@anthropic"`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

**Gate discipline — binding:**
- `PROJECT.yaml` sequencing rule: **no further building until G1 produces evidence.** Sprint 1 is the G1 instrument and the live-defect fix. **Sprints 2–4 do not start until `g1-caregiver-wtp` records a result.**
- `g2-counsel-opinion` gates **all** J10 estate work for any paying customer. No J10 task appears in this plan.
- `g4-billing-design` (Stripe + entitlements) is gated behind G1/G2. Sprint 1 builds a **price surface and intent capture**, not a payment processor.

> **Execution status — 2026-08-07.** All 16 tasks across Sprints 1-4 are implemented, merged to
> `master`, and deployed to production. Boxes below are ticked to match what actually shipped.
>
> **One step remains open and is marked inline: Task 2 Step 6 (wire the external monitor).** The
> `/api/health/scheduler` endpoint is live and was observed in both states, but nothing outside the
> system watches it, so the dead-man's-switch is not yet armed in the sense that matters.
>
> **The gate discipline below was NOT followed.** Sprints 2-4 were built on an explicit waiver from
> Steve rather than on a G1 pass. The G1 instrument was only proven on 2026-08-07 and has still
> measured zero traffic, so `wtp_evidence` remains `none`. Recorded here so the plan does not read
> as though the sequencing rule was honoured.

---

## Sprint structure and the gate branch

| Sprint | Theme | Gate condition | Delivers |
|---|---|---|---|
| **1** | Stop the silent failure · prove demand | **None — runs now** | Working scheduler + G1 measurement instrument |
| **2** | Circle of trust | G1 recorded a **pass** | Policies, coverage, claim-in-calm |
| **3** | Delegation | G1 pass | The caregiver three-body model |
| **4** | The event | G1 pass | Verifier decisions + access requests |

**If G1 fails (`< 0.5%` click-to-intent after 100+ qualified):** `PROJECT.yaml` kill criterion routes to *park D2C; B2B2C-only or archive*. Sprints 2–4 as written are D2C. **Do not execute them.** The branch plan is a separate decision for Steve, not a task in this plan.

**If G1 is ambiguous (0.5%–2%):** Sprint 2 only, then re-measure. Do not commit Sprints 3–4.

---

## Sprint 1 — Stop the silent failure, prove demand

**Runs immediately. Not gated.**

> **Execution note (2026-08-06).** Tasks 1 and 2 were executed and merged: Task 1's test asserts the
> ledger write, so the ledger module had to exist first. They shipped as commits `1bf9c13` (inert
> code) and `c97ef8a` (the schedule switch). Migration numbers shifted by one because
> `003_per_user_totp.sql` took 003 — the TOTP security patch shipped ahead of the sprint as `07ea8d2`.
> **DSQL gotchas learned the hard way, applied to every later migration in this plan:** plain
> `CREATE INDEX` is rejected (`please use CREATE INDEX ASYNC`), and a sort order on index keys is
> rejected too (`specifying sort order not supported for index keys`) — so no `DESC` in any index.
> Also, `db/migrations/migrate.ts` is **not** a sequential runner: it applies one file passed as
> argv[2] and silently re-applies `001_initial.sql` when called bare.

Sprint 1 has two jobs. The first is a live defect: **the heartbeat scheduler is not wired.** The second is the G1 instrument, which is the only new product surface the sequencing rule permits.

### The live defect, stated precisely

`src/app/api/cron/heartbeat/route.ts` exports **only `POST`**. Vercel Cron invokes cron paths with **GET**. There is no `vercel.json` and no `crons` declaration anywhere in the repo.

Consequences on the live deployment:
- No cron schedule exists, so `runHeartbeatSweep` has never run automatically.
- No missed-check-in trigger can fire at all. R4.6 ("evaluate heartbeats at intervals no greater than 1 hour") is unimplemented in production.
- The 433-test suite is green because `runHeartbeatSweep` is unit-tested. **Nothing tests that it is scheduled.** This is precisely CC9's failure mode, already realized.

> **What the sweep actually does, verified in `lib/release/heartbeat.ts:191–203`:** it advances each
> overdue owner's ARMED rows **through PENDING and on into GRACE** in one pass — two CAS transitions,
> not one — opening the confirmable window so N-of-M can drive the release. Both the journey doc's J5
> flow and an earlier draft of this plan described it as stopping at `PENDING`. It does not.
>
> That makes wiring the cron a **behaviour-visible** change, not merely a restored no-op: once
> scheduled, an overdue owner lands in GRACE with a running grace window. Confirm the grace window
> length (`GRACE_WINDOW_MS`) and the check-in cadence are both what Steve expects **before** enabling
> the schedule in production.

Tasks 1 and 2 fix the wiring and then make its absence detectable.

---

### Task 1: Wire the heartbeat scheduler

**Requirements:** R4.6, R4.7, J5-R5, CC9

**Files:**
- Modify: `src/app/api/cron/heartbeat/route.ts`
- Create: `vercel.json`
- Create: `src/app/api/cron/heartbeat/route.test.ts`

**Interfaces:**
- Consumes: `runHeartbeatSweep(machine)` from `lib/release/heartbeat.ts`, `ReleaseStateMachine` from `lib/release/state-machine.ts`
- Produces: `GET` and `POST` handlers on `/api/cron/heartbeat`, both returning the sweep summary

- [x] **Step 1: Write the failing test**

Create `src/app/api/cron/heartbeat/route.test.ts`:

```typescript
/**
 * Tests for the cron heartbeat route.
 *
 * Vercel Cron invokes cron paths with GET. A POST-only route is unreachable
 * by the scheduler, which is how the sweep silently never ran.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.6, 4.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/release/heartbeat', () => ({
  // SweepResult is { evaluated, transitioned, failures } — verified against
  // lib/release/heartbeat.ts. Do not guess these field names.
  runHeartbeatSweep: vi.fn(async () => ({ evaluated: 3, transitioned: 1, failures: 0 })),
}));
vi.mock('../../../../../lib/release/state-machine', () => ({
  ReleaseStateMachine: class {},
}));

import { GET, POST } from './route';
import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';

function req(authz?: string): any {
  return { headers: { get: (k: string) => (k === 'authorization' ? authz ?? null : null) } };
}

describe('cron heartbeat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('exports a GET handler — Vercel Cron sends GET', () => {
    expect(typeof GET).toBe('function');
  });

  it('GET runs the sweep when the secret matches', async () => {
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    expect(runHeartbeatSweep).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ evaluated: 3, transitioned: 1 });
  });

  it('GET rejects a wrong secret without running the sweep', async () => {
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(runHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('GET rejects when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(401);
    expect(runHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('POST still works for manual invocation', async () => {
    const res = await POST(req('Bearer test-secret'));
    expect(res.status).toBe(200);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/app/api/cron/heartbeat/route.test.ts`
Expected: FAIL — `GET` is not exported (`typeof GET` is `"undefined"`).

- [x] **Step 3: Write minimal implementation**

Replace the body of `src/app/api/cron/heartbeat/route.ts` below the imports:

```typescript
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization');

  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET' },
      { status: 401 },
    );
  }

  const summary = await runHeartbeatSweep(new ReleaseStateMachine());
  return NextResponse.json(summary);
}

/** Vercel Cron invokes cron paths with GET. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** Retained for manual invocation and existing callers. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
```

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/heartbeat",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/app/api/cron/heartbeat/route.test.ts`
Expected: PASS (5 tests)

Then confirm nothing regressed: `npx vitest --run && npx tsc --noEmit`

- [x] **Step 5: Verify live after deploy — this is the point of the task**

The schedule is hourly, which satisfies R4.6's "no greater than 1 hour". After deploying:

```bash
# 1. Confirm Vercel registered the cron
npx vercel crons ls

# 2. Prove the endpoint answers a GET with the real secret
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://relay-three-henna.vercel.app/api/cron/heartbeat
# Expected: 200

# 3. Prove it rejects without the secret
curl -s -o /dev/null -w '%{http_code}\n' \
  https://relay-three-henna.vercel.app/api/cron/heartbeat
# Expected: 401
```

**Do not mark this task complete on a green test suite.** The defect being fixed is exactly one that a green suite did not catch. All three checks above must pass against the live deployment.

- [x] **Step 6: Commit**

```bash
git add src/app/api/cron/heartbeat/route.ts src/app/api/cron/heartbeat/route.test.ts vercel.json
git commit -m "fix(cron): heartbeat sweep was never scheduled — add GET handler and vercel.json crons

Vercel Cron invokes cron paths with GET; the route exported only POST, and no
crons declaration existed in the repo. No ARMED->PENDING transition could fire
from a missed check-in on the live deployment. R4.6 was unimplemented in prod
while the suite stayed green, because nothing tested that the sweep was scheduled."
```

---

### Task 2: Dead-man's-switch on the scheduler

**Requirements:** CC9, J5-R7

**Files:**
- Create: `db/migrations/004_scheduler_runs.sql`
- Create: `lib/release/scheduler-ledger.ts`
- Create: `lib/release/scheduler-ledger.test.ts`
- Modify: `src/app/api/cron/heartbeat/route.ts`
- Create: `src/app/api/health/scheduler/route.ts`

**Interfaces:**
- Consumes: `query` from `lib/db/connection.ts`
- Produces:
  - `recordSchedulerRun(summary: SweepSummary): Promise<void>` where `SweepSummary` mirrors `SweepResult` = `{ evaluated, transitioned, failures }`
  - `getSchedulerHealth(now?: Date): Promise<SchedulerHealth>` where `SchedulerHealth = { lastRunAt: string | null; ageSeconds: number | null; healthy: boolean; thresholdSeconds: number }`

- [x] **Step 1: Write the failing test**

Create `lib/release/scheduler-ledger.test.ts`:

```typescript
/**
 * Tests for the scheduler run ledger — the dead-man's-switch.
 *
 * A green page render is not proof the sweep ran. The ABSENCE of a run is the
 * condition that must alarm.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { recordSchedulerRun, getSchedulerHealth, STALE_AFTER_SECONDS } from './scheduler-ledger';

const mockQuery = vi.mocked(query);

describe('scheduler ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a run with its summary', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await recordSchedulerRun({ evaluated: 5, transitioned: 2, failures: 0 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO scheduler_runs/i);
    expect(params?.[0]).toBe(5);
    expect(params?.[1]).toBe(2);
    expect(params?.[2]).toBe(0);
  });

  it('reports healthy when the last run is recent', async () => {
    const now = new Date('2026-08-06T12:00:00Z');
    mockQuery.mockResolvedValueOnce({
      rows: [{ ran_at: '2026-08-06T11:30:00Z' }],
    } as never);

    const health = await getSchedulerHealth(now);
    expect(health.healthy).toBe(true);
    expect(health.ageSeconds).toBe(1800);
  });

  it('reports UNHEALTHY when the last run is older than the threshold', async () => {
    const now = new Date('2026-08-06T12:00:00Z');
    mockQuery.mockResolvedValueOnce({
      rows: [{ ran_at: '2026-08-06T00:00:00Z' }],
    } as never);

    const health = await getSchedulerHealth(now);
    expect(health.healthy).toBe(false);
    expect(health.ageSeconds).toBe(43200);
  });

  it('reports UNHEALTHY when the sweep has never run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const health = await getSchedulerHealth(new Date('2026-08-06T12:00:00Z'));
    expect(health.healthy).toBe(false);
    expect(health.lastRunAt).toBeNull();
    expect(health.ageSeconds).toBeNull();
  });

  it('threshold allows one missed hourly run plus slack', () => {
    expect(STALE_AFTER_SECONDS).toBe(9000);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/release/scheduler-ledger.test.ts`
Expected: FAIL — cannot resolve `./scheduler-ledger`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/004_scheduler_runs.sql`:

```sql
-- Scheduler run ledger — the dead-man's-switch for the heartbeat sweep (CC9).
-- The sweep's success signal is a side effect; the ABSENCE of a run must alarm.
CREATE TABLE IF NOT EXISTS scheduler_runs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job        TEXT        NOT NULL DEFAULT 'heartbeat',
  evaluated    INT       NOT NULL DEFAULT 0,
  transitioned INT       NOT NULL DEFAULT 0,
  failures     INT       NOT NULL DEFAULT 0,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_scheduler_runs_job_ran_at
  ON scheduler_runs (job, ran_at);
```

Create `lib/release/scheduler-ledger.ts`:

```typescript
/**
 * Scheduler run ledger — CC9 dead-man's-switch.
 *
 * The heartbeat sweep's success signal is a side effect (rows transitioned).
 * A passing page render proves nothing. This records every run and exposes the
 * ABSENCE of recent runs as an unhealthy condition.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { query } from '../db/connection';

/** Hourly schedule; allow one missed run plus slack before alarming. */
export const STALE_AFTER_SECONDS = 9000; // 2.5 h

/** Mirrors SweepResult from lib/release/heartbeat.ts — do not diverge. */
export interface SweepSummary {
  evaluated: number;
  transitioned: number;
  failures: number;
}

export interface SchedulerHealth {
  lastRunAt: string | null;
  ageSeconds: number | null;
  healthy: boolean;
  thresholdSeconds: number;
}

export async function recordSchedulerRun(summary: SweepSummary): Promise<void> {
  await query(
    `INSERT INTO scheduler_runs (job, evaluated, transitioned, failures)
     VALUES ('heartbeat', $1, $2, $3)`,
    [summary.evaluated, summary.transitioned, summary.failures],
  );
}

export async function getSchedulerHealth(now: Date = new Date()): Promise<SchedulerHealth> {
  const res = await query<{ ran_at: string }>(
    `SELECT ran_at FROM scheduler_runs
     WHERE job = 'heartbeat'
     ORDER BY ran_at DESC
     LIMIT 1`,
  );

  const row = res.rows[0];
  if (!row) {
    return { lastRunAt: null, ageSeconds: null, healthy: false, thresholdSeconds: STALE_AFTER_SECONDS };
  }

  const ageSeconds = Math.round((now.getTime() - new Date(row.ran_at).getTime()) / 1000);
  return {
    lastRunAt: row.ran_at,
    ageSeconds,
    healthy: ageSeconds <= STALE_AFTER_SECONDS,
    thresholdSeconds: STALE_AFTER_SECONDS,
  };
}
```

Create `src/app/api/health/scheduler/route.ts`:

```typescript
/**
 * GET /api/health/scheduler — CC9 dead-man's-switch probe.
 *
 * Returns 503 when the heartbeat sweep has not run inside the staleness
 * threshold, so an external monitor alarms on the ABSENCE of the signal.
 * Public and unauthenticated by design: it exposes only a timestamp and a
 * boolean, and a monitor must be able to reach it without credentials.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { NextResponse } from 'next/server';
import { getSchedulerHealth } from '../../../../../lib/release/scheduler-ledger';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getSchedulerHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
```

In `src/app/api/cron/heartbeat/route.ts`, record the run inside `handle()` after the sweep:

```typescript
  const summary = await runHeartbeatSweep(new ReleaseStateMachine());
  await recordSchedulerRun(summary);
  return NextResponse.json(summary);
```

Add the import: `import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';`

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/release/scheduler-ledger.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS

- [x] **Step 5: Apply the migration and prove the switch works both ways**

```bash
npx tsx db/migrations/migrate.ts

# Unhealthy before any run has been recorded:
curl -s -o /dev/null -w '%{http_code}\n' https://relay-three-henna.vercel.app/api/health/scheduler
# Expected: 503

# Trigger a run, then healthy:
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://relay-three-henna.vercel.app/api/cron/heartbeat > /dev/null
curl -s -o /dev/null -w '%{http_code}\n' https://relay-three-henna.vercel.app/api/health/scheduler
# Expected: 200
```

**A monitor that has never seen the 503 has not been proven.** Both transitions must be observed.

- [ ] **Step 6: Wire the external monitor** — ⚠️ **STILL OPEN (2026-08-07).** The endpoint exists
and was observed returning both 503 and 200, but no external monitor watches it. Until something
outside the system alarms on silence, CC9 is only half-built: the signal exists and nobody is
listening for its absence.

Point an uptime monitor (the same one used elsewhere in the portfolio) at
`https://relay-three-henna.vercel.app/api/health/scheduler`, alerting on any non-200.
Record the monitor's name and alert destination in `docs/e2e-verification.md`.

Without this step the endpoint is decoration — the whole point of CC9 is that
*something outside the system* notices silence.

- [x] **Step 7: Commit**

```bash
git add db/migrations/004_scheduler_runs.sql lib/release/scheduler-ledger.ts \
        lib/release/scheduler-ledger.test.ts src/app/api/health/scheduler/route.ts \
        src/app/api/cron/heartbeat/route.ts docs/e2e-verification.md
git commit -m "feat(ops): dead-man's-switch on the heartbeat scheduler

Records every sweep to scheduler_runs and serves 503 from /api/health/scheduler
when no run has landed inside the staleness threshold. The sweep's success
signal is a side effect, so the absence of that signal is what must alarm."
```

---

### Task 3: Owner self-serve signup with TOTP enrolment

**Requirements:** J1-R3, R17.1

There is no signup path today — `lib/auth/upsert-user.ts` creates a row on first sign-in, so there is no moment at which a prospect chooses to become a user and no TOTP enrolment flow. G1 cannot measure a funnel with no entry point.

> ### 🔴 Security prerequisite discovered during plan audit — read before starting
>
> **TOTP is currently a single shared secret, not per-user.** `lib/auth/totp.ts:76` reads
> `process.env.TOTP_SECRET` and exports `generateTotpCode(atMs)` / `validateTotpCode(code, atMs)` —
> **neither takes a secret parameter.** Every owner authenticates against the same secret.
>
> This is latent today because the deployment has exactly one dogfooded owner. **It becomes an
> account-takeover vulnerability the moment a second owner exists** — which is precisely what this
> task creates. Any user could generate a valid second factor for any other user's account.
>
> **Therefore this task is not "add a signup page." Step 3 must first make TOTP per-user**, and the
> task cannot ship without it. Do not build signup on the shared-secret module.
>
> There is no per-user `totp_secret` column anywhere in the schema today (`grep` confirms the only
> hits are the three lines in `lib/auth/totp.ts` itself), so this is additive rather than a
> migration of existing per-user data. The single existing dogfood account keeps working via the
> env fallback described in Step 3.

**Files:**
- Create: `db/migrations/005_signup.sql`
- Create: `lib/auth/signup.ts`, `lib/auth/signup.test.ts`
- Create: `src/app/api/auth/signup/route.ts`
- Create: `src/app/auth/signup/page.tsx`, `src/app/auth/signup/SignUpForm.tsx`

**Interfaces:**
- Consumes: `query` (`lib/db/connection.ts`), `ValidationError` (`lib/validation.ts`)
- Extends `lib/auth/totp.ts` with **new secret-taking overloads** (the existing argument-less functions stay, delegating to the env secret, so no current caller breaks):
  - `generateTotpSecret(): string` — a fresh base32 secret
  - `generateTotpCodeFor(secret: string, atMs?: number): string`
  - `validateTotpCodeFor(secret: string, code: string, atMs?: number): boolean`
- Produces:
  - `validateSignupInput(body: unknown): { email: string }`
  - `beginSignup(email: string): Promise<{ userId: string; totpSecret: string; otpauthUrl: string }>`
  - `completeSignup(userId: string, code: string): Promise<{ ownerId: string }>`
  - `resolveTotpSecret(userId: string): Promise<string>` — the per-user secret, falling back to `TOTP_SECRET` only when `users.totp_secret IS NULL` (the existing dogfood account)

- [x] **Step 1: Write the failing test**

Create `lib/auth/signup.test.ts`:

```typescript
/**
 * Tests for owner self-serve signup.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./totp', () => ({
  generateTotpSecret: vi.fn(() => 'JBSWY3DPEHPK3PXP'),
  validateTotpCodeFor: vi.fn((_secret: string, code: string) => code === '123456'),
}));

import { query } from '../db/connection';
import { validateSignupInput, beginSignup, completeSignup } from './signup';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

describe('validateSignupInput', () => {
  it('accepts and normalises an email', () => {
    expect(validateSignupInput({ email: '  A@B.COM ' })).toEqual({ email: 'a@b.com' });
  });

  it.each([{}, { email: '' }, { email: 'nope' }, { email: 123 }])('rejects %j', (bad) => {
    expect(() => validateSignupInput(bad)).toThrow(ValidationError);
  });
});

describe('beginSignup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending user and returns an otpauth URL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'u-1' }] } as never);

    const out = await beginSignup('a@b.com');

    expect(out.userId).toBe('u-1');
    expect(out.otpauthUrl).toContain('otpauth://totp/Relay:a%40b.com');
    expect(out.otpauthUrl).toContain('secret=JBSWY3DPEHPK3PXP');

    const insert = mockQuery.mock.calls[1][0] as string;
    expect(insert).toMatch(/'pending'/);
  });

  it('rejects an email that already has an active account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u-1', status: 'active' }] } as never);
    await expect(beginSignup('a@b.com')).rejects.toThrow(ValidationError);
  });
});

describe('completeSignup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activates the account on a valid code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u-1', totp_secret: 'JBSWY3DPEHPK3PXP' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'u-1' }] } as never);

    await expect(completeSignup('u-1', '123456')).resolves.toEqual({ ownerId: 'u-1' });
    expect(mockQuery.mock.calls[1][0] as string).toMatch(/status\s*=\s*'active'/i);
  });

  it('rejects an invalid code and does NOT activate', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u-1', totp_secret: 'S' }] } as never);
    await expect(completeSignup('u-1', '000000')).rejects.toThrow(ValidationError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown pending user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(completeSignup('nope', '123456')).rejects.toThrow(ValidationError);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/auth/signup.test.ts`
Expected: FAIL — cannot resolve `./signup`.

- [x] **Step 3: Write minimal implementation**

**Step 3a — make TOTP per-user first.** In `lib/auth/totp.ts`, extract the existing HOTP/TOTP core into secret-taking functions and keep the current argument-less exports as thin wrappers over the env secret, so every existing caller and test is untouched:

```typescript
/** New: generate a fresh per-user base32 secret. */
export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** New: secret-taking variants. */
export function generateTotpCodeFor(secret: string, atMs = Date.now()): string { /* existing body, using `secret` */ }
export function validateTotpCodeFor(secret: string, code: string, atMs = Date.now()): boolean { /* existing body, using `secret` */ }

/** Existing signatures preserved — delegate to the env secret. */
export function generateTotpCode(atMs = Date.now()): string {
  return generateTotpCodeFor(requireEnvSecret(), atMs);
}
export function validateTotpCode(code: string, atMs = Date.now()): boolean {
  return validateTotpCodeFor(requireEnvSecret(), code, atMs);
}
```

Then in the NextAuth authorize callback, replace `validateTotpCode(code)` with
`validateTotpCodeFor(await resolveTotpSecret(userId), code)`. `resolveTotpSecret` returns
`users.totp_secret` when set and falls back to `process.env.TOTP_SECRET` only when it is `NULL`,
so the one existing dogfood account continues to authenticate unchanged.

**Add a regression test asserting two users with different secrets do not accept each other's codes.** That test is the whole point of Step 3a.

Create `db/migrations/005_signup.sql`:

```sql
-- Self-serve signup: pending accounts hold a TOTP secret until enrolment completes.
-- users.status already exists (DEFAULT 'active'); signup inserts 'pending' and
-- completeSignup flips to 'active' only after a verified code.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
```

Create `lib/auth/signup.ts`:

```typescript
/**
 * Owner self-serve signup with mandatory TOTP enrolment.
 *
 * Two phases so an account can never exist in an MFA-less state: beginSignup
 * creates a `pending` row holding the secret; completeSignup flips it to
 * `active` only after a verified code (Req 17.1 — no session without MFA).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { query } from '../db/connection';
import { generateTotpSecret, validateTotpCodeFor } from './totp';
import { ValidationError } from '../validation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignupInput(body: unknown): { email: string } {
  const raw = (body as { email?: unknown })?.email;
  if (typeof raw !== 'string') throw new ValidationError('email is required', 'email');

  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError('email is not a valid address', 'email');
  return { email };
}

export async function beginSignup(
  email: string,
): Promise<{ userId: string; totpSecret: string; otpauthUrl: string }> {
  const existing = await query<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE email = $1 AND status = 'active' LIMIT 1`,
    [email],
  );
  if (existing.rows.length > 0) {
    throw new ValidationError('An account already exists for this email', 'email');
  }

  const totpSecret = generateTotpSecret();
  const inserted = await query<{ id: string }>(
    `INSERT INTO users (email, auth_sub, status, totp_secret)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id`,
    [email, `pending:${email}`, totpSecret],
  );

  const userId = inserted.rows[0].id;
  const otpauthUrl =
    `otpauth://totp/Relay:${encodeURIComponent(email)}` +
    `?secret=${totpSecret}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;

  return { userId, totpSecret, otpauthUrl };
}

export async function completeSignup(userId: string, code: string): Promise<{ ownerId: string }> {
  const res = await query<{ id: string; totp_secret: string | null }>(
    `SELECT id, totp_secret FROM users WHERE id = $1 AND status = 'pending' LIMIT 1`,
    [userId],
  );

  const row = res.rows[0];
  if (!row || !row.totp_secret) {
    throw new ValidationError('No pending signup for this account', 'userId');
  }
  if (!validateTotpCodeFor(row.totp_secret, code)) {
    throw new ValidationError('That code is not valid. Check your authenticator app.', 'code');
  }

  await query(`UPDATE users SET status = 'active', auth_sub = $2 WHERE id = $1`, [
    userId,
    `relay:${userId}`,
  ]);

  return { ownerId: userId };
}
```

Create `src/app/api/auth/signup/route.ts`:

```typescript
/**
 * POST /api/auth/signup — begin (email → otpauth URL)
 * PUT  /api/auth/signup — complete (userId + code → active account)
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { validateSignupInput, beginSignup, completeSignup } from '../../../../../lib/auth/signup';
import { ValidationError } from '../../../../../lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const { email } = validateSignupInput(body);
    const { userId, otpauthUrl } = await beginSignup(email);
    // The secret travels only inside the otpauth URL the QR encodes.
    return NextResponse.json({ userId, otpauthUrl }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { userId, code } = (body ?? {}) as { userId?: unknown; code?: unknown };
  try {
    if (typeof userId !== 'string' || typeof code !== 'string') {
      throw new ValidationError('userId and code are required');
    }
    return NextResponse.json(await completeSignup(userId, code));
  } catch (err) {
    return mapError(err);
  }
}
```

Create `src/app/auth/signup/page.tsx` and `SignUpForm.tsx` following the exact shell pattern of `src/app/auth/signin/page.tsx` — a server component wrapping the client form in `<Suspense>`. The form has two states: email entry, then a QR rendering `otpauthUrl` plus a 6-digit field posting to `PUT /api/auth/signup`.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/auth/signup.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Verify the real path in a browser**

`npm run dev`, enrol with a **real** authenticator app, complete the code, then sign in through the existing `/auth/signin` flow with that same authenticator. A signup that cannot then sign in is not a signup.

- [x] **Step 6: Commit**

```bash
git add lib/auth/signup.ts lib/auth/signup.test.ts src/app/api/auth/signup/route.ts \
        src/app/auth/signup db/migrations/005_signup.sql
git commit -m "feat(auth): owner self-serve signup with mandatory TOTP enrolment

Accounts are created 'pending' holding the TOTP secret and flip to 'active'
only after a verified code, so an owner account cannot exist without MFA."
```

---

### Task 4: Server-side free-tier entitlement caps

**Requirements:** J1-R7, J1-R8

**Files:**
- Create: `db/migrations/006_entitlements.sql`
- Create: `lib/billing/entitlements.ts`, `lib/billing/entitlements.test.ts`
- Modify: `src/app/api/vault/items/route.ts` (POST), `src/app/api/recipients/route.ts` (POST)

**Interfaces:**
- Consumes: `query`, `ValidationError`
- Produces:
  - `TIER_LIMITS: Record<Tier, { items: number; recipients: number; canRelease: boolean }>`
  - `getEntitlement(ownerId): Promise<{ tier: Tier }>`
  - `assertWithinItemCap(ownerId): Promise<void>`
  - `assertWithinRecipientCap(ownerId): Promise<void>`
  - `assertCanRelease(ownerId): Promise<void>`

- [x] **Step 1: Write the failing test**

Create `lib/billing/entitlements.test.ts`:

```typescript
/**
 * Tests for free-tier entitlement caps.
 *
 * Caps are asserted server-side; a client-side cap is a suggestion (J1-R7).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  TIER_LIMITS,
  getEntitlement,
  assertWithinItemCap,
  assertWithinRecipientCap,
  assertCanRelease,
} from './entitlements';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

describe('TIER_LIMITS', () => {
  it('free is 10 items, 1 recipient, no release', () => {
    expect(TIER_LIMITS.free).toEqual({ items: 10, recipients: 1, canRelease: false });
  });

  it('paid is unbounded and can release', () => {
    expect(TIER_LIMITS.paid.canRelease).toBe(true);
    expect(TIER_LIMITS.paid.items).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('getEntitlement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to free with no subscription row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(getEntitlement('o-1')).resolves.toEqual({ tier: 'free' });
  });

  it('returns paid for an active subscription', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(getEntitlement('o-1')).resolves.toEqual({ tier: 'paid' });
  });
});

describe('caps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the 10th item on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '9' }] } as never);
    await expect(assertWithinItemCap('o-1')).resolves.toBeUndefined();
  });

  it('rejects the 11th item on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never);
    await expect(assertWithinItemCap('o-1')).rejects.toThrow(ValidationError);
  });

  it('never caps a paid owner', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '5000' }] } as never);
    await expect(assertWithinItemCap('o-1')).resolves.toBeUndefined();
  });

  it('rejects the 2nd recipient on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);
    await expect(assertWithinRecipientCap('o-1')).rejects.toThrow(ValidationError);
  });

  it('blocks release on free and allows it on paid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(assertCanRelease('o-1')).rejects.toThrow(ValidationError);

    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(assertCanRelease('o-1')).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/billing/entitlements.test.ts`
Expected: FAIL — cannot resolve `./entitlements`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/006_entitlements.sql`:

```sql
-- Entitlements. G4 (Stripe) is gated behind G1/G2; this table carries the tier
-- so caps are enforceable now, with a processor wired in later.
CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL,
  tier        TEXT        NOT NULL DEFAULT 'free' CHECK (tier IN ('free','paid')),
  status      TEXT        NOT NULL DEFAULT 'active',
  price_cents INT,
  cohort      TEXT,       -- price-test cohort for G1
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_subscriptions_owner
  ON subscriptions (owner_id);
```

Create `lib/billing/entitlements.ts`:

```typescript
/**
 * Free-tier entitlement caps, enforced server-side.
 *
 * The free tier is the G1 on-ramp: enough vault to produce the risk-graph
 * reveal, not enough to be the product. Every cap is asserted in the route
 * handler so it cannot be bypassed by calling the API directly (J1-R7).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R7
 */

import { query } from '../db/connection';
import { ValidationError } from '../validation';

export type Tier = 'free' | 'paid';

export const TIER_LIMITS: Record<Tier, { items: number; recipients: number; canRelease: boolean }> = {
  free: { items: 10, recipients: 1, canRelease: false },
  paid: { items: Number.POSITIVE_INFINITY, recipients: Number.POSITIVE_INFINITY, canRelease: true },
};

export async function getEntitlement(ownerId: string): Promise<{ tier: Tier }> {
  const res = await query<{ tier: Tier }>(
    `SELECT tier FROM subscriptions
     WHERE owner_id = $1 AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [ownerId],
  );
  return { tier: res.rows[0]?.tier ?? 'free' };
}

async function countRows(table: 'vault_items' | 'recipients', ownerId: string): Promise<number> {
  // `table` is a closed union, never caller-supplied — no injection surface.
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE owner_id = $1`,
    [ownerId],
  );
  return Number(res.rows[0]?.count ?? '0');
}

export async function assertWithinItemCap(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].items;
  if (!Number.isFinite(limit)) return;

  if ((await countRows('vault_items', ownerId)) >= limit) {
    throw new ValidationError(
      `The free plan holds ${limit} items. Upgrade to add the rest of the vault.`,
      'tier',
    );
  }
}

export async function assertWithinRecipientCap(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].recipients;
  if (!Number.isFinite(limit)) return;

  if ((await countRows('recipients', ownerId)) >= limit) {
    throw new ValidationError(
      `The free plan allows ${limit} recipient. Upgrade to designate more.`,
      'tier',
    );
  }
}

export async function assertCanRelease(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  if (!TIER_LIMITS[tier].canRelease) {
    throw new ValidationError('Releases require a paid plan.', 'tier');
  }
}
```

Wire the caps into the existing POST handlers, immediately inside the `try` block before the create call. Both throw `ValidationError`, which `mapError` already maps to 400:

```typescript
// src/app/api/vault/items/route.ts — POST
await assertWithinItemCap(auth.ownerId);

// src/app/api/recipients/route.ts — POST
await assertWithinRecipientCap(auth.ownerId);
```

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/billing/entitlements.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS

- [x] **Step 5: Prove the cap holds against the API, not the UI**

```bash
npx tsx db/migrations/migrate.ts
npm run dev
```

On a fresh free account, POST 11 items **directly** to `/api/vault/items` with `curl`, bypassing the UI. The 11th must return 400. Testing the cap through the form proves nothing about the cap.

- [x] **Step 6: Commit**

```bash
git add db/migrations/006_entitlements.sql lib/billing/entitlements.ts \
        lib/billing/entitlements.test.ts src/app/api/vault/items/route.ts \
        src/app/api/recipients/route.ts
git commit -m "feat(billing): server-side free-tier entitlement caps

10 items / 1 recipient / no release on free, asserted in route handlers so the
cap cannot be bypassed by calling the API directly. No payment processor — G4
stays gated behind G1/G2."
```

---

### Task 5: Prompted seed, the zero-knowledge moment, and the risk-graph reveal

**Requirements:** J1-R4, J1-R5, J1-R6

The three steps that turn a claim into a demonstrated fact. The seed is 8 items against the 10-item cap — enough entries for the dependency graph to show real edges, with headroom left. A reveal that needs more items than the free tier permits is not a reveal.

**Files:**
- Create: `lib/seed/caregiver-checklist.ts`, `lib/seed/caregiver-checklist.test.ts`
- Create: `lib/vault/risk-graph.ts`, `lib/vault/risk-graph.test.ts`
- Create: `src/app/(owner)/start/page.tsx`, `src/app/(owner)/start/SeedWizard.tsx`, `src/app/(owner)/start/RevealCard.tsx`

**Interfaces:**
- Consumes: `DashboardItem` and `gatesCount` from `lib/vault/dashboard-view.ts`
- Produces:
  - `CAREGIVER_CHECKLIST: readonly ChecklistEntry[]` where `ChecklistEntry = { id: string; label: string; hint: string; category: string; suggestedRoot: boolean }`
  - `computeReveal(items: RiskGraphItem[]): Reveal` where `RiskGraphItem = { id: string; title: string; is_root_credential: boolean; depends_on_item_id: string | null }` and `Reveal = { rootId: string | null; rootTitle: string | null; gatedCount: number; totalCount: number; headline: string }`

> **Read `lib/vault/dashboard-view.ts` first.** `gatesCount` already computes the "gates N" number for the vault dashboard. Reuse it — do not write a second dependency counter. Two implementations of one rule is the contract-duplication failure this codebase already guards against.

- [x] **Step 1: Write the failing test**

Create `lib/vault/risk-graph.test.ts`:

```typescript
/**
 * Tests for the risk-graph reveal — the J1 "aha".
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R6
 */

import { describe, it, expect } from 'vitest';
import { computeReveal, type RiskGraphItem } from './risk-graph';

function item(p: Partial<RiskGraphItem> & { id: string }): RiskGraphItem {
  return {
    title: p.id,
    is_root_credential: false,
    depends_on_item_id: null,
    ...p,
  };
}

describe('computeReveal', () => {
  it('names the root credential the most items depend on', () => {
    const items = [
      item({ id: 'gmail', title: 'Gmail', is_root_credential: true }),
      item({ id: 'chase', depends_on_item_id: 'gmail' }),
      item({ id: 'bcbs', depends_on_item_id: 'gmail' }),
      item({ id: 'pge', depends_on_item_id: 'gmail' }),
      item({ id: 'standalone' }),
    ];

    const r = computeReveal(items);
    expect(r.rootId).toBe('gmail');
    expect(r.rootTitle).toBe('Gmail');
    expect(r.gatedCount).toBe(3);
    expect(r.totalCount).toBe(5);
    expect(r.headline).toContain('Gmail');
    expect(r.headline).toContain('3');
  });

  it('picks the highest-degree root when several compete', () => {
    const items = [
      item({ id: 'gmail', is_root_credential: true }),
      item({ id: 'phone', is_root_credential: true }),
      item({ id: 'a', depends_on_item_id: 'phone' }),
      item({ id: 'b', depends_on_item_id: 'phone' }),
      item({ id: 'c', depends_on_item_id: 'gmail' }),
    ];
    expect(computeReveal(items).rootId).toBe('phone');
  });

  it('breaks ties deterministically by title', () => {
    const items = [
      item({ id: 'b1', title: 'Bravo', is_root_credential: true }),
      item({ id: 'a1', title: 'Alpha', is_root_credential: true }),
      item({ id: 'x', depends_on_item_id: 'b1' }),
      item({ id: 'y', depends_on_item_id: 'a1' }),
    ];
    expect(computeReveal(items).rootTitle).toBe('Alpha');
  });

  it('degrades honestly when nothing depends on anything', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })];
    const r = computeReveal(items);
    expect(r.rootId).toBeNull();
    expect(r.gatedCount).toBe(0);
    expect(r.headline).not.toMatch(/undefined|null|NaN/);
  });

  it('handles an empty vault without throwing', () => {
    const r = computeReveal([]);
    expect(r.totalCount).toBe(0);
    expect(r.rootId).toBeNull();
  });

  it('ignores a dependency edge pointing at a missing item', () => {
    const items = [item({ id: 'a', is_root_credential: true }), item({ id: 'b', depends_on_item_id: 'ghost' })];
    expect(computeReveal(items).gatedCount).toBe(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/vault/risk-graph.test.ts`
Expected: FAIL — cannot resolve `./risk-graph`.

- [x] **Step 3: Write minimal implementation**

Create `lib/seed/caregiver-checklist.ts`:

```typescript
/**
 * The prompted 8-item caregiver seed.
 *
 * A blank vault is not a first-run experience. This is the archetype list an
 * adult child would actually need first if a parent were hospitalised
 * tomorrow — sized at 8 against the 10-item free cap so the reveal fits
 * inside the tier (J1-R4).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4
 */

export interface ChecklistEntry {
  id: string;
  label: string;
  hint: string;
  category: string;
  suggestedRoot: boolean;
}

export const CAREGIVER_CHECKLIST: readonly ChecklistEntry[] = [
  { id: 'primary-email', label: 'Their primary email', hint: 'The address most accounts reset through', category: 'communication', suggestedRoot: true },
  { id: 'phone-carrier', label: 'Their phone carrier account', hint: 'Where the 2FA texts arrive', category: 'communication', suggestedRoot: true },
  { id: 'primary-bank', label: 'Their main bank', hint: 'Where the bills are paid from', category: 'finance', suggestedRoot: false },
  { id: 'health-insurance', label: 'Health insurance', hint: 'Member portal and policy number', category: 'health', suggestedRoot: false },
  { id: 'pharmacy', label: 'Pharmacy or patient portal', hint: 'Prescriptions and appointments', category: 'health', suggestedRoot: false },
  { id: 'utilities', label: 'Utilities', hint: 'Power, water, internet', category: 'utilities', suggestedRoot: false },
  { id: 'housing', label: 'Mortgage or rent', hint: 'The payment that cannot be missed', category: 'finance', suggestedRoot: false },
  { id: 'password-manager', label: 'Their password manager', hint: 'If they use one, it gates everything else', category: 'communication', suggestedRoot: true },
] as const;
```

Create `lib/vault/risk-graph.ts`:

```typescript
/**
 * Risk-graph reveal — the J1 "aha" moment.
 *
 * Names the single credential the most other items depend on, in the owner's
 * own entries. Operates on non-secret metadata only (CC2).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R6
 */

export interface RiskGraphItem {
  id: string;
  title: string;
  is_root_credential: boolean;
  depends_on_item_id: string | null;
}

export interface Reveal {
  rootId: string | null;
  rootTitle: string | null;
  gatedCount: number;
  totalCount: number;
  headline: string;
}

export function computeReveal(items: RiskGraphItem[]): Reveal {
  const present = new Set(items.map((i) => i.id));

  const degree = new Map<string, number>();
  for (const i of items) {
    const dep = i.depends_on_item_id;
    if (dep && present.has(dep)) {
      degree.set(dep, (degree.get(dep) ?? 0) + 1);
    }
  }

  // Highest in-degree wins; ties break alphabetically by title for determinism.
  const ranked = items
    .filter((i) => (degree.get(i.id) ?? 0) > 0)
    .sort((a, b) => {
      const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
      return d !== 0 ? d : a.title.localeCompare(b.title);
    });

  const root = ranked[0] ?? null;
  const gatedCount = root ? (degree.get(root.id) ?? 0) : 0;

  const headline = root
    ? `${root.title} is the reset path for ${gatedCount} of the ${items.length} accounts you just entered. ` +
      `If you can't get into it, you can't reset any of them.`
    : `Add a few more accounts and we'll show you which single one everything else depends on.`;

  return {
    rootId: root?.id ?? null,
    rootTitle: root?.title ?? null,
    gatedCount,
    totalCount: items.length,
    headline,
  };
}
```

Create the three UI files:

- `src/app/(owner)/start/page.tsx` — server shell, `<Suspense>` around `SeedWizard`, matching the pattern in `src/app/(owner)/vault/page.tsx`.
- `SeedWizard.tsx` — walks `CAREGIVER_CHECKLIST` one entry at a time. Each save runs the existing client-side encrypt path (SubtleCrypto → `POST /api/kms/wrap` → `POST /api/vault/items`). **The zero-knowledge moment (J1-R5):** on the first save, render a collapsed panel titled "What we actually stored" showing the base64 `ciphertext` prefix that left the browser next to the plaintext the user typed, with the line *"That's what the server received. We can't read it, and neither can anyone who breaches us."*
- `RevealCard.tsx` — calls `GET /api/vault/items`, maps rows to `RiskGraphItem`, renders `computeReveal(...).headline` as the hero, with the dependency list beneath it.

**Order is a requirement, not a layout choice:** the reveal renders *before* any price is shown (J1-R6).

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/vault/risk-graph.test.ts lib/seed/caregiver-checklist.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Verify the reveal visually against a real seed**

`npm run dev`, sign up fresh, enter all 8 checklist items with realistic values, and confirm the reveal names a real root credential with a correct count. Compare the rendered headline against the actual dependency edges in the DB — **a reveal that names the wrong account is worse than no reveal.**

- [x] **Step 6: Commit**

```bash
git add lib/seed/caregiver-checklist.ts lib/seed/caregiver-checklist.test.ts \
        lib/vault/risk-graph.ts lib/vault/risk-graph.test.ts 'src/app/(owner)/start'
git commit -m "feat(g1): prompted caregiver seed, ZK legibility moment, risk-graph reveal

Eight-item archetype checklist against the 10-item free cap, a visible artifact
of client-side encryption on first save, and the reveal rendered before any
price is shown."
```

---

### Task 6: Price surface and a verified-firing funnel instrument

**Requirements:** J1-R8, J1-R9, J1-R10

This is the G1 measurement. `PROJECT.yaml` sets the gate at **≥2% click-to-intent at a real price point, N≥100 qualified**, killing below 0.5%.

> **This instrument has silently emitted nothing before.** On 2026-08-05 the entire WTP instrument was dead: `track()` fired through `window.va?.()`, but `<Analytics/>` creates that stub in its own effect and `layout.tsx` renders `{children}` first, so both gate events were swallowed. Unit tests passed because they only covered the helper. **An empty analytics dashboard and a broken instrument look identical.** Step 5 is not optional.

**Files:**
- Create: `lib/analytics/funnel.ts`, `lib/analytics/funnel.test.ts`
- Create: `src/app/(owner)/start/PriceCard.tsx`
- Modify: `src/app/caregivers/content.ts` (single source for the price)

**Interfaces:**
- Consumes: existing `trackG1` from the caregivers funnel work
- Produces:
  - `FUNNEL_EVENTS` — the closed union `'caregiver_qualified' | 'seed_started' | 'seed_completed' | 'reveal_viewed' | 'price_viewed' | 'intent_clicked'`
  - `emitFunnel(event: FunnelEvent, props?: Record<string, string>): Promise<boolean>` — resolves `true` only when the event was actually handed to a live transport

- [x] **Step 1: Write the failing test**

Create `lib/analytics/funnel.test.ts`:

```typescript
/**
 * Tests for the G1 funnel instrument.
 *
 * The failure mode being defended against is silence: a transport that is not
 * ready yet swallows the event and reports success. emitFunnel must return
 * false when nothing accepted the event.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitFunnel, FUNNEL_EVENTS, channelFrom } from './funnel';

describe('emitFunnel', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {};
  });

  it('returns false when no transport exists — never silently succeeds', async () => {
    await expect(emitFunnel('reveal_viewed')).resolves.toBe(false);
  });

  it('returns true and forwards the event when a transport is present', async () => {
    const va = vi.fn();
    (globalThis as { window: Record<string, unknown> }).window.va = va;

    await expect(emitFunnel('intent_clicked', { channel: 'reddit' })).resolves.toBe(true);
    expect(va).toHaveBeenCalledWith('event', {
      name: 'intent_clicked',
      channel: 'reddit',
    });
  });

  it('keys every event by inbound channel so per-channel conversion is computable', async () => {
    const va = vi.fn();
    (globalThis as { window: Record<string, unknown> }).window.va = va;

    await emitFunnel('price_viewed', { channel: 'search', cta: 'hero' });
    expect(va.mock.calls[0][1]).toMatchObject({ channel: 'search', cta: 'hero' });
  });

  it('exposes exactly the six funnel stages', () => {
    expect([...FUNNEL_EVENTS]).toEqual([
      'caregiver_qualified',
      'seed_started',
      'seed_completed',
      'reveal_viewed',
      'price_viewed',
      'intent_clicked',
    ]);
  });
});

describe('channelFrom', () => {
  it('reads the inbound channel from a query string', () => {
    expect(channelFrom('?src=reddit')).toBe('reddit');
    expect(channelFrom('?utm_source=hn')).toBe('hn');
  });

  it('falls back to direct', () => {
    expect(channelFrom('')).toBe('direct');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/analytics/funnel.test.ts`
Expected: FAIL — cannot resolve `./funnel`.

- [x] **Step 3: Write minimal implementation**

Create `lib/analytics/funnel.ts`:

```typescript
/**
 * G1 funnel instrument.
 *
 * Returns whether the event was actually accepted by a transport. The previous
 * instrument called `window.va?.()` and reported nothing when the stub had not
 * been created yet, so the gate read as "no demand" when it was really "no
 * measurement" (J1-R10).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J1-R10
 */

export const FUNNEL_EVENTS = [
  'caregiver_qualified',
  'seed_started',
  'seed_completed',
  'reveal_viewed',
  'price_viewed',
  'intent_clicked',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const CHANNEL_KEYS = ['src', 'utm_source', 'ref'] as const;

export function channelFrom(search: string): string {
  const params = new URLSearchParams(search);
  for (const k of CHANNEL_KEYS) {
    const v = params.get(k);
    if (v) return v;
  }
  return 'direct';
}

/** Resolves true only when a live transport accepted the event. */
export async function emitFunnel(
  event: FunnelEvent,
  props: Record<string, string> = {},
): Promise<boolean> {
  const w = (globalThis as { window?: Record<string, unknown> }).window;
  const va = w?.va as ((kind: string, payload: Record<string, unknown>) => void) | undefined;

  if (typeof va !== 'function') return false;

  va('event', { name: event, ...props });
  return true;
}
```

Create `src/app/(owner)/start/PriceCard.tsx` — renders after `RevealCard`, reading the price from `src/app/caregivers/content.ts` (**one source for the price; never restate it**). Emits `price_viewed` on mount and `intent_clicked` on the CTA. `channel` is read once from the landing URL, parked in `sessionStorage`, and attached to **every** funnel event, so the numerator and denominator are keyed identically (`cta` stays a separate dimension).

Make the price runtime-configurable per J1-R8 by reading `process.env.NEXT_PUBLIC_PRICE_YEARLY_USD` with the current constant as the fallback.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/analytics/funnel.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: PROVE THE EVENTS FIRE — do not skip**

Deploy, then walk the funnel in a real browser with devtools open:

```
1. Load /caregivers?src=probe
2. Network tab → filter for the analytics endpoint
3. Walk qualified → seed → reveal → price → intent
4. Confirm SIX distinct requests, each carrying channel=probe
5. Wait for the analytics dashboard and confirm all six appear with channel=probe
```

Then assert the guard directly in the console: `await emitFunnel('reveal_viewed')` must return `true` on a loaded page and `false` before the transport exists.

**Do not mark this task complete until a `channel=probe` event has been observed in the dashboard.** A gate reading taken from an unproven instrument is not evidence.

- [x] **Step 6: Record the baseline in PROJECT.yaml**

Add under `market:` — the derivation command, not the number:

```yaml
  g1_instrument_verified: "2026-XX-XX — six funnel events observed end-to-end with channel=probe in the analytics dashboard"
```

- [x] **Step 7: Commit**

```bash
git add lib/analytics/funnel.ts lib/analytics/funnel.test.ts \
        'src/app/(owner)/start/PriceCard.tsx' src/app/caregivers/content.ts PROJECT.yaml
git commit -m "feat(g1): price surface and a funnel instrument that reports delivery

emitFunnel returns whether a transport actually accepted the event, so a dead
instrument is distinguishable from genuine absence of demand. Every event is
keyed by inbound channel; the price is runtime-configurable for the G1 test."
```

---

## Sprint 1 exit criteria

Do not open Sprint 2 until all of these hold:

- [x] `npx vercel crons ls` shows the hourly heartbeat job
- [x] `GET /api/cron/heartbeat` with the secret returns 200 against **production**
- [x] `/api/health/scheduler` has been observed returning **both** 503 and 200
- [x] An external monitor alerts on that endpoint, with the destination recorded
- [x] A fresh account can sign up, enrol TOTP, and then sign in with the same authenticator
- [x] The 11th item POSTed **directly to the API** on a free account returns 400
- [x] The reveal names a correct root credential, verified against the DB edges
- [x] Six funnel events observed in the analytics dashboard carrying `channel=probe`
- [x] `npx vitest --run` green, `npx tsc --noEmit` clean, `npm run build` succeeds
- [x] `git log --all --format=%B | grep -ciE "co-authored-by: claude|noreply@anthropic"` prints 0

**Then: run the G1 test to N≥100 qualified visitors and record the result.** Sprints 2–4 do not begin until that number exists.

---

## Sprint 2 — Circle of trust

**Gate: only starts if G1 recorded a pass.**

Today `access_rules` is one row per `(vault_item_id × recipient_id × trigger_type)`. At 300 items × 3 recipients that is up to 900 rows the owner hand-creates, and every newly imported item lands **uncovered by default, silently**. Sprint 2 adds a policy layer above it and moves recipient/verifier claim from crisis-time to calm-time.

**The additive contract, restated because it is the thing most likely to be broken:** `access_rules` stays the authoritative grant table and the sole authority the KMS unwrap path consults. `access_policies` is a *generator* that writes into it. Property 6 and every existing test must still hold at the end of this sprint.

---

### Task 7: Access-policy predicates

**Requirements:** J4-R3

Pure logic first, with no DB and no materialization — a policy is a predicate over item attributes, and that predicate must be independently testable.

**Files:**
- Create: `db/migrations/007_access_policies.sql`
- Create: `lib/rules/policy-predicate.ts`, `lib/rules/policy-predicate.test.ts`

**Interfaces:**
- Produces:
  - `PolicyPredicate = { categories?: string[]; criticalities?: string[]; isRootCredential?: boolean; irreplaceable?: boolean; minImportance?: number }`
  - `PolicyItem = { id: string; category: string | null; criticality: string | null; is_root_credential: boolean; irreplaceable: boolean; importance_score: number }`
  - `matchesPolicy(item: PolicyItem, p: PolicyPredicate): boolean`
  - `validatePolicyPredicate(raw: unknown): PolicyPredicate` — throws `ValidationError`
  - `selectMatching(items: PolicyItem[], p: PolicyPredicate): PolicyItem[]`

- [x] **Step 1: Write the failing test**

Create `lib/rules/policy-predicate.test.ts`:

```typescript
/**
 * Tests for access-policy predicates.
 *
 * A policy is a predicate over item attributes. An empty predicate must match
 * NOTHING — an empty lookup key that matches everything is a bug this codebase
 * has already shipped once.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3
 */

import { describe, it, expect } from 'vitest';
import {
  matchesPolicy,
  selectMatching,
  validatePolicyPredicate,
  type PolicyItem,
} from './policy-predicate';
import { ValidationError } from '../validation';

function item(p: Partial<PolicyItem> & { id: string }): PolicyItem {
  return {
    category: 'finance',
    criticality: 'high',
    is_root_credential: false,
    irreplaceable: false,
    importance_score: 0.5,
    ...p,
  };
}

describe('matchesPolicy', () => {
  it('matches on category', () => {
    expect(matchesPolicy(item({ id: 'a' }), { categories: ['finance'] })).toBe(true);
    expect(matchesPolicy(item({ id: 'a' }), { categories: ['health'] })).toBe(false);
  });

  it('matches on criticality', () => {
    expect(matchesPolicy(item({ id: 'a', criticality: 'critical' }), { criticalities: ['critical'] })).toBe(true);
  });

  it('matches the root-credential flag', () => {
    expect(matchesPolicy(item({ id: 'a', is_root_credential: true }), { isRootCredential: true })).toBe(true);
    expect(matchesPolicy(item({ id: 'a', is_root_credential: false }), { isRootCredential: true })).toBe(false);
  });

  it('matches an importance floor inclusively', () => {
    expect(matchesPolicy(item({ id: 'a', importance_score: 0.7 }), { minImportance: 0.7 })).toBe(true);
    expect(matchesPolicy(item({ id: 'a', importance_score: 0.69 }), { minImportance: 0.7 })).toBe(false);
  });

  it('ANDs every supplied clause', () => {
    const p = { categories: ['finance'], criticalities: ['critical'] };
    expect(matchesPolicy(item({ id: 'a', criticality: 'critical' }), p)).toBe(true);
    expect(matchesPolicy(item({ id: 'a', criticality: 'low' }), p)).toBe(false);
  });

  it('an EMPTY predicate matches NOTHING', () => {
    expect(matchesPolicy(item({ id: 'a' }), {})).toBe(false);
  });

  it('a null attribute never matches a clause that constrains it', () => {
    expect(matchesPolicy(item({ id: 'a', category: null }), { categories: ['finance'] })).toBe(false);
  });
});

describe('validatePolicyPredicate', () => {
  it('rejects an empty predicate outright', () => {
    expect(() => validatePolicyPredicate({})).toThrow(ValidationError);
  });

  it('rejects an unknown category', () => {
    expect(() => validatePolicyPredicate({ categories: ['crypto'] })).toThrow(ValidationError);
  });

  it('rejects minImportance outside [0,1]', () => {
    expect(() => validatePolicyPredicate({ minImportance: 1.5 })).toThrow(ValidationError);
    expect(() => validatePolicyPredicate({ minImportance: -0.1 })).toThrow(ValidationError);
  });

  it('accepts a well-formed predicate', () => {
    expect(validatePolicyPredicate({ categories: ['finance'], minImportance: 0.7 })).toEqual({
      categories: ['finance'],
      minImportance: 0.7,
    });
  });
});

describe('selectMatching', () => {
  it('returns only matching items', () => {
    const items = [
      item({ id: 'a', category: 'finance' }),
      item({ id: 'b', category: 'health' }),
      item({ id: 'c', category: 'finance' }),
    ];
    expect(selectMatching(items, { categories: ['finance'] }).map((i) => i.id)).toEqual(['a', 'c']);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/rules/policy-predicate.test.ts`
Expected: FAIL — cannot resolve `./policy-predicate`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/007_access_policies.sql`:

```sql
-- Access policies: predicates over item attributes that MATERIALIZE into
-- access_rules. access_rules remains the sole authority for the KMS unwrap
-- path; this table only generates rows in it (J4-R3).
CREATE TABLE IF NOT EXISTS access_policies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID        NOT NULL,
  recipient_id  UUID        NOT NULL,
  trigger_type  TEXT        NOT NULL
                CHECK (trigger_type IN ('emergency','travel','caregiver','business','estate')),
  scope         TEXT        NOT NULL CHECK (scope IN ('view','act')),
  reversible    BOOLEAN     NOT NULL,
  predicate     JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_policy_estate_irreversible
    CHECK (trigger_type != 'estate' OR reversible = false)
);
CREATE INDEX ASYNC idx_access_policies_owner
  ON access_policies (owner_id);

-- Provenance so reconciliation can tell generated grants from hand-made ones.
ALTER TABLE access_rules ADD COLUMN IF NOT EXISTS policy_id UUID;
CREATE INDEX ASYNC idx_access_rules_policy
  ON access_rules (policy_id);
```

Create `lib/rules/policy-predicate.ts`:

```typescript
/**
 * Access-policy predicates over vault-item attributes.
 *
 * An EMPTY predicate matches nothing, deliberately. A match-anything default
 * would silently grant a recipient the entire vault — the inverse of the
 * coverage bug policies exist to fix.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3
 */

import { ValidationError } from '../validation';

export const CATEGORIES = [
  'finance', 'health', 'government', 'utilities',
  'communication', 'professional', 'personal', 'other',
] as const;

export const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;

export interface PolicyPredicate {
  categories?: string[];
  criticalities?: string[];
  isRootCredential?: boolean;
  irreplaceable?: boolean;
  minImportance?: number;
}

export interface PolicyItem {
  id: string;
  category: string | null;
  criticality: string | null;
  is_root_credential: boolean;
  irreplaceable: boolean;
  importance_score: number;
}

function isEmpty(p: PolicyPredicate): boolean {
  return (
    !p.categories?.length &&
    !p.criticalities?.length &&
    p.isRootCredential === undefined &&
    p.irreplaceable === undefined &&
    p.minImportance === undefined
  );
}

export function matchesPolicy(item: PolicyItem, p: PolicyPredicate): boolean {
  if (isEmpty(p)) return false;

  if (p.categories?.length) {
    if (!item.category || !p.categories.includes(item.category)) return false;
  }
  if (p.criticalities?.length) {
    if (!item.criticality || !p.criticalities.includes(item.criticality)) return false;
  }
  if (p.isRootCredential !== undefined && item.is_root_credential !== p.isRootCredential) return false;
  if (p.irreplaceable !== undefined && item.irreplaceable !== p.irreplaceable) return false;
  if (p.minImportance !== undefined && item.importance_score < p.minImportance) return false;

  return true;
}

export function selectMatching(items: PolicyItem[], p: PolicyPredicate): PolicyItem[] {
  return items.filter((i) => matchesPolicy(i, p));
}

export function validatePolicyPredicate(raw: unknown): PolicyPredicate {
  const p = (raw ?? {}) as PolicyPredicate;
  const out: PolicyPredicate = {};

  if (p.categories !== undefined) {
    if (!Array.isArray(p.categories) || p.categories.length === 0) {
      throw new ValidationError('categories must be a non-empty array', 'categories');
    }
    for (const c of p.categories) {
      if (!CATEGORIES.includes(c as (typeof CATEGORIES)[number])) {
        throw new ValidationError(`unknown category: ${c}`, 'categories');
      }
    }
    out.categories = p.categories;
  }

  if (p.criticalities !== undefined) {
    if (!Array.isArray(p.criticalities) || p.criticalities.length === 0) {
      throw new ValidationError('criticalities must be a non-empty array', 'criticalities');
    }
    for (const c of p.criticalities) {
      if (!CRITICALITIES.includes(c as (typeof CRITICALITIES)[number])) {
        throw new ValidationError(`unknown criticality: ${c}`, 'criticalities');
      }
    }
    out.criticalities = p.criticalities;
  }

  if (p.isRootCredential !== undefined) {
    if (typeof p.isRootCredential !== 'boolean') {
      throw new ValidationError('isRootCredential must be a boolean', 'isRootCredential');
    }
    out.isRootCredential = p.isRootCredential;
  }

  if (p.irreplaceable !== undefined) {
    if (typeof p.irreplaceable !== 'boolean') {
      throw new ValidationError('irreplaceable must be a boolean', 'irreplaceable');
    }
    out.irreplaceable = p.irreplaceable;
  }

  if (p.minImportance !== undefined) {
    if (typeof p.minImportance !== 'number' || p.minImportance < 0 || p.minImportance > 1) {
      throw new ValidationError('minImportance must be between 0.0 and 1.0', 'minImportance');
    }
    out.minImportance = p.minImportance;
  }

  if (isEmpty(out)) {
    throw new ValidationError(
      'A policy must constrain at least one attribute. An empty policy would grant the whole vault.',
    );
  }

  return out;
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/rules/policy-predicate.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add db/migrations/007_access_policies.sql lib/rules/policy-predicate.ts \
        lib/rules/policy-predicate.test.ts
git commit -m "feat(rules): access-policy predicates over item attributes

An empty predicate matches nothing by construction — a match-anything default
would silently grant the entire vault."
```

---

### Task 8: Materialize policies into access_rules, with reconciliation

**Requirements:** J4-R3, J4-R4, J4-R6, J4-R7, J4-R14, J4-R15, CC6

The dangerous half. Materialization must be a **diff**, not an append: editing a policy has to revoke the grants it no longer covers, or the layer silently widens access over time.

**Files:**
- Create: `lib/rules/policy-materialize.ts`, `lib/rules/policy-materialize.test.ts`
- Create: `src/app/api/policies/route.ts`, `src/app/api/policies/[id]/route.ts`
- Modify: `src/app/api/vault/items/route.ts` (POST — cover new items)

**Interfaces:**
- Consumes: `selectMatching`, `matchesPolicy`, `PolicyItem` (Task 7); `query`, `withOccRetry`, `assertOwns`, `writeAuditEntry`
- Produces:
  - `diffGrants(desiredItemIds: string[], existingItemIds: string[]): { toAdd: string[]; toRemove: string[] }`
  - `materializePolicy(ownerId, policyId): Promise<{ added: number; removed: number }>`
  - `coverNewItem(ownerId, itemId): Promise<{ policiesMatched: number }>`
  - `previewPolicyChange(ownerId, policyId, next: PolicyPredicate): Promise<{ toAdd: string[]; toRemove: string[] }>`

- [x] **Step 1: Write the failing test**

Create `lib/rules/policy-materialize.test.ts`:

```typescript
/**
 * Tests for policy materialization.
 *
 * Materialization is a DIFF. Append-only materialization silently widens
 * access on every policy edit (J4-R14).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R4, J4-R14, J4-R15
 */

import { describe, it, expect } from 'vitest';
import { diffGrants } from './policy-materialize';

describe('diffGrants', () => {
  it('adds newly matching items', () => {
    expect(diffGrants(['a', 'b'], ['a'])).toEqual({ toAdd: ['b'], toRemove: [] });
  });

  it('REVOKES items the policy no longer covers', () => {
    expect(diffGrants(['a'], ['a', 'b'])).toEqual({ toAdd: [], toRemove: ['b'] });
  });

  it('is a no-op when the sets agree', () => {
    expect(diffGrants(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] });
  });

  it('revokes everything when the policy stops matching', () => {
    expect(diffGrants([], ['a', 'b'])).toEqual({ toAdd: [], toRemove: ['a', 'b'] });
  });

  it('deduplicates repeated ids on both sides', () => {
    expect(diffGrants(['a', 'a'], ['a'])).toEqual({ toAdd: [], toRemove: [] });
  });

  it('returns stable ordering for deterministic audit detail', () => {
    expect(diffGrants(['c', 'a', 'b'], [])).toEqual({ toAdd: ['a', 'b', 'c'], toRemove: [] });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/rules/policy-materialize.test.ts`
Expected: FAIL — cannot resolve `./policy-materialize`.

- [x] **Step 3: Write minimal implementation**

Create `lib/rules/policy-materialize.ts`:

```typescript
/**
 * Materializes access_policies into access_rules.
 *
 * access_rules stays the sole authority consulted by the KMS unwrap path; this
 * module only generates rows in it. Materialization is a DIFF so that editing a
 * policy revokes what it no longer covers (J4-R14).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R4, J4-R14, J4-R15
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { matchesPolicy, selectMatching, type PolicyItem, type PolicyPredicate } from './policy-predicate';

export function diffGrants(
  desiredItemIds: string[],
  existingItemIds: string[],
): { toAdd: string[]; toRemove: string[] } {
  const desired = new Set(desiredItemIds);
  const existing = new Set(existingItemIds);

  return {
    toAdd: [...desired].filter((id) => !existing.has(id)).sort(),
    toRemove: [...existing].filter((id) => !desired.has(id)).sort(),
  };
}

interface PolicyRow {
  id: string;
  recipient_id: string;
  trigger_type: string;
  scope: string;
  reversible: boolean;
  predicate: PolicyPredicate;
}

async function loadPolicy(ownerId: string, policyId: string): Promise<PolicyRow | null> {
  const res = await query<PolicyRow>(
    `SELECT id, recipient_id, trigger_type, scope, reversible, predicate
     FROM access_policies WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [policyId, ownerId],
  );
  return res.rows[0] ?? null;
}

async function loadPolicyItems(ownerId: string): Promise<PolicyItem[]> {
  // Metadata only — never selects ciphertext / wrapped_data_key / kms_key_id.
  const res = await query<PolicyItem>(
    `SELECT id, category, criticality, is_root_credential, irreplaceable,
            importance_score::float8 AS importance_score
     FROM vault_items WHERE owner_id = $1`,
    [ownerId],
  );
  return res.rows;
}

export async function previewPolicyChange(
  ownerId: string,
  policyId: string,
  next: PolicyPredicate,
): Promise<{ toAdd: string[]; toRemove: string[] }> {
  const items = await loadPolicyItems(ownerId);
  const existing = await query<{ vault_item_id: string }>(
    `SELECT vault_item_id FROM access_rules WHERE owner_id = $1 AND policy_id = $2`,
    [ownerId, policyId],
  );

  return diffGrants(
    selectMatching(items, next).map((i) => i.id),
    existing.rows.map((r) => r.vault_item_id),
  );
}

export async function materializePolicy(
  ownerId: string,
  policyId: string,
): Promise<{ added: number; removed: number }> {
  const policy = await loadPolicy(ownerId, policyId);
  if (!policy) return { added: 0, removed: 0 };

  const items = await loadPolicyItems(ownerId);
  const existing = await query<{ vault_item_id: string }>(
    `SELECT vault_item_id FROM access_rules WHERE owner_id = $1 AND policy_id = $2`,
    [ownerId, policyId],
  );

  const { toAdd, toRemove } = diffGrants(
    selectMatching(items, policy.predicate).map((i) => i.id),
    existing.rows.map((r) => r.vault_item_id),
  );

  await withOccRetry(async () => {
    for (const itemId of toAdd) {
      await query(
        `INSERT INTO access_rules
           (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible, policy_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ownerId, itemId, policy.recipient_id, policy.trigger_type, policy.scope, policy.reversible, policyId],
      );
    }
    if (toRemove.length > 0) {
      await query(
        `DELETE FROM access_rules
         WHERE owner_id = $1 AND policy_id = $2 AND vault_item_id = ANY($3::uuid[])`,
        [ownerId, policyId, toRemove],
      );
    }
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'policy_materialized',
    entity: 'access_policy',
    entityId: policyId,
    detail: { added: toAdd, removed: toRemove },
  });

  return { added: toAdd.length, removed: toRemove.length };
}

/** Covers a newly created item against every existing policy (J4-R4). */
export async function coverNewItem(
  ownerId: string,
  itemId: string,
): Promise<{ policiesMatched: number }> {
  const items = await loadPolicyItems(ownerId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { policiesMatched: 0 };

  const policies = await query<PolicyRow>(
    `SELECT id, recipient_id, trigger_type, scope, reversible, predicate
     FROM access_policies WHERE owner_id = $1`,
    [ownerId],
  );

  const matched = policies.rows.filter((p) => matchesPolicy(item, p.predicate));

  await withOccRetry(async () => {
    for (const p of matched) {
      await query(
        `INSERT INTO access_rules
           (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible, policy_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ownerId, itemId, p.recipient_id, p.trigger_type, p.scope, p.reversible, p.id],
      );
    }
  });

  if (matched.length > 0) {
    await writeAuditEntry(ownerId, {
      actor: `owner:${ownerId}`,
      action: 'item_auto_covered',
      entity: 'vault_item',
      entityId: itemId,
      detail: { policyIds: matched.map((p) => p.id) },
    });
  }

  return { policiesMatched: matched.length };
}
```

Call `coverNewItem(auth.ownerId, created.id)` at the end of the `POST /api/vault/items` try block, and return the count so the UI can tell the owner which grants were just created (J4-R4).

**Explicit irreversibility consent (J4-R7, CC6).** `POST /api/policies` with
`trigger_type = 'estate'` must require an `acknowledgedIrreversible: true` flag in the body and
record an `estate_irreversibility_acknowledged` audit entry naming the recipient and item count.
The DB CHECK constraint (`chk_policy_estate_irreversible`) enforces `reversible = false`, but a
constraint is not consent — irreversibility must never be applied as a silent side effect of picking
a trigger type. Reject with `ValidationError` when the flag is absent.

Routes: `POST /api/policies` validates the predicate, inserts, then materializes. `PUT /api/policies/[id]` **must** call `previewPolicyChange` and require a `confirm: true` flag when `toRemove` is non-empty (J4-R14). `DELETE /api/policies/[id]` removes the policy and its `policy_id`-tagged rules.

**Cascade (J4-R15):** extend the existing `cascadeDelete` call sites so deleting a vault item or recipient also deletes `access_policies` rows referencing that recipient — otherwise a deleted grant re-materializes on the next policy run.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/rules/policy-materialize.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS — **including every pre-existing `access_rules` and KMS-unwrap test.** If any of those changed behaviour, the additive contract has been broken; stop and revert.

- [x] **Step 5: Prove the additive contract held**

```bash
npx vitest --run lib/access lib/rules lib/kms
```

Then manually: create a policy covering `category=finance`, confirm rules appear; narrow it to `criticality=critical`, confirm the preview lists revocations and that they actually disappear; import a new finance item and confirm it is auto-covered.

- [x] **Step 6: Commit**

```bash
git add lib/rules/policy-materialize.ts lib/rules/policy-materialize.test.ts \
        src/app/api/policies src/app/api/vault/items/route.ts
git commit -m "feat(rules): materialize access policies into access_rules as a diff

Editing a policy revokes the grants it no longer covers and previews the
revocation before committing. access_rules remains the sole authority the KMS
unwrap path consults."
```

---

### Task 9: Proposed policies and the coverage matrix

**Requirements:** J4-R2, J4-R5, J4-R13

**Files:**
- Create: `lib/rules/policy-proposals.ts`, `lib/rules/policy-proposals.test.ts`
- Create: `lib/rules/coverage.ts`, `lib/rules/coverage.test.ts`
- Create: `src/app/(owner)/circle/page.tsx`, `src/app/(owner)/circle/CoverageMatrix.tsx`

**Interfaces:**
- Produces:
  - `proposePolicies(items: PolicyItem[], recipients: { id: string; name: string; role: string }[]): ProposedPolicy[]` where `ProposedPolicy = { recipientId: string; triggerType: string; scope: 'view' | 'act'; reversible: boolean; predicate: PolicyPredicate; rationale: string; itemCount: number }`
  - `computeCoverage(items: PolicyItem[], rules: { vault_item_id: string; recipient_id: string }[]): { uncoveredCritical: string[]; byRecipient: Record<string, number>; circleComplete: boolean }`

- [x] **Step 1: Write the failing test**

Create `lib/rules/coverage.test.ts`:

```typescript
/**
 * Tests for coverage analysis and the circle-complete state.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R5, J4-R13
 */

import { describe, it, expect } from 'vitest';
import { computeCoverage } from './coverage';
import type { PolicyItem } from './policy-predicate';

function item(id: string, criticality: string): PolicyItem {
  return {
    id,
    category: 'finance',
    criticality,
    is_root_credential: false,
    irreplaceable: false,
    importance_score: 0.5,
  };
}

describe('computeCoverage', () => {
  it('flags critical items with no rule', () => {
    const c = computeCoverage([item('a', 'critical'), item('b', 'critical')], [
      { vault_item_id: 'a', recipient_id: 'r1' },
    ]);
    expect(c.uncoveredCritical).toEqual(['b']);
    expect(c.circleComplete).toBe(false);
  });

  it('does not flag non-critical items', () => {
    const c = computeCoverage([item('a', 'low')], []);
    expect(c.uncoveredCritical).toEqual([]);
  });

  it('counts grants per recipient', () => {
    const c = computeCoverage([item('a', 'critical'), item('b', 'critical')], [
      { vault_item_id: 'a', recipient_id: 'r1' },
      { vault_item_id: 'b', recipient_id: 'r1' },
    ]);
    expect(c.byRecipient).toEqual({ r1: 2 });
    expect(c.circleComplete).toBe(true);
  });

  it('an empty vault is trivially complete', () => {
    expect(computeCoverage([], []).circleComplete).toBe(true);
  });

  it('deduplicates multiple rules for one item', () => {
    const c = computeCoverage([item('a', 'critical')], [
      { vault_item_id: 'a', recipient_id: 'r1' },
      { vault_item_id: 'a', recipient_id: 'r2' },
    ]);
    expect(c.uncoveredCritical).toEqual([]);
    expect(c.byRecipient).toEqual({ r1: 1, r2: 1 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/rules/coverage.test.ts`
Expected: FAIL — cannot resolve `./coverage`.

- [x] **Step 3: Write minimal implementation**

Create `lib/rules/coverage.ts`:

```typescript
/**
 * Coverage analysis — which items no recipient can reach.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R5, J4-R13
 */

import type { PolicyItem } from './policy-predicate';

export interface Coverage {
  uncoveredCritical: string[];
  byRecipient: Record<string, number>;
  circleComplete: boolean;
}

export function computeCoverage(
  items: PolicyItem[],
  rules: { vault_item_id: string; recipient_id: string }[],
): Coverage {
  const covered = new Set(rules.map((r) => r.vault_item_id));

  const uncoveredCritical = items
    .filter((i) => i.criticality === 'critical' && !covered.has(i.id))
    .map((i) => i.id)
    .sort();

  const byRecipient: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of rules) {
    const key = `${r.recipient_id}::${r.vault_item_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byRecipient[r.recipient_id] = (byRecipient[r.recipient_id] ?? 0) + 1;
  }

  return { uncoveredCritical, byRecipient, circleComplete: uncoveredCritical.length === 0 };
}
```

Create `lib/rules/policy-proposals.ts` — deterministic rules over importance-engine output, each carrying a plain-language `rationale`:

```typescript
/**
 * Proposed starting policies derived from importance-engine output.
 *
 * The owner edits a draft rather than authoring from an empty state (J4-R2).
 * Deterministic and metadata-only — no LLM call, so proposals are reproducible
 * and testable.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2
 */

import type { PolicyItem, PolicyPredicate } from './policy-predicate';
import { selectMatching } from './policy-predicate';

export interface ProposedPolicy {
  recipientId: string;
  triggerType: string;
  scope: 'view' | 'act';
  reversible: boolean;
  predicate: PolicyPredicate;
  rationale: string;
  itemCount: number;
}

const TEMPLATES: { predicate: PolicyPredicate; scope: 'view' | 'act'; rationale: string }[] = [
  {
    predicate: { isRootCredential: true },
    scope: 'act',
    rationale: 'Root credentials are the reset path for everything else. Without them nothing else can be recovered.',
  },
  {
    predicate: { categories: ['finance', 'health'], criticalities: ['critical'] },
    scope: 'view',
    rationale: 'Critical money and health accounts are what a caregiver needs first.',
  },
  {
    predicate: { categories: ['utilities'] },
    scope: 'act',
    rationale: 'Utilities need action, not just visibility — bills keep arriving.',
  },
];

export function proposePolicies(
  items: PolicyItem[],
  recipients: { id: string; name: string; role: string }[],
): ProposedPolicy[] {
  const primary = recipients.find((r) => r.role === 'caregiver') ?? recipients[0];
  if (!primary) return [];

  return TEMPLATES.map((t) => ({
    recipientId: primary.id,
    triggerType: 'emergency',
    scope: t.scope,
    reversible: true,
    predicate: t.predicate,
    rationale: t.rationale,
    itemCount: selectMatching(items, t.predicate).length,
  })).filter((p) => p.itemCount > 0);
}
```

`CoverageMatrix.tsx` renders people × item-groups with uncovered critical items flagged, and shows the circle-complete state with its unmet conditions named.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/rules/coverage.test.ts lib/rules/policy-proposals.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add lib/rules/policy-proposals.ts lib/rules/policy-proposals.test.ts \
        lib/rules/coverage.ts lib/rules/coverage.test.ts 'src/app/(owner)/circle'
git commit -m "feat(rules): proposed starting policies and the coverage matrix

Deterministic metadata-only proposals so the owner edits a draft instead of
authoring from empty, plus an explicit circle-complete state that names its
unmet conditions."
```

---

### Task 10: Unified people list, invitations, claim-in-calm, and the case ID

**Requirements:** J4-R1, J4-R9, J4-R10, J4-R11, J4-R12, CC7

The highest-leverage change in the spec. A recipient's first contact with Relay is currently a raw `?token=` URL arriving at the worst moment of their life.

**Files:**
- Create: `db/migrations/008_invitations_case_id.sql`
- Create: `lib/people/invitations.ts`, `lib/people/invitations.test.ts`
- Create: `lib/release/case-id.ts`, `lib/release/case-id.test.ts`
- Create: `src/app/api/invitations/route.ts`, `src/app/api/invitations/[token]/route.ts`
- Create: `src/app/(access)/claim/page.tsx`, `src/app/(access)/claim/ClaimForm.tsx`, `src/app/(access)/standby/page.tsx`

**Interfaces:**
- Produces:
  - `createInvitation(ownerId, { personId, personType: 'recipient' | 'verifier' }): Promise<{ token: string; expiresAt: string }>`
  - `redeemInvitation(token: string): Promise<{ ownerId: string; personId: string; personType: 'recipient' | 'verifier' }>` — throws `ValidationError` if expired or already used
  - `buildStandbyView(ownerId, recipientId): Promise<{ itemCount: number; categories: Record<string, number>; triggerTypes: string[] }>`
  - `formatCaseId(seed: string): string` — e.g. `RLY-4K2P-9XQ1`

- [x] **Step 1: Write the failing test**

Create `lib/people/invitations.test.ts` and `lib/release/case-id.test.ts`. The standby-view test is the one that carries the privacy requirement:

```typescript
/**
 * Tests for the recipient standby view.
 *
 * The standby view discloses the SHAPE of a grant — counts and categories —
 * and never item titles for sensitive categories, never content (J4-R10).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { buildStandbyView } from './invitations';

const mockQuery = vi.mocked(query);

describe('buildStandbyView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns counts and categories only', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category: 'finance', trigger_type: 'emergency' },
        { category: 'finance', trigger_type: 'emergency' },
        { category: 'health', trigger_type: 'emergency' },
      ],
    } as never);

    const v = await buildStandbyView('o-1', 'r-1');

    expect(v.itemCount).toBe(3);
    expect(v.categories).toEqual({ finance: 2, health: 1 });
    expect(v.triggerTypes).toEqual(['emergency']);
    expect(JSON.stringify(v)).not.toMatch(/title|ciphertext|wrapped/i);
  });

  it('never selects title or ciphertext columns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await buildStandbyView('o-1', 'r-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/\btitle\b/i);
    expect(sql).not.toMatch(/ciphertext|wrapped_data_key|kms_key_id/i);
    expect(sql).toMatch(/owner_id\s*=\s*\$/);
  });

  it('handles a recipient with no grants', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const v = await buildStandbyView('o-1', 'r-1');
    expect(v.itemCount).toBe(0);
    expect(v.categories).toEqual({});
  });
});
```

And for case IDs:

```typescript
import { describe, it, expect } from 'vitest';
import { formatCaseId } from './case-id';

describe('formatCaseId', () => {
  it('is stable for the same seed', () => {
    expect(formatCaseId('abc')).toBe(formatCaseId('abc'));
  });

  it('matches the human-readable shape', () => {
    expect(formatCaseId('abc')).toMatch(/^RLY-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it('omits ambiguous characters so it can be read over the phone', () => {
    const ids = Array.from({ length: 200 }, (_, i) => formatCaseId(`seed-${i}`));
    for (const id of ids) expect(id).not.toMatch(/[IOU01]/);
  });

  it('differs across seeds', () => {
    expect(formatCaseId('a')).not.toBe(formatCaseId('b'));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run lib/people/invitations.test.ts lib/release/case-id.test.ts`
Expected: FAIL — modules do not resolve.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/008_invitations_case_id.sql`:

```sql
CREATE TABLE IF NOT EXISTS invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID        NOT NULL,
  person_id    UUID        NOT NULL,
  person_type  TEXT        NOT NULL CHECK (person_type IN ('recipient','verifier')),
  token_hash   TEXT        NOT NULL,
  claimed_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_invitations_token_hash
  ON invitations (token_hash);
CREATE INDEX ASYNC idx_invitations_owner
  ON invitations (owner_id);

-- CC7: one human-readable case ID per release, quoted in every notification.
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS case_id TEXT;
```

**Unify the people entry experience first (J4-R1).** `lib/people/recipients.ts` and
`lib/people/verifiers.ts` write to separate tables, so an owner naming their spouse as both enters
that person twice and maintains two records. Add `lib/people/people.ts` exposing one list:

```typescript
/**
 * One people list; roles are attributes.
 *
 * `recipients` and `verifiers` remain the storage projections — this is an
 * entry-experience unification, NOT a schema migration, so every existing
 * query and cascade path is untouched (J4-R1).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

export interface Person {
  email: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  roles: { recipient: boolean; verifier: boolean; executor: boolean };
  recipientId: string | null;
  verifierId: string | null;
}

export async function listPeople(ownerId: string): Promise<Person[]>;
export async function upsertPerson(ownerId: string, input: PersonInput): Promise<Person>;
```

`listPeople` reads both tables and merges on **normalised email** (trim + lowercase — the same
normalisation `detectRoleConcentration` uses in Task 13, so the two never disagree). `upsertPerson`
creates or deletes the projection rows to match the requested role set, routing through the existing
validated `createRecipient` / `createVerifier` / `cascadeDelete` paths rather than raw inserts.

`lib/release/case-id.ts` derives a Crockford-base32 ID from a SHA-256 of the seed, excluding `I O U 0 1`. `lib/people/invitations.ts` stores only a SHA-256 **hash** of the token (never the token), enforces single use via `claimed_at`, and builds the standby view with a query that selects `category` and `trigger_type` only.

Assign `case_id = formatCaseId(release_state.id)` when a release row is provisioned, and include it in every notification template.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/people/invitations.test.ts lib/release/case-id.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Verify the claim path end-to-end, then verify what it does NOT show**

Invite a recipient, claim through the emailed link, and confirm the standby view shows counts and categories. Then check the **network response body** — not the rendered page — for any item title or ciphertext. The privacy requirement is about the payload, not the layout.

- [x] **Step 6: Commit**

```bash
git add db/migrations/008_invitations_case_id.sql lib/people/invitations.ts \
        lib/people/invitations.test.ts lib/release/case-id.ts lib/release/case-id.test.ts \
        src/app/api/invitations 'src/app/(access)/claim' 'src/app/(access)/standby'
git commit -m "feat(people): invitations, recipient claim-in-calm, and release case IDs

Recipients claim and stand by before any trigger fires, seeing the shape of
their grant but never titles or content. Every release carries one phone-
readable case ID quoted in all notifications."
```

---

## Sprint 2 exit criteria

- [x] Every pre-existing `access_rules` and KMS-unwrap test still passes unchanged
- [x] Narrowing a policy previews revocations and actually removes those grants
- [x] A newly imported item matching a policy is auto-covered, and the owner is told
- [x] Deleting a recipient removes their policies **and** rules, with no re-materialization
- [x] The standby-view network payload contains no titles and no ciphertext
- [x] A case ID appears in every notification for one release
- [x] `npx vitest --run` green · `npx tsc --noEmit` clean · `npm run build` succeeds

---

## Sprint 3 — Delegation

**Gate: G1 pass.**

The caregiver wedge has three roles the schema treats as one: the **buyer** (adult child), the **data owner** (parent), and the **recipient** (the child again). Everything under `src/app/(owner)/*` assumes `owner = buyer = the person with the accounts`. A 78-year-old will not drive a TOTP enrolment and a 300-row import, and the child has no standing to simply take custody of their parent's credentials.

**This sprint is also the product's principal harm surface.** A tool that lets an adult child assemble complete access to an aging parent's financial life can be misused by exactly the person it is designed to empower. The anti-abuse controls in Task 13 are core requirements, not hardening.

**The honest boundary, which must be stated to users in these words:** a delegate who types a credential in obviously knows it. The guarantee is that a delegate *cannot read items they did not personally enter, cannot arm or disarm a trigger, cannot grant themselves access without the owner's approval, and every action they take is logged and reported to the owner.* Never imply the delegate learns nothing.

---

### Task 11: Delegation and consent artifacts

**Requirements:** J3-R1, J3-R2, J3-R3, J3-R7

**Files:**
- Create: `db/migrations/009_delegations.sql`
- Create: `lib/people/delegation.ts`, `lib/people/delegation.test.ts`
- Create: `src/app/api/delegations/route.ts`, `src/app/api/delegations/[id]/consent/route.ts`
- Create: `src/app/(owner)/consent/page.tsx`

**Interfaces:**
- Produces:
  - `DelegateScope = 'items:create' | 'items:update' | 'import:run' | 'people:propose' | 'policies:propose'`
  - `DELEGATE_SCOPES: readonly DelegateScope[]` — the complete allowed set
  - `createDelegation(ownerId, delegateUserId): Promise<{ id: string; status: 'pending' }>`
  - `recordConsent(delegationId, { method, evidenceRef }): Promise<{ status: 'active' }>` where `method: 'link' | 'in_person' | 'paper_upload'`
  - `getActiveDelegation(delegateUserId, ownerId): Promise<{ id: string; scopes: DelegateScope[] } | null>`
  - `revokeDelegation(ownerId, delegationId): Promise<void>`

- [x] **Step 1: Write the failing test**

Create `lib/people/delegation.test.ts`:

```typescript
/**
 * Tests for delegation and consent.
 *
 * Delegation NEVER activates without a recorded consent artifact (J3-R2), and
 * consent must be obtainable without a smartphone (J3-R3).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R3, J3-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  DELEGATE_SCOPES,
  createDelegation,
  recordConsent,
  getActiveDelegation,
  revokeDelegation,
} from './delegation';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

describe('DELEGATE_SCOPES', () => {
  it('never includes decrypt, trigger, or self-grant capability', () => {
    const joined = DELEGATE_SCOPES.join(' ');
    expect(joined).not.toMatch(/decrypt|trigger|arm|release|recipient:create/);
  });

  it('is exactly the five setup scopes', () => {
    expect([...DELEGATE_SCOPES]).toEqual([
      'items:create',
      'items:update',
      'import:run',
      'people:propose',
      'policies:propose',
    ]);
  });
});

describe('createDelegation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a PENDING delegation — never active on creation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);
    await expect(createDelegation('o-1', 'u-2')).resolves.toEqual({ id: 'd-1', status: 'pending' });
    expect(mockQuery.mock.calls[0][0] as string).toMatch(/'pending'/);
  });
});

describe('recordConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['link', 'in_person', 'paper_upload'] as const)(
    'accepts consent method %s — a parent without a smartphone is not a blocker',
    async (method) => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'a-1' }] } as never)
        .mockResolvedValueOnce({ rows: [{ id: 'd-1', owner_id: 'o-1' }] } as never);

      await expect(recordConsent('d-1', { method, evidenceRef: 'ref' })).resolves.toEqual({
        status: 'active',
      });
    },
  );

  it('rejects an unknown consent method', async () => {
    await expect(
      recordConsent('d-1', { method: 'verbal' as never, evidenceRef: null }),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('writes the consent artifact to the audit log', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a-1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1', owner_id: 'o-1' }] } as never);

    await recordConsent('d-1', { method: 'in_person', evidenceRef: null });

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ action: 'delegation_consent_recorded' }),
    );
  });
});

describe('getActiveDelegation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for a pending delegation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toBeNull();
  });

  it('returns null for a revoked delegation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toBeNull();
    expect(mockQuery.mock.calls[0][0] as string).toMatch(/revoked_at IS NULL/i);
  });

  it('returns scopes for an active delegation', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'd-1', scopes: ['items:create'] }],
    } as never);
    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toEqual({
      id: 'd-1',
      scopes: ['items:create'],
    });
  });
});

describe('revokeDelegation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets revoked_at and audits', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);
    await revokeDelegation('o-1', 'd-1');
    expect(mockQuery.mock.calls[0][0] as string).toMatch(/revoked_at\s*=\s*now\(\)/i);
    expect(writeAuditEntry).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/people/delegation.test.ts`
Expected: FAIL — cannot resolve `./delegation`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/009_delegations.sql`:

```sql
-- Delegation: a helper with scoped SETUP rights on another person's vault.
-- The parent remains the owner; consent is a first-class artifact.
CREATE TABLE IF NOT EXISTS consent_artifacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  method       TEXT        NOT NULL CHECK (method IN ('link','in_person','paper_upload')),
  evidence_ref TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delegations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID        NOT NULL,
  delegate_user_id    UUID        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','revoked')),
  scopes              TEXT[]      NOT NULL DEFAULT ARRAY[
                        'items:create','items:update','import:run',
                        'people:propose','policies:propose'
                      ]::TEXT[],
  consent_artifact_id UUID,
  granted_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_delegations_owner
  ON delegations (owner_id);
CREATE INDEX ASYNC idx_delegations_delegate
  ON delegations (delegate_user_id);

-- Provenance so a delegate can be denied read access to items they did not enter.
ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS created_by_delegate_id UUID;
```

`lib/people/delegation.ts` implements the five functions. `getActiveDelegation` queries `status = 'active' AND revoked_at IS NULL`. `recordConsent` validates the method against the closed set **before** touching the DB, inserts the artifact, flips the delegation to `active` with `granted_at = now()`, and writes `delegation_consent_recorded` to the audit log.

`src/app/(owner)/consent/page.tsx` is the parent-facing consent screen. It must meet CC8 without exception: minimum 18px text, high contrast, no time pressure, and a printable version for the `paper_upload` path.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/people/delegation.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add db/migrations/009_delegations.sql lib/people/delegation.ts \
        lib/people/delegation.test.ts src/app/api/delegations 'src/app/(owner)/consent'
git commit -m "feat(caregiver): delegation with first-class consent artifacts

The parent stays the owner; the child becomes a scoped delegate only after a
recorded consent artifact. Consent is obtainable by link, in person, or on
paper, so a parent without a smartphone is not a blocker."
```

---

### Task 12: Server-side delegate scope enforcement

**Requirements:** J3-R4, J3-R5, J3-R6, J3-R11

The safety-critical task in this sprint. **Client-side scope hiding is not enforcement.** Every delegate-reachable route asserts its scope server-side, and the read restriction on non-self-entered items is checked at the data layer.

**Files:**
- Create: `lib/http/delegate-route.ts`, `lib/http/delegate-route.test.ts`
- Modify: `src/app/api/vault/items/route.ts`, `src/app/api/vault/items/[id]/route.ts`, `src/app/api/import/route.ts`
- Modify: `src/app/api/access/[itemId]/decrypt/route.ts` (deny delegate reads on items they did not create)

**Interfaces:**
- Consumes: `getOwnerSession`, `getActiveDelegation`
- Produces:
  - `resolveActor(): Promise<ActorContext | NextResponse>` where `ActorContext = { ownerId: string; actingUserId: string; isDelegate: boolean; delegationId: string | null; scopes: DelegateScope[] }`
  - `requireScope(ctx: ActorContext, scope: DelegateScope): void` — throws `IntegrityError` when absent
  - `assertDelegateMayRead(ctx: ActorContext, item: { created_by_delegate_id: string | null }): void`

- [x] **Step 1: Write the failing test**

Create `lib/http/delegate-route.test.ts`:

```typescript
/**
 * Tests for delegate scope enforcement.
 *
 * Every one of these is a security boundary. A delegate must not decrypt items
 * they did not enter, must not touch triggers, and must not self-grant.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R4, J3-R5, J3-R6, J3-R11
 */

import { describe, it, expect } from 'vitest';
import { requireScope, assertDelegateMayRead, type ActorContext } from './delegate-route';
import { IntegrityError } from '../db/integrity';

function ownerCtx(): ActorContext {
  return { ownerId: 'o-1', actingUserId: 'o-1', isDelegate: false, delegationId: null, scopes: [] };
}

function delegateCtx(scopes: ActorContext['scopes'] = ['items:create']): ActorContext {
  return { ownerId: 'o-1', actingUserId: 'u-2', isDelegate: true, delegationId: 'd-1', scopes };
}

describe('requireScope', () => {
  it('always allows the owner regardless of scopes', () => {
    expect(() => requireScope(ownerCtx(), 'items:create')).not.toThrow();
    expect(() => requireScope(ownerCtx(), 'policies:propose')).not.toThrow();
  });

  it('allows a delegate holding the scope', () => {
    expect(() => requireScope(delegateCtx(['items:create']), 'items:create')).not.toThrow();
  });

  it('REJECTS a delegate missing the scope', () => {
    expect(() => requireScope(delegateCtx(['items:create']), 'import:run')).toThrow(IntegrityError);
  });

  it('rejects a delegate with no scopes at all', () => {
    expect(() => requireScope(delegateCtx([]), 'items:create')).toThrow(IntegrityError);
  });
});

describe('assertDelegateMayRead', () => {
  it('lets the owner read anything', () => {
    expect(() => assertDelegateMayRead(ownerCtx(), { created_by_delegate_id: 'd-9' })).not.toThrow();
    expect(() => assertDelegateMayRead(ownerCtx(), { created_by_delegate_id: null })).not.toThrow();
  });

  it('lets a delegate read an item they entered', () => {
    expect(() =>
      assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: 'd-1' }),
    ).not.toThrow();
  });

  it('REJECTS a delegate reading an item the owner entered', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: null })).toThrow(
      IntegrityError,
    );
  });

  it('REJECTS a delegate reading an item ANOTHER delegate entered', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: 'd-2' })).toThrow(
      IntegrityError,
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/http/delegate-route.test.ts`
Expected: FAIL — cannot resolve `./delegate-route`.

- [x] **Step 3: Write minimal implementation**

Create `lib/http/delegate-route.ts`:

```typescript
/**
 * Delegate scope enforcement for owner-scoped routes.
 *
 * Every check here is a security boundary enforced server-side. Client-side
 * scope hiding is not enforcement (J3-R11).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R4, J3-R5, J3-R6, J3-R11
 */

import { NextResponse } from 'next/server';
import { getOwnerSession } from '../auth/session';
import { getActiveDelegation, type DelegateScope } from '../people/delegation';
import { IntegrityError } from '../db/integrity';

export interface ActorContext {
  /** The vault whose data is being acted on. */
  ownerId: string;
  /** The human actually making the request. */
  actingUserId: string;
  isDelegate: boolean;
  delegationId: string | null;
  scopes: DelegateScope[];
}

/**
 * Resolves who is acting and on whose vault. A delegate targets another owner's
 * vault via `?ownerId=`; the delegation must be active for that exact pair.
 */
export async function resolveActor(targetOwnerId?: string): Promise<ActorContext | NextResponse> {
  let session: { ownerId: string };
  try {
    session = await getOwnerSession();
  } catch (res) {
    return res as NextResponse;
  }

  const actingUserId = session.ownerId;

  if (!targetOwnerId || targetOwnerId === actingUserId) {
    return { ownerId: actingUserId, actingUserId, isDelegate: false, delegationId: null, scopes: [] };
  }

  const delegation = await getActiveDelegation(actingUserId, targetOwnerId);
  if (!delegation) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'No active delegation for this vault' },
      { status: 403 },
    );
  }

  return {
    ownerId: targetOwnerId,
    actingUserId,
    isDelegate: true,
    delegationId: delegation.id,
    scopes: delegation.scopes,
  };
}

export function requireScope(ctx: ActorContext, scope: DelegateScope): void {
  if (!ctx.isDelegate) return; // The owner holds every capability over their own vault.

  if (!ctx.scopes.includes(scope)) {
    throw new IntegrityError(`Delegate is not permitted to ${scope}`);
  }
}

/** A delegate may read back only what they personally entered (J3-R4). */
export function assertDelegateMayRead(
  ctx: ActorContext,
  item: { created_by_delegate_id: string | null },
): void {
  if (!ctx.isDelegate) return;

  if (item.created_by_delegate_id !== ctx.delegationId) {
    throw new IntegrityError('Delegate may not read items they did not enter');
  }
}
```

Wire into routes:
- `POST /api/vault/items` — `requireScope(ctx, 'items:create')`, and stamp `created_by_delegate_id = ctx.delegationId`.
- `PUT /api/vault/items/[id]` — `requireScope(ctx, 'items:update')` **and** `assertDelegateMayRead`.
- `POST /api/import` — `requireScope(ctx, 'import:run')`.
- `POST /api/access/[itemId]/decrypt` — `assertDelegateMayRead` before the KMS unwrap.
- **Trigger routes take no delegate path at all** (J3-R5). `/api/triggers/*` continues to use `requireOwner()` unchanged, so a delegate simply cannot reach them.
- `POST /api/recipients` — when `ctx.isDelegate`, route the create into the approvals queue (Task 13) rather than inserting. This is the J3-R6 self-grant block.

Every delegate action writes audit with `actor: \`delegate:${ctx.delegationId}\``.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/http/delegate-route.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS

- [x] **Step 5: Attack the boundary directly with curl**

Sign in as the delegate and attempt each of these against the parent's `ownerId`. All must fail:

```bash
# Decrypt an item the OWNER entered → expect 403
curl -X POST ".../api/access/$OWNER_ENTERED_ITEM/decrypt?ownerId=$PARENT" -H "$DELEGATE_COOKIE"

# Initiate a trigger → expect 401/403, never 200
curl -X POST ".../api/triggers/$TRIGGER_ID/initiate?ownerId=$PARENT" -H "$DELEGATE_COOKIE"

# Self-designate as recipient → expect the approvals queue, never a direct insert
curl -X POST ".../api/recipients?ownerId=$PARENT" -H "$DELEGATE_COOKIE" -d '{"name":"Me",...}'
```

**A scope boundary tested only through the UI has not been tested.**

- [x] **Step 6: Commit**

```bash
git add lib/http/delegate-route.ts lib/http/delegate-route.test.ts \
        src/app/api/vault src/app/api/import src/app/api/access src/app/api/recipients
git commit -m "feat(caregiver): server-side delegate scope enforcement

A delegate cannot decrypt items they did not enter, cannot reach any trigger
route, and cannot self-designate as a recipient. Enforced in the handlers, not
by hiding controls in the UI."
```

---

### Task 13: Approval queue, role-concentration warning, and the activity digest

**Requirements:** J3-R6, J3-R8, J3-R9, J3-R10

**Files:**
- Create: `db/migrations/010_approvals.sql`
- Create: `lib/people/approvals.ts`, `lib/people/approvals.test.ts`
- Create: `lib/people/role-concentration.ts`, `lib/people/role-concentration.test.ts`
- Create: `src/app/api/approvals/route.ts`, `src/app/api/approvals/[id]/route.ts`
- Create: `src/app/(owner)/approvals/page.tsx`

**Interfaces:**
- Produces:
  - `enqueueApproval(ownerId, { kind, payload, proposedByDelegationId }): Promise<{ id: string }>` where `kind: 'recipient' | 'policy' | 'self_designation'`
  - `decideApproval(ownerId, approvalId, decision: 'approve' | 'reject'): Promise<{ applied: boolean }>`
  - `detectRoleConcentration(people): ConcentrationWarning | null`

- [x] **Step 1: Write the failing test**

Create `lib/people/role-concentration.test.ts` — this is the elder-abuse detector:

```typescript
/**
 * Tests for the role-concentration warning.
 *
 * One person holding delegate + sole recipient + sole verifier is the precise
 * structure that enables undetectable elder financial abuse (J3-R10).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R10
 */

import { describe, it, expect } from 'vitest';
import { detectRoleConcentration } from './role-concentration';

describe('detectRoleConcentration', () => {
  it('WARNS when one person is delegate, sole recipient, and sole verifier', () => {
    const w = detectRoleConcentration([
      { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
    ]);
    expect(w).not.toBeNull();
    expect(w!.severity).toBe('high');
    expect(w!.email).toBe('child@x.com');
  });

  it('does NOT warn when a second independent verifier exists', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
        { email: 'neighbour@x.com', isDelegate: false, isRecipient: false, isVerifier: true },
      ]),
    ).toBeNull();
  });

  it('does NOT warn when a second independent recipient exists', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
        { email: 'sibling@x.com', isDelegate: false, isRecipient: true, isVerifier: false },
      ]),
    ).toBeNull();
  });

  it('does not warn on a delegate who is not also recipient and verifier', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: false, isVerifier: false },
      ]),
    ).toBeNull();
  });

  it('does not warn on an empty circle', () => {
    expect(detectRoleConcentration([])).toBeNull();
  });

  it('matches on normalised email so case and spacing cannot evade it', () => {
    const w = detectRoleConcentration([
      { email: ' Child@X.com ', isDelegate: true, isRecipient: true, isVerifier: true },
    ]);
    expect(w).not.toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/people/role-concentration.test.ts`
Expected: FAIL — cannot resolve `./role-concentration`.

- [x] **Step 3: Write minimal implementation**

Create `lib/people/role-concentration.ts`:

```typescript
/**
 * Role-concentration detector — a safety requirement, not a UX suggestion.
 *
 * One adult child holding delegate + sole recipient + sole verifier can grant
 * themselves access and confirm their own trigger with nobody else involved.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R10
 */

export interface CirclePerson {
  email: string;
  isDelegate: boolean;
  isRecipient: boolean;
  isVerifier: boolean;
}

export interface ConcentrationWarning {
  email: string;
  severity: 'high';
  message: string;
  remedy: string;
}

const norm = (e: string) => e.trim().toLowerCase();

export function detectRoleConcentration(people: CirclePerson[]): ConcentrationWarning | null {
  const concentrated = people.find((p) => p.isDelegate && p.isRecipient && p.isVerifier);
  if (!concentrated) return null;

  const key = norm(concentrated.email);
  const otherRecipients = people.filter((p) => p.isRecipient && norm(p.email) !== key);
  const otherVerifiers = people.filter((p) => p.isVerifier && norm(p.email) !== key);

  // An independent party on EITHER axis breaks the concentration.
  if (otherRecipients.length > 0 || otherVerifiers.length > 0) return null;

  return {
    email: concentrated.email,
    severity: 'high',
    message:
      'One person is currently the helper, the only recipient, and the only verifier. ' +
      'That means nobody else would ever be asked before access opens.',
    remedy: 'Add one more verifier — a neighbour, a second sibling, or a family friend.',
  };
}
```

Create `db/migrations/010_approvals.sql` with an `approvals` table (`owner_id`, `kind`, `payload JSONB`, `proposed_by_delegation_id`, `status`, `decided_at`). `decideApproval` applies the payload on approve (creating the recipient or policy through the *existing* validated code paths, never a raw insert) and audits both outcomes.

`src/app/(owner)/approvals/page.tsx` is parent-facing and must meet CC8 without exception (J3-R9). The digest (J3-R8) is generated from the audit chain filtered to `actor LIKE 'delegate:%'` — not a separate log.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/people/role-concentration.test.ts lib/people/approvals.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Walk the abuse scenario deliberately**

Set up a vault where the delegate is also the only recipient and only verifier. Confirm the warning fires and is visible to the **parent**, not only to the delegate. Then add a second verifier and confirm it clears. A warning only the abuser can see is not a control.

- [x] **Step 6: Commit**

```bash
git add db/migrations/010_approvals.sql lib/people/approvals.ts lib/people/approvals.test.ts \
        lib/people/role-concentration.ts lib/people/role-concentration.test.ts \
        src/app/api/approvals 'src/app/(owner)/approvals'
git commit -m "feat(caregiver): owner approval queue and role-concentration warning

Delegate proposals require the owner's explicit approval, and a circle where
one person is helper, sole recipient, and sole verifier raises a high-severity
warning to the owner."
```

---

## Sprint 3 exit criteria

- [x] Delegation cannot activate without a consent artifact — verified by attempting it
- [x] Consent completes through the paper path with no smartphone involved
- [x] A delegate is denied decrypt on an owner-entered item, **tested via curl**
- [x] A delegate receives 401/403 on every `/api/triggers/*` route
- [x] A delegate self-designation lands in the approvals queue, never a direct insert
- [x] The role-concentration warning fires and is visible to the parent
- [x] Consent and approval screens meet CC8 at 18px minimum
- [x] `npx vitest --run` green · `npx tsc --noEmit` clean · `npm run build` succeeds

---

## Sprint 4 — The event

**Gate: G1 pass.**

Sprint 4 closes the loop: a recipient can ask for access, the owner is challenged first, and a verifier can render a real decision — including **no**. At the end of this sprint a caregiver can go from purchase to hands-on-the-account and back to sealed, without a developer in the loop.

**The correctness gap being closed:** `/api/triggers/[id]/confirm` has no deny path. A verifier who *knows* a request is illegitimate can only decline to act — indistinguishable from being on a plane. Silence and objection must be distinguishable, and enough objections must halt a release. This is a defect in the mechanism the product positions as its moat, not a UX shortfall.

---

### Task 14: Verifier decisions — deny, abstain, and the halt rule

**Requirements:** J7-R5, J7-R7, J7-R8, J7-R9, J7-R10

**Files:**
- Create: `db/migrations/011_verifier_decisions.sql`
- Create: `lib/release/verifier-decision.ts`, `lib/release/verifier-decision.test.ts`
- Modify: `src/app/api/triggers/[id]/confirm/route.ts`

**Interfaces:**
- Consumes: `withOccRetry`, `ReleaseStateMachine`, `writeAuditEntry`
- Produces:
  - `Decision = 'confirm' | 'deny' | 'abstain'`
  - `thresholdUnreachable(m: number, n: number, denials: number): boolean`
  - `evaluateOutcome(input: { m: number; n: number; confirmations: number; denials: number }): 'advance' | 'halt' | 'wait'`
  - `recordDecision(releaseStateId, verifierId, decision): Promise<{ outcome: 'advance' | 'halt' | 'wait'; duplicate: boolean }>`

- [x] **Step 1: Write the failing test**

Create `lib/release/verifier-decision.test.ts`:

```typescript
/**
 * Tests for verifier decisions.
 *
 * A verifier who can only confirm is a rubber stamp. Denials must be able to
 * halt a release when they make the threshold unreachable (J7-R7).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R5, J7-R7, J7-R8, J7-R9
 */

import { describe, it, expect } from 'vitest';
import { thresholdUnreachable, evaluateOutcome } from './verifier-decision';

describe('thresholdUnreachable', () => {
  it('2-of-3 stays reachable after one denial', () => {
    // 3 verifiers, need 2, one denies → 2 remain, still exactly enough.
    expect(thresholdUnreachable(3, 2, 1)).toBe(false);
  });

  it('2-of-3 becomes unreachable after two denials', () => {
    expect(thresholdUnreachable(3, 2, 2)).toBe(true);
  });

  it('1-of-3 needs all three denials to become unreachable', () => {
    expect(thresholdUnreachable(3, 1, 2)).toBe(false);
    expect(thresholdUnreachable(3, 1, 3)).toBe(true);
  });

  it('1-of-1 is unreachable on a single denial', () => {
    expect(thresholdUnreachable(1, 1, 1)).toBe(true);
  });

  it('is never unreachable with zero denials', () => {
    expect(thresholdUnreachable(5, 3, 0)).toBe(false);
  });
});

describe('evaluateOutcome', () => {
  it('advances once confirmations reach the threshold', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 2, denials: 0 })).toBe('advance');
  });

  it('waits below the threshold with denials still survivable', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 1, denials: 1 })).toBe('wait');
  });

  it('HALTS when denials make the threshold unreachable', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 1, denials: 2 })).toBe('halt');
  });

  it('advance wins if the threshold was already met when a late denial lands', () => {
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 2, denials: 1 })).toBe('advance');
  });

  it('abstentions count toward neither side', () => {
    // Two abstained: neither confirmations nor denials moved, so still waiting.
    expect(evaluateOutcome({ m: 3, n: 2, confirmations: 0, denials: 0 })).toBe('wait');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/release/verifier-decision.test.ts`
Expected: FAIL — cannot resolve `./verifier-decision`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/011_verifier_decisions.sql`:

```sql
-- Verifiers must be able to say NO. Existing rows default to 'confirm' so
-- current behaviour and every existing test are preserved exactly.
ALTER TABLE verifier_confirmations
  ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'confirm'
  CHECK (decision IN ('confirm','deny','abstain'));

ALTER TABLE release_state
  ADD COLUMN IF NOT EXISTS received_denials INT NOT NULL DEFAULT 0;
```

Create `lib/release/verifier-decision.ts`:

```typescript
/**
 * Verifier decisions: confirm, deny, abstain.
 *
 * `received_confirmations` counts ONLY confirmations, preserving the existing
 * N-of-M semantics. Denials are counted separately and halt the release when
 * they make the threshold arithmetically unreachable (J7-R7).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R5, J7-R7, J7-R8, J7-R9, J7-R10
 */

export type Decision = 'confirm' | 'deny' | 'abstain';

/**
 * With M verifiers needing N confirmations, `denials` objections leave
 * `M - denials` possible confirmations. Unreachable once that drops below N.
 */
export function thresholdUnreachable(m: number, n: number, denials: number): boolean {
  return m - denials < n;
}

export function evaluateOutcome(input: {
  m: number;
  n: number;
  confirmations: number;
  denials: number;
}): 'advance' | 'halt' | 'wait' {
  // A threshold already met is not undone by a late denial.
  if (input.confirmations >= input.n) return 'advance';
  if (thresholdUnreachable(input.m, input.n, input.denials)) return 'halt';
  return 'wait';
}
```

`recordDecision` follows the existing OCC intent-read pattern for idempotency (R16.4): read `(release_state_id, verifier_id)` for existence, insert with the decision, then CAS-increment either `received_confirmations` or `received_denials`. A duplicate submission is silently ignored and returns `{ duplicate: true }` without moving any counter. On SQLSTATE 40001 after 3 retries, treat as duplicate.

On `'halt'`, transition the release back to `ARMED` through `safeResetToArmed` and notify **both** the owner and the requesting recipient. `'abstain'` moves no counter, is recorded, and triggers escalation to the remaining verifiers.

Extend `/api/triggers/[id]/confirm` to accept `{ decision }`, defaulting to `'confirm'` when the field is absent so existing callers are unaffected.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/release/verifier-decision.test.ts
npx vitest --run && npx tsc --noEmit
```
Expected: PASS — **including every existing verifier-confirmation and state-machine test.** The default `'confirm'` exists specifically so none of them change.

- [x] **Step 5: Prove the halt path against a real release**

Configure 2-of-3. Have two verifiers deny. Confirm the release returns to `ARMED`, that both the owner and the recipient are notified, and that the audit chain records both denials and the halt. Then verify the chain still validates end-to-end.

- [x] **Step 6: Commit**

```bash
git add db/migrations/011_verifier_decisions.sql lib/release/verifier-decision.ts \
        lib/release/verifier-decision.test.ts 'src/app/api/triggers/[id]/confirm/route.ts'
git commit -m "feat(release): verifiers can deny and abstain, and denials can halt a release

A confirm-only API made every verifier a rubber stamp — silence and objection
were the same signal. Denials now halt the release when they make the N-of-M
threshold unreachable. Existing rows default to 'confirm' so current behaviour
is unchanged."
```

---

### Task 15: The verifier decision surface

**Requirements:** J7-R1, J7-R2, J7-R3, J7-R4, J7-R6, J7-R11, J7-R12

No account, no app, no password. The page must give a verifier everything needed for a real decision — and state plainly what they will *not* see, because that is the recruitment blocker.

**Files:**
- Create: `lib/release/verifier-context.ts`, `lib/release/verifier-context.test.ts`
- Create: `src/app/(verify)/verify/page.tsx`, `src/app/(verify)/verify/VerifyClient.tsx`
- Create: `src/app/(verify)/layout.tsx`
- Modify: `lib/notify/notifications.ts` (verifier email carries the signed link + case ID)

**Interfaces:**
- Produces:
  - `buildVerifierContext(releaseStateId, verifierId): Promise<VerifierContext>` where `VerifierContext = { caseId: string; ownerName: string; requesterName: string; triggerType: string; itemCount: number; categories: string[]; escalationHistory: { at: string; channel: string; outcome: string }[]; graceEndsAt: string | null; reversible: boolean }`

- [x] **Step 1: Write the failing test**

Create `lib/release/verifier-context.test.ts`:

```typescript
/**
 * Tests for the verifier decision context.
 *
 * Verifiers see counts and categories. NEVER titles, never ciphertext, never
 * plaintext (R6.8, J7-R11).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R3, J7-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { buildVerifierContext } from './verifier-context';

const mockQuery = vi.mocked(query);

describe('buildVerifierContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never selects title or ciphertext columns', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never);
    await buildVerifierContext('rs-1', 'v-1').catch(() => undefined);

    for (const call of mockQuery.mock.calls) {
      const sql = call[0] as string;
      expect(sql).not.toMatch(/ciphertext|wrapped_data_key|kms_key_id/i);
      expect(sql).not.toMatch(/vault_items\.title|vi\.title/i);
    }
  });

  it('exposes the item count and categories but no item identities', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ case_id: 'RLY-4K2P-9XQ1', trigger_type: 'emergency', grace_ends_at: null }],
      } as never)
      .mockResolvedValueOnce({ rows: [{ category: 'finance', n: '4' }, { category: 'health', n: '2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const ctx = await buildVerifierContext('rs-1', 'v-1');

    expect(ctx.itemCount).toBe(6);
    expect(ctx.categories.sort()).toEqual(['finance', 'health']);
    expect(ctx.reversible).toBe(true);
    expect(JSON.stringify(ctx)).not.toMatch(/title/i);
  });

  it('marks an estate trigger as irreversible', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ case_id: 'RLY-1111-2222', trigger_type: 'estate', grace_ends_at: null }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    expect((await buildVerifierContext('rs-1', 'v-1')).reversible).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/release/verifier-context.test.ts`
Expected: FAIL — cannot resolve `./verifier-context`.

- [x] **Step 3: Write minimal implementation**

`lib/release/verifier-context.ts` assembles the context with three metadata-only queries: the release row (`case_id`, `trigger_type`, `grace_ends_at`), a `COUNT(*) GROUP BY category` over `access_rules ⋈ vault_items` (**selecting `category` only — never `title`**), and the escalation history from the audit log. `reversible` comes from `isReversibleTrigger(trigger_type)`.

`src/app/(verify)/` is a third route group alongside `(owner)` and `(access)`, styled like Access mode: warm, high-contrast, minimum 18px (CC8).

`VerifyClient.tsx` renders, in this order:

1. **Who and what** — "Sarah Chen is asking for access to Margaret Chen's accounts."
2. **Why now** — the escalation history: "Margaret has not responded to 3 contacts across 14 hours."
3. **What confirming does** — "Sarah gets view access to 34 items across finance and health. Margaret can undo this at any time before 4:20pm."
4. **What it does NOT do** — "You will not see any of Margaret's information. Not now, not after." (J7-R4 — the recruitment blocker.)
5. **Three buttons of equal weight: Confirm · Deny · I don't know.** Deny must have the same prominence and take the same number of taps as Confirm (J7-R6).
6. The case ID, for phone coordination.

After a decision, render the closure message (J7-R12): *"Thank you. Sarah now has access to what Margaret designated. Margaret can reverse this at any time."*

Verifier links are signed, single-use, short-TTL via the existing `lib/auth/verifier-token.ts`.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/release/verifier-context.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Verify visually, then verify the payload**

Drive the page with Playwright at 375px width. Confirm Deny is as prominent as Confirm and that both are reachable in one tap. Then inspect the **network response** and confirm it contains no item titles — the privacy requirement is about the payload, not the rendering.

- [x] **Step 6: Commit**

```bash
git add lib/release/verifier-context.ts lib/release/verifier-context.test.ts 'src/app/(verify)'
git commit -m "feat(verify): verifier decision surface with no account required

States who is asking, why now, what confirming does, and — plainly — that the
verifier will never see vault contents. Deny carries the same weight as Confirm."
```

---

### Task 16: Access requests and owner-challenge-first

**Requirements:** J6-R1 … J6-R12

The last piece. Owner approval routes through `ARMED → PENDING → GRACE` as two CAS transitions — **the transition set stays exactly seven.**

**Files:**
- Create: `db/migrations/012_access_requests.sql`
- Create: `lib/release/access-request.ts`, `lib/release/access-request.test.ts`
- Create: `src/app/api/access-requests/route.ts`, `src/app/api/access-requests/[id]/respond/route.ts`
- Create: `src/app/(access)/request/page.tsx`, `src/app/(owner)/challenge/page.tsx`

**Interfaces:**
- Consumes: `ReleaseStateMachine`, `withOccRetry`, `safeResetToArmed`, `writeAuditEntry`, `formatCaseId`
- Produces:
  - `CHALLENGE_WINDOW_SECONDS: Record<TriggerType, number>`
  - `assertRequestAllowed(recent: { created_at: string }[], now: Date): void` — velocity + cooling-off, throws `ValidationError`
  - `createAccessRequest(recipientId, ownerId, triggerType, reason): Promise<{ id: string; caseId: string; expiresAt: string }>`
  - `respondToChallenge(requestId, response: 'deny' | 'approve'): Promise<{ state: 'armed' | 'grace' }>`
  - `escalateExpiredChallenges(now: Date): Promise<{ escalated: number }>`

- [x] **Step 1: Write the failing test**

Create `lib/release/access-request.test.ts`:

```typescript
/**
 * Tests for access requests and the owner challenge.
 *
 * Owner denial must leave release_state untouched at ARMED and consume ZERO
 * verifier attention. Owner approval must NOT introduce an ARMED->GRACE
 * transition (J6-R4, J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R4, J6-R5, J6-R6, J6-R8
 */

import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_WINDOW_SECONDS,
  assertRequestAllowed,
  MAX_REQUESTS_PER_WINDOW,
} from './access-request';
import { ValidationError } from '../validation';

describe('CHALLENGE_WINDOW_SECONDS', () => {
  it('is configurable per trigger type', () => {
    expect(CHALLENGE_WINDOW_SECONDS.emergency).toBe(7200);
    expect(CHALLENGE_WINDOW_SECONDS.estate).toBeGreaterThan(CHALLENGE_WINDOW_SECONDS.emergency);
  });

  it('covers every trigger type', () => {
    for (const t of ['emergency', 'travel', 'caregiver', 'business', 'estate']) {
      expect(CHALLENGE_WINDOW_SECONDS[t as keyof typeof CHALLENGE_WINDOW_SECONDS]).toBeGreaterThan(0);
    }
  });
});

describe('assertRequestAllowed', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('allows a first request', () => {
    expect(() => assertRequestAllowed([], now)).not.toThrow();
  });

  it('allows requests below the velocity limit', () => {
    const recent = [{ created_at: '2026-08-06T11:00:00Z' }];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('REJECTS once the velocity limit is reached', () => {
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: '2026-08-06T11:00:00Z',
    }));
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('ignores requests outside the window', () => {
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: '2026-07-01T00:00:00Z',
    }));
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest --run lib/release/access-request.test.ts`
Expected: FAIL — cannot resolve `./access-request`.

- [x] **Step 3: Write minimal implementation**

Create `db/migrations/012_access_requests.sql`:

```sql
CREATE TABLE IF NOT EXISTS access_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID        NOT NULL,
  recipient_id  UUID        NOT NULL,
  trigger_type  TEXT        NOT NULL
                CHECK (trigger_type IN ('emergency','travel','caregiver','business','estate')),
  reason        TEXT,
  evidence_ref  TEXT,
  case_id       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'awaiting_owner'
                CHECK (status IN ('awaiting_owner','denied_by_owner','approved_by_owner','escalated','closed')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_access_requests_owner
  ON access_requests (owner_id, status);
CREATE INDEX ASYNC idx_access_requests_recipient
  ON access_requests (recipient_id, created_at);
```

Create `lib/release/access-request.ts`:

```typescript
/**
 * Recipient-initiated access requests with owner-challenge-first.
 *
 * Only the owner-truly-unreachable case consumes verifier attention. Owner
 * approval walks ARMED -> PENDING -> GRACE using the EXISTING transitions with
 * notification suppressed — it does NOT add an ARMED -> GRACE edge (J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R1 .. J6-R12
 */

import { ValidationError } from '../validation';

export const CHALLENGE_WINDOW_SECONDS = {
  emergency: 7200,     // 2 h — starting proposal, not evidence
  travel: 14400,       // 4 h
  caregiver: 21600,    // 6 h
  business: 14400,     // 4 h
  estate: 259200,      // 72 h — irreversible, so the ladder is long
} as const;

export const MAX_REQUESTS_PER_WINDOW = 3;
export const VELOCITY_WINDOW_SECONDS = 86400;

export function assertRequestAllowed(
  recent: { created_at: string }[],
  now: Date = new Date(),
): void {
  const cutoff = now.getTime() - VELOCITY_WINDOW_SECONDS * 1000;
  const inWindow = recent.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  if (inWindow.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new ValidationError(
      'Too many access requests in the last 24 hours. Contact the owner directly.',
      'velocity',
    );
  }
}
```

`respondToChallenge` implements the two branches:

- **`'deny'`** — set `status = 'denied_by_owner'`, notify the recipient honestly, audit `request_denied_by_owner`. **`release_state` is never touched and remains `armed`** (J6-R4). No verifier is contacted.
- **`'approve'`** — walk the existing transitions, exactly as `lib/release/simulate.ts` already does:
  ```typescript
  const reversible = isReversibleTrigger(row.trigger_type);

  // ARMED -> PENDING. The option key is `auditDetail`, not `detail`.
  row = await machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible,
    updates: { initiated_by: 'owner_consent', initiated_at: at.toISOString() },
    auditDetail: { ownerConsented: true, notifySuppressed: true },
  });
  // Reuse simulate.ts's suppressedNotification so the suppression is audited
  // the same way in both paths.
  await suppressedNotification(ownerId, row.id, 'verifier_requests');

  // Auto-satisfy the quorum, then PENDING -> GRACE.
  row = await machine.transition(row.id, 'pending', 'grace', row.version, {
    reversible,
    updates: { received_confirmations: row.required_confirmations, grace_ends_at: graceEnd },
    auditDetail: { ownerConsented: true, quorumAutoSatisfied: true },
  });
  ```
  **Do not add a transition rule.** If `machine.transition` rejects either hop, the bug is in the call, not in `PERMITTED_TRANSITIONS`.

The challenge notification fans out across every registered owner channel with one-tap actions
(J6-R3); the window is per-trigger via `CHALLENGE_WINDOW_SECONDS` (J6-R7); the requesting recipient
polls a status endpoint showing time remaining (J6-R10); and the `case_id` from Task 10 is quoted in
every notification to every actor (J6-R11, CC7).

`escalateExpiredChallenges` runs from the hourly cron (Task 1's schedule) and moves timed-out requests `ARMED → PENDING` through `withOccRetry`, notifying verifiers (J6-R6). On exhaustion, `safeResetToArmed`.

On every request, notify **all** recipients and verifiers that a request was made (J6-R9) — social transparency is the anti-abuse control.

- [x] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run lib/release/access-request.test.ts
npx vitest --run && npx tsc --noEmit && npm run build
```
Expected: PASS

- [x] **Step 5: Assert the transition set did not grow**

```bash
npx vitest --run lib/release/state-machine.test.ts
grep -c "from:" lib/release/state-machine.ts   # must still be 7
```

Then walk all three branches live: deny (state stays `armed`, no verifier email sent), approve (reaches `grace` with two audit transitions recorded), and timeout (escalates to `pending`, verifiers notified).

- [x] **Step 6: Commit**

```bash
git add db/migrations/012_access_requests.sql lib/release/access-request.ts \
        lib/release/access-request.test.ts src/app/api/access-requests \
        'src/app/(access)/request' 'src/app/(owner)/challenge'
git commit -m "feat(release): recipient access requests with owner-challenge-first

The owner is challenged before any verifier is contacted, so false alarms and
the owner-is-conscious case never consume the verification network. Owner
approval walks the existing ARMED->PENDING->GRACE transitions with notification
suppressed — the permitted set stays at seven."
```

---

## Sprint 4 exit criteria

- [x] `PERMITTED_TRANSITIONS` still contains exactly **seven** entries
- [x] Two denials on a 2-of-3 release halt it back to `ARMED` and notify owner + recipient
- [x] A duplicate verifier submission moves no counter
- [x] The verifier page renders with no account and no login
- [x] Deny is one tap, same prominence as Confirm, verified at 375px
- [x] The verifier network payload contains no item titles
- [x] Owner denial leaves `release_state` at `armed`, with zero verifier notifications sent
- [x] Owner approval reaches `grace` via two audited transitions
- [x] The audit hash chain validates end-to-end after a full request → deny → re-request → approve cycle
- [x] `npx vitest --run` green · `npx tsc --noEmit` clean · `npm run build` succeeds

---

## What this plan does NOT deliver

Stated explicitly so the remaining scope is not mistaken for zero.

| Deferred | Journey | Why |
|---|---|---|
| Review-by-exception after import | J2 | The 300-row list is bad UX but not blocking; the loop works without it |
| Document + email ingestion lanes | J2 | `[P2]` — new external dependencies |
| Passive liveness, escalation ladder, quarterly review, renewal receipt | J5 | Retention matters from month 3, not week 8. Task 1 restores the *scheduler*; the ladder is a refinement on top |
| Precomputed triage plan, single-next-action, ephemeral reveal, shared progress | J8 | Journey 8 already works — R13.8's fallback covers the 15s budget. These are refinements to a functioning path |
| Reversal receipt, graceful recipient close, re-arm prompt | J9 | The reversal itself is `[BUILT]` and correct; the artifact around it is presentation |
| **All of J10 (estate)** | J10 | **Blocked on `g2-counsel-opinion`.** Specified in the journey doc; must not be sold before counsel |
| Identity verification (KYC) at claim | J4 | `[P2]` — vendor selection, and G1 evidence should precede that spend |
| Mobile apps | J8 | `[P2]` |
| Owner account recovery | Part VI | Unresolved design tension: recovery and release quorums drawing on one social graph |

**The loop that does work at the end of Sprint 4:** buy → set up the parent's vault as a consented delegate → designate a verified circle → parent is hospitalised → request access → owner challenged → verifier confirms or denies → scoped access → parent recovers → access seals itself. Every step in that sentence is either built today or built by this plan.

---

## Requirement coverage ledger

Produced by the plan audit. Every one of the 122 journey requirements and 10 cross-cutting requirements in `docs/user-journeys.md` is accounted for below — **built already**, **scheduled in this plan**, or **explicitly deferred**. Nothing is silently absent.

Re-derive at any time rather than trusting this table:

```bash
python - <<'EOF'
import io, re
j = io.open('docs/user-journeys.md', encoding='utf-8').read()
p = io.open('docs/implementation-plan-4-sprints.md', encoding='utf-8').read()
defs = re.findall(r'^- \*\*(J\d+-R\d+)\*\*', j, re.M)
cited = set(re.findall(r'\b(J\d+-R\d+)\b', p))
print([r for r in defs if r not in cited])
EOF
```

| Journey | Scheduled in this plan | Already `[BUILT]` — no task needed | Deferred (see "What this plan does NOT deliver") |
|---|---|---|---|
| **J1** | R3–R10 (Tasks 3–6) | R1, R2 — the `/caregivers` landing already leads with reversibility and qualifies behaviorally | — |
| **J2** | — | R1–R5, R8 — CSV import, dedup, whole-batch abort, scoring, 0.5 default all exist | R6 review-by-exception · R9 continuity-ready state · R10 re-runnable import · R7 partially (override persistence exists; reasoning display does not) |
| **J3** | R1–R11 (Tasks 11–13) | — | — |
| **J4** | R1–R7, R9–R15 (Tasks 7–10) | R8 — N-of-M validation `N≥1, M≥1, N≤M` is implemented and tested | — |
| **J5** | R5, R7 (Tasks 1–2) | R2 — `checkin_interval_days` 1–365/default 30 validated · R6 — sweep backoff base 5s max 3 · R8 — heartbeat reset with estate rejection | R1 passive liveness · R3 per-trigger cadence · R4 escalation ladder · R9 quarterly review · R10 renewal receipt |
| **J6** | R1–R12 (Task 16) | — | — |
| **J7** | R1–R12 (Tasks 14–15) | — | R13 — verifier response-rate surfacing, which lands in J5's quarterly review |
| **J8** | — | R2, R3, R5, R6, R8, R10, R11, R14, R15, R16 — strong-consistency auth, version check, ranking, dependency order, KMS gating, audit-before-work, failover, 24h tokens all exist and are property-tested | R1 (needs Task 10's claim flow to fully land) · R4 precompute · R7 single next action · R9 ephemeral reveal · R12 shared progress · R13 inline annotations · R17 accessibility pass |
| **J9** | — | R1–R6, R11 — the full state machine, CAS, safe default, 60s token invalidation, INSERT-only audit | R7 graceful close · R8–R9 reversal receipt · R10 re-arm prompt · R12 invalidation-latency alarm |
| **J10** | — | R6, R7 — estate terminality and provider-specific guidance exist | **R1–R5, R8–R12 — all blocked on `g2-counsel-opinion`** |
| **CC1–CC5, CC10** | — | Built and property-tested | — |
| **CC6** | J4-R7 consent flow (Task 8) | Reversibility semantics built | — |
| **CC7** | Task 10 (case ID), Task 16 (in notifications) | — | — |
| **CC8** | Tasks 11, 13, 15 (consent, approvals, verify surfaces) | Access mode already 18–20px | Full WCAG AA audit · printable fallbacks · low-end-device testing |
| **CC9** | Tasks 1–2 | — | — |

**Three requirements are worth calling out as changing status because of audit findings:**

- **J5-R5** moves from "described as built" to **actively broken in production** — the sweep was never scheduled (Task 1).
- **R17.1** (MFA on all owner accounts) is satisfied for one owner but **cannot** be satisfied for two until TOTP becomes per-user (Task 3, Step 3a).
- **J4-R1** was named as a headline Sprint 2 optimization in the first draft of this plan and had **no task**. Now folded into Task 10.

---

## Audit summary

This plan was audited against the codebase after drafting. Findings, all now fixed inline:

| # | Severity | Finding |
|---|---|---|
| 1 | **Critical** | TOTP is a **single shared secret** from `TOTP_SECRET`; `lib/auth/totp.ts` exports take no secret argument. Multi-owner signup on that module is an account-takeover vulnerability. Task 3 now makes TOTP per-user first, with a regression test that two users cannot use each other's codes. |
| 2 | **High** | The heartbeat sweep advances **ARMED → PENDING → GRACE**, not to PENDING as the first draft (and the journey doc's J5 flow) stated. Wiring the cron is therefore behaviour-visible, not a restored no-op. Task 1 now says so and requires confirming the grace window before enabling the schedule. |
| 3 | **High** | J4-R1 (unified people list) was a headline optimization with no task. Folded into Task 10 with a concrete interface. |
| 4 | Medium | `SweepResult` is `{ evaluated, transitioned, failures }`; the plan invented `{ evaluated, armed, failed }`. Fixed in Tasks 1–2 including the migration columns. |
| 5 | Medium | `ReleaseStateMachine.transition` takes `auditDetail`, not `detail`, and a `reversible` flag. Task 16's code used the wrong key and omitted the flag. Fixed, and now reuses `simulate.ts`'s `suppressedNotification`. |
| 6 | Medium | J4-R7 / CC6 (explicit irreversibility consent) had no task — a DB CHECK constraint is not consent. Added to Task 8. |
| 7 | Low | `generateTotpSecret` / `verifyTotp` did not exist. Replaced with real names plus the new secret-taking overloads. |
| 8 | Low | J6-R3, R7, R10, R11 were implemented in Task 16's prose but uncited, so coverage tooling read them as gaps. Now cited. |

**Verified clean:** migration numbering (003–011 against 001–002 on disk, no collisions) · no placeholder text · no dangling requirement references · every task ends in a commit · every code step carries real code.

**Known limitation of this audit:** it verifies the plan against symbols, signatures, and schema that exist **today**. It cannot verify that the Sprint 2–4 code compiles, because that code has not been written. Each task's Step 4 exists to catch what this audit cannot.
