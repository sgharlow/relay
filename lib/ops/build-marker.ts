/**
 * Which build, and which loaded module instance, answered this request?
 *
 * WHY THIS EXISTS (E1.1). On 2026-08-21 nine correctly-signed
 * `invoice.payment_failed` deliveries were spliced at the webhook. All nine
 * reached `sendOnce` with `n=0` from the dedupe check, then wrote no audit row
 * and logged no refusal. Every branch out of `sendOnce` writes SOMETHING, so —
 * in the register's words — that is "not a state the source can produce". The
 * leading explanation is that a STALE MODULE was answering: the dev server was
 * separately proven to serve them. It remains unproven, and the register's own
 * instruction for the next attempt is exact:
 *
 *   "NEXT ATTEMPT MUST FIRST ESTABLISH WHICH BUILD IS ANSWERING — a structural
 *    marker in the RESPONSE BODY, not a log line, since logs were the thing
 *    that disagreed."
 *
 * 🔴 THE SUBTLETY THAT DECIDES THE DESIGN. A marker read from `process.env` on
 * every request would be USELESS here, because a stale module and a fresh one
 * share the same process environment and would print the same string. The
 * question is not "what commit is deployed" — it is "is the code answering me
 * the code I just built". So both fields below are captured **once, at module
 * load**, and travel with the module instance:
 *
 *   - `loadedAt`  — when THIS module object was evaluated. A module carried over
 *                   from a previous build reports the older time.
 *   - `instance`  — random per load. Two different loaded copies answering the
 *                   same server report different ids, which is the observation a
 *                   timestamp alone can miss when two builds land in one second.
 *
 * `sha` is the ordinary "which commit" question and is genuinely read from the
 * environment, because on Vercel it is the only source. It is the least useful
 * of the three for the bug this was written for, and it is first because it is
 * the one a human reads.
 *
 * ⚠️ NOT A SECRET, BUT NOT PUBLIC EITHER. The only caller returns this after
 * Stripe signature verification has already passed, so it reaches Stripe and
 * anyone holding the endpoint secret, and nobody else. Do not move it in front
 * of an auth boundary without re-deciding that.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.1
 */

import { randomBytes } from 'node:crypto';

/**
 * The commit, if the platform tells us.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set automatically on Vercel. `RELAY_BUILD_SHA` is
 * the escape hatch for a LOCAL production build (`next build && next start`),
 * which is precisely the setting route 3 of the E1-prime proof runs in — so the
 * marker has to work where Vercel's variable does not exist, or it is absent
 * from the one run it was built for.
 *
 * ⚠️ EMPTY IS ABSENT, and `??` is the wrong operator for this. A bare
 * `RELAY_BUILD_SHA=` line in a `.env` file — and Vercel's own dashboard — both
 * produce an empty STRING, which `??` happily accepts. That yielded `sha: ""`:
 * a field that is present, falsy, and reads in a JSON body as though the marker
 * itself were broken rather than unset. Found by the test below, not by
 * inspection.
 */
const firstNonEmpty = (...values: Array<string | undefined>): string =>
  values.find((v) => v !== undefined && v.trim() !== '')?.trim() ?? 'unknown';

const sha = firstNonEmpty(
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.RELAY_BUILD_SHA,
).slice(0, 12);

/** Captured at module load — see the header. Never move these into a function. */
const loadedAt = new Date().toISOString();
const instance = randomBytes(4).toString('hex');

export interface BuildMarker {
  sha: string;
  loadedAt: string;
  instance: string;
}

/**
 * The marker for THIS loaded module.
 *
 * Returns a fresh object rather than a shared frozen one so a caller spreading
 * it into a response body cannot mutate what the next caller sees.
 */
export function buildMarker(): BuildMarker {
  return { sha, loadedAt, instance };
}
