/**
 * An attempt budget on the owner's front door.
 *
 * 🔴 WHAT WAS OPEN. Owner sign-in is an email address and a six-digit
 * authenticator code, and nothing else — there is no password, deliberately
 * (src/app/auth/signin/SignInForm.tsx says so where it offers the way back for
 * somebody whose phone is gone). Until this module existed, `authorize` did a
 * database lookup and a code comparison per attempt with no failure counter and
 * no rate limit of any kind. A six-digit code with a ±1-step skew window is
 * three valid values out of a million at any instant, so an attacker who knows
 * an owner's address expects a hit in a few hundred thousand attempts — hours,
 * unattended, against the account that decrypts a family's vault. Nothing would
 * have stopped it and nothing would have noticed it.
 *
 * THE ARGUMENT THAT THIS WAS AN OVERSIGHT RATHER THAN A DECISION, because the
 * distinction decides whether to build this at all: every OTHER guessable
 * credential in this codebase already carries a budget. `recipient-code.ts`,
 * `verifier-code.ts` and `recovery-code.ts` each hold `MAX_FAILED_ATTEMPTS`;
 * `/api/account/step-up` — the SECONDARY factor, on an account somebody has
 * already signed into — calls `rateLimit`; and the `break-glass` provider in
 * auth-options.ts carries a written argument for why ~59 bits of entropy needs
 * neither. The six-digit code is the shortest secret in the product and it was
 * the only one with no argument attached.
 *
 * TWO COUNTERS, BECAUSE THEY STOP DIFFERENT ATTACKS.
 *
 *   per-EMAIL failure budget — the control. The target of a real attack is one
 *     fixed address; the source is whatever the attacker likes. This counts
 *     FAILURES ONLY and resets on a successful sign-in, which is the shape
 *     `recipient-code.ts` uses (`failed_attempts` on the row, cleared when the
 *     code is redeemed) rather than the shape of a request rate limiter. A
 *     person who signs in successfully has proved they are not the attacker.
 *
 *   per-SOURCE attempt limit — a bound on spraying, which the per-email budget
 *     cannot see: one guess of `000000` against ten thousand addresses costs one
 *     attempt each and has a few percent chance of landing. Deliberately
 *     GENEROUS, because a household or an office behind one NAT shares a source
 *     and a guard nobody can satisfy is a lockout.
 *
 * ✅ THE DURABLE HALF LANDED 2026-08-20 (S2-1), and this module is where the two
 * compose. The paragraph that stood here said the in-memory counters were "not
 * a security boundary yet", that a distributed attempt is under-counted because
 * process memory is per-instance, and that the fix was a row. It is kept below
 * because it is still exactly true of the memory layer, and because the seam it
 * predicted is the seam that was used — callers still depend on these four
 * functions and still do not know where a count is kept:
 *
 *   > "⚠️ NEITHER IS A SECURITY BOUNDARY YET, and saying so is load-bearing.
 *   > lib/http/rate-limit.ts explains why in its own header: the counters live
 *   > in process memory, so they are per-instance and a distributed attempt is
 *   > under-counted. This raises the floor from NOTHING to the same control the
 *   > step-up route already has."
 *
 * MEMORY IS STILL CHECKED FIRST, AND IT IS NOT A CACHE. It is a floor that costs
 * no query and cannot be taken away by an unreachable database: an address that
 * has already burnt its budget on THIS instance is refused without touching
 * DSQL. The durable count is consulted only when memory would have let the
 * attempt through, which is also what keeps a spray from turning the sign-in
 * path into load on the database.
 *
 * ⚠️ AND THE DURABLE HALF IS ALLOWED TO BE ABSENT. `lib/auth/signin-attempts.ts`
 * degrades to nothing when the table has not been migrated, when DSQL is
 * unreachable, or when a query times out — it returns `null`, meaning *no
 * information*, which this module treats as "memory decides" and never as
 * "zero failures". Migration 029 is the recorded reason for that shape: it threw
 * when its table was absent and took passkey sign-in down for four minutes.
 *
 * ⚠️ IT MUST NEVER TAKE THE FRONT DOOR DOWN. Every path here is
 * non-throwing and in-memory. An authentication control whose own failure
 * locks out every owner is a worse outcome than the gap it closes.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { rateLimit } from '../http/rate-limit';
import {
  durableFailureCount,
  recordDurableFailure,
  clearDurableFailures,
} from './signin-attempts';

/**
 * Failed sign-ins allowed against ONE address before the door closes.
 *
 * Chosen against a real person rather than against arithmetic. Somebody opens
 * their authenticator, mistypes six digits, or submits a code that rolled over
 * while they were reading it — that is one or two failures, occasionally three
 * on a bad day with a slow phone. Ten leaves a wide margin over that and still
 * reduces an unattended keyspace walk to nothing: at ten attempts per window an
 * attacker needs on the order of a hundred thousand windows to expect a single
 * hit, which is measured in centuries rather than hours.
 *
 * A person who genuinely burns ten in a window is not fumbling; they have lost
 * their authenticator, and the recovery-code path exists for exactly that and
 * carries its own budget and its own entropy argument.
 */
export const MAX_FAILED_ATTEMPTS = 10;

/** How long a burnt budget stays burnt, and how long failures accumulate. */
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Attempts allowed from one source address per window, successes included.
 *
 * Generous on purpose — see the header. This is a bound on spraying, not a
 * per-user control, and the cost of it being wrong is an office full of people
 * who cannot sign in. Three per minute sustained is far above human use and far
 * below a useful spray.
 */
