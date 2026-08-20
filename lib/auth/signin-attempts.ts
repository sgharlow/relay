/**
 * The durable half of the owner front door's attempt budget.
 *
 * `lib/auth/signin-throttle.ts` counts failures in process memory, which is
 * per-INSTANCE — `lib/http/rate-limit.ts` says in its own header that this is
 * not a security boundary, and serverless means many instances, so a
 * distributed attempt against one address is under-counted by construction:
 * each instance sees a fraction of the attempts and none of them ever reaches
 * ten. This module is the row that fixes that, behind the same four functions,
 * so the throttle is the only thing that composes them and callers never learn
 * where a count is kept.
 *
 * ⚠️ EVERY FUNCTION HERE IS BEST-EFFORT AND NONE OF THEM THROWS. This is the
 * non-negotiable property, not a convenience. It sits on the authentication
 * path, and an authentication control whose own failure locks out every owner
 * is a worse outcome than the gap it closes. A database that is unreachable,
 * slow, or missing this table degrades the budget to in-memory counting — which
 * is exactly where it was before, and which still works.
 *
 * 🔴 THE DEPLOY-ORDER TRAP THIS DELIBERATELY DOES NOT REPEAT. Migration 029
 * shipped `auth_challenges`, and `sealChallenge()` THREW when the table was
 * absent — so deploying the code before the migration stopped passkey
 * registration and sign-in, and it did, for four minutes on 2026-08-15 while
 * the migration was being applied. The lesson is not "apply migrations first";
 * it is that a security control on the front door must degrade rather than
 * fail closed. A missing relation here is detected ONCE, logged, and never
 * asked about again until the process restarts.
 *
 * THE ADDRESS IS NEVER STORED. `signinKeyFor()` hashes it, so this table cannot
 * become a browsable list of every address anybody ever tried — including the
 * many that have no account, which must still be counted or the throttle itself
 * would tell an attacker which addresses are real. See migration 036's header.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { createHash } from 'node:crypto';
import { query } from '../db/connection';

/** Postgres/DSQL SQLSTATE for `relation does not exist`. */
const UNDEFINED_TABLE = '42P01';

/**
 * Set once when the table turns out not to exist, so a cluster without
 * migration 036 costs one failed query per process rather than one per attempt.
 *
 * ⚠️ Deliberately NOT reset on success and NOT time-based. A process that has
 * seen the relation missing keeps using memory until it restarts, which on
 * Vercel is minutes. The alternative — retrying every attempt — turns a missing
 * migration into sustained load on the sign-in path, and the whole point of
 * this module is that it can never make sign-in worse.
 */
let relationMissing = false;

/** Test seam. */
export function _resetSigninAttemptsForTesting(): void {
  relationMissing = false;
}

/** Exported so a test can assert the fallback latched rather than inferring it. */
export function _durableStoreUnavailable(): boolean {
  return relationMissing;
}

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

/**
 * Notices a missing table once, swallows everything else.
 *
 * A missing relation is a CONFIGURATION fact worth saying out loud exactly one
 * time. Any other error — a timeout, a connection reset, a permission denial —
 * is an operational blip that the caller has already decided to tolerate, and
 * logging one line per sign-in attempt during a DSQL wobble would bury the log
 * at the moment somebody needs to read it.
 */
function absorb(err: unknown, where: string): void {
  if (isUndefinedTable(err)) {
    if (!relationMissing) {
      relationMissing = true;
      console.warn(
        `[signin-attempts] table signin_attempts is absent (${where}) — the sign-in budget is ` +
          'in-memory only until migration 036 is applied to this cluster. Sign-in is unaffected.',
      );
    }
    return;
  }
  // Everything else is silent by design. See the header.
}

/**
 * The key this module counts against: SHA-256 of the normalised address.
 *
 * Exported because the caller must not invent its own — two normalisations
 * means two budgets for one person, which is the control undone by a shift key.
 * `signin-throttle.ts` normalises the same way for its in-memory map, and
 * `signin-throttle.test.ts` pins that they agree.
 */
export function signinKeyFor(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/**
 * Failures recorded against an address inside the window.
 *
 * Returns `null` when the durable store cannot answer — which the caller must
 * treat as "no information", never as zero. Zero is a claim that the address is
 * clean; null is an admission that we do not know, and only one of those is
 * true when the database is unreachable.
 */
export async function durableFailureCount(
  email: string,
  windowMs: number,
): Promise<number | null> {
  if (relationMissing) return null;

  try {
    const seconds = Math.ceil(windowMs / 1000);
    const res = await query<{ n: string }>(
      `SELECT count(*) AS n FROM signin_attempts
        WHERE email_key = $1 AND failed_at > now() - make_interval(secs => $2)`,
      [signinKeyFor(email), seconds],
    );
    const raw = res?.rows?.[0]?.n;
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    absorb(err, 'count');
    return null;
  }
}

/**
 * Records one failure. Append-only: one row per failure, never a counter to
 * increment.
 *
 * Two separate INSERTs never conflict under snapshot isolation, so this needs
 * no OCC retry — and the failure path of an authentication control is the worst
 * place in the product to be reasoning about write-write conflicts. Migration
 * 036's header carries the full argument, including why `ON CONFLICT` is not
 * an option in this data layer.
 */
export async function recordDurableFailure(email: string): Promise<void> {
  if (relationMissing) return;

  try {
    await query(`INSERT INTO signin_attempts (email_key) VALUES ($1)`, [signinKeyFor(email)]);
  } catch (err) {
    absorb(err, 'record');
  }
}

/**
 * Forgets every failure for an address, after a correct code.
 *
 * This is what makes it a failure budget rather than a rate limit: somebody who
 * fumbled four codes and then got one right starts again from zero, and an
 * attacker — who by definition never reaches this call — never gets the reset.
 */
export async function clearDurableFailures(email: string): Promise<void> {
  if (relationMissing) return;

  try {
    await query(`DELETE FROM signin_attempts WHERE email_key = $1`, [signinKeyFor(email)]);
  } catch (err) {
    absorb(err, 'clear');
  }
}

/**
 * Housekeeping. Rides the heartbeat cron, like `sweepExpiredChallenges`.
 *
 * ⚠️ NOT A DEAD-MAN'S-SWITCH CANDIDATE, and this is the same ruling
 * `auth_challenges` carries. Expiry is a predicate on the read path, so a row
 * older than the window counts for nothing whether or not this ever runs. If
 * the sweep stopped, the table would grow and nothing would become less safe —
 * so alerting on its absence would be alerting on disk usage while dressed as
 * a security alarm.
 */
export async function sweepOldSigninAttempts(graceHours = 24): Promise<number> {
  if (relationMissing) return 0;

  try {
    const res = await query(
      `DELETE FROM signin_attempts WHERE failed_at < now() - make_interval(hours => $1)`,
      [graceHours],
    );
    return res?.rowCount ?? 0;
  } catch (err) {
    absorb(err, 'sweep');
    return 0;
  }
}
