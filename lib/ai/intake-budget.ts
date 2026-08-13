/**
 * A ceiling on how often one owner can spend money at the AI seam.
 *
 * 🔴 /api/ai/intake WAS COMPLETELY UNMETERED until 2026-08-13. The handler
 * authenticated and called straight through to OpenAI. Per-call cost was
 * bounded — runIntake caps the batch at 300 items — but call FREQUENCY was not:
 * no rate limit, no daily cap, no tier gate. Signup is self-serve, so anyone who
 * registered an account could spend the project's OpenAI budget in a loop.
 *
 * lib/http/rate-limit.ts sets the bar in its own header: a limiter "must never
 * be the only defence on anything that costs money or grants access." This
 * endpoint cleared neither half, because it had no defence at all.
 *
 * TWO LAYERS, BECAUSE ONE IS NOT ENOUGH.
 *
 *  1. The in-memory limiter, keyed on the OWNER rather than the IP. The caller
 *     is authenticated, so the honest key is the account — an IP key would both
 *     punish a family behind one address and be trivially sidestepped.
 *     Per-instance, so a distributed caller walks past it. That is the known
 *     limit, and the reason for the second layer.
 *
 *  2. This: a rolling 24-hour count read from the DATABASE, which every
 *     instance shares. No migration — it counts entries already in `audit_log`,
 *     a table that exists, is append-only, and is exactly where "this owner ran
 *     an AI pass over their vault" belongs anyway.
 *
 * IT COUNTS ATTEMPTS, NOT SUCCESSES, and the entry is written BEFORE the model
 * is called. Counting successes would let a caller burn the budget for free by
 * causing failures after the meter ticked — the money leaves when OpenAI is
 * called, so that is the moment to record.
 *
 * A SOFT CEILING, DELIBERATELY. Two concurrent requests can both pass the count
 * before either writes, so the limit can be exceeded by the number of requests
 * in flight. That is the right trade for a cost meter and the wrong one for a
 * credential — which is why lib/auth/single-use-atomicity.test.ts exists and
 * this does not use a compare-and-swap. Overshooting by a couple of calls costs
 * fractions of a cent; a lock on the read path would cost every honest owner.
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';

/** The audit action that records one intake run. Also the meter's unit. */
export const INTAKE_ACTION = 'ai_intake';

/**
 * Runs per owner per rolling 24 hours.
 *
 * Sized from what the product actually does: an owner runs intake while seeding
 * their vault and then rarely again. Twenty is far beyond any honest day's use
 * — J1's guided seed triggers it a handful of times at most — while turning an
 * unbounded spend into a bounded one.
 */
export const INTAKE_DAILY_LIMIT = 20;

/** Runs per owner in this window, on this instance. Catches a hammering client. */
export const INTAKE_BURST_LIMIT = 5;
export const INTAKE_BURST_WINDOW_MS = 10 * 60 * 1000;

export class IntakeBudgetError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'IntakeBudgetError';
    Object.setPrototypeOf(this, IntakeBudgetError.prototype);
  }
}

/** How many intake runs this owner has started in the last 24 hours. */
export async function intakeRunsToday(ownerId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log
      WHERE owner_id = $1 AND action = $2 AND ts > now() - INTERVAL '24 hours'`,
    [ownerId, INTAKE_ACTION],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Reserves one run against the daily ceiling, or throws.
 *
 * Writing the audit entry IS the reservation — see the header. `writeAuditEntry`
 * blocks its caller when it fails, by design, so a run cannot proceed without
 * being recorded.
 */
export async function reserveIntakeRun(ownerId: string): Promise<void> {
  const used = await intakeRunsToday(ownerId);
  if (used >= INTAKE_DAILY_LIMIT) {
    throw new IntakeBudgetError(
      `Relay can sort your vault ${INTAKE_DAILY_LIMIT} times a day and you have used them all. ` +
        'It will be available again tomorrow — nothing in your vault is affected.',
      // To the end of the rolling window is unknowable without the oldest
      // entry's timestamp; an hour is an honest "come back later" that does not
      // pretend to precision.
      3600,
    );
  }

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: INTAKE_ACTION,
    entity: 'vault',
    detail: { used: used + 1, limit: INTAKE_DAILY_LIMIT },
  });
}