export const MAX_SOURCE_ATTEMPTS = 45;

/** The window the source limit is measured over. */
export const SOURCE_WINDOW_MS = 15 * 60 * 1000;

/** Bounds memory if a spray produces many distinct addresses. */
const MAX_TRACKED_ADDRESSES = 10_000;

interface Budget {
  failures: number;
  resetAt: number;
}

const budgets = new Map<string, Budget>();

/** Test seam — clears every budget. Never called in production. */
export function _resetSigninThrottleForTesting(): void {
  budgets.clear();
}

/**
 * Normalises an address to the key both this module and `authorize` count on.
 *
 * Exported because the caller must not invent its own normalisation: counting
 * `Sam@Example.com` and `sam@example.com` as two budgets would hand an attacker
 * a fresh budget per capitalisation, which is the whole control undone by a
 * shift key.
 */
export function throttleKey(email: string): string {
  return email.trim().toLowerCase();
}

function evictExpired(now: number): void {
  for (const [k, b] of budgets) {
    if (now >= b.resetAt) budgets.delete(k);
  }
  if (budgets.size >= MAX_TRACKED_ADDRESSES) {
    const oldest = budgets.keys().next();
    if (!oldest.done) budgets.delete(oldest.value);
  }
}

export interface SigninGateResult {
  /** May this attempt reach the code comparison at all? */
  allowed: boolean;
  /**
   * Which counter refused, for the server log only.
   *
   * ⚠️ NEVER SURFACED TO THE CALLER. `authorize` returns the same `null` for
   * every refusal — an unknown address, a wrong code and a burnt budget must be
   * indistinguishable from outside, which is the property the provider's own
   * comment already establishes and the one a limiter is most likely to break.
   * A distinguishable "too many attempts" answer confirms that an address holds
   * a Relay account, which is precisely what the uniform failure protects.
   */
  refusedBy?: 'address' | 'source';
}

/**
 * Decides whether an attempt may proceed. Records the source attempt as it goes;
 * failures against the address are recorded separately by `recordSigninFailure`,
 * because only the caller knows whether the code was wrong.
 *
 * Called BEFORE the database lookup on purpose: a refused attempt must cost no
 * query. Each attempt otherwise resolves a TOTP secret from DSQL, so an
 * unbudgeted door is an amplifier against the database as well as a way in.
 */
export async function checkSigninAllowed(
  email: string,
  source: string | null,
  now: number = Date.now(),
): Promise<SigninGateResult> {
  const key = throttleKey(email);
  const budget = budgets.get(key);
  if (budget && now < budget.resetAt && budget.failures >= MAX_FAILED_ATTEMPTS) {
    return { allowed: false, refusedBy: 'address' };
  }

  // A missing source is bucketed with every other unidentifiable client rather
  // than let through unbounded — the same conservative choice `clientKey` makes.
  const sourceKey = `signin:${source ?? 'unknown'}`;
  if (!rateLimit(sourceKey, MAX_SOURCE_ATTEMPTS, SOURCE_WINDOW_MS, now).allowed) {
    return { allowed: false, refusedBy: 'source' };
  }

  /*
    Only now is the database asked, and the ordering is deliberate twice over:
    an address already refused by memory costs no query, and a spray cannot turn
    the sign-in path into sustained load on DSQL.

    `null` means the durable store could not answer — the table is not migrated,
    the cluster is unreachable, the query timed out. That is NOT zero. Zero is a
    claim that the address is clean; null is an admission that we do not know,
    and only one of them is true when the database is down. Treating null as a
    refusal would hand any DSQL blip the power to lock out every owner at once,
    which is the failure this control must never cause.
  */
  const durable = await durableFailureCount(email, FAILURE_WINDOW_MS);
  if (durable !== null && durable >= MAX_FAILED_ATTEMPTS) {
    return { allowed: false, refusedBy: 'address' };
  }

  return { allowed: true };
}

/**
 * Records one failed sign-in against an address.
 *
 * "Failed" means the attempt reached a comparison and lost — a wrong code, an
 * address with no account, or a secret that could not be decoded. All three
 * count, because from outside they are the same event and treating them
 * differently here would rebuild the enumeration oracle the uniform `null` exists
 * to prevent.
 */
export async function recordSigninFailure(
  email: string,
  now: number = Date.now(),
): Promise<void> {
  const key = throttleKey(email);
  const existing = budgets.get(key);

  if (!existing || now >= existing.resetAt) {
    if (budgets.size >= MAX_TRACKED_ADDRESSES) evictExpired(now);
    budgets.set(key, { failures: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else {
    existing.failures += 1;
  }

  // Memory is updated FIRST and unconditionally, so the floor holds even if the
  // durable write is refused, slow, or lands on a cluster without migration 036.
  await recordDurableFailure(email);
}

/**
 * Clears the budget after a successful sign-in.
 *
 * This is what makes it a failure budget rather than a rate limit, and it is
 * the difference between a control and an inconvenience: somebody who fumbled
 * four codes and then got one right starts again from zero, while an attacker —
 * who by definition never succeeds — never gets the reset.
 */
export async function clearSigninFailures(email: string): Promise<void> {
  budgets.delete(throttleKey(email));
  await clearDurableFailures(email);
}

/** Current failure count for an address. Exported for tests, not for gating. */
export function failuresFor(email: string, now: number = Date.now()): number {
  const b = budgets.get(throttleKey(email));
  return b && now < b.resetAt ? b.failures : 0;
}
