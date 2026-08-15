/**
 * Single-use nonces for authentication ceremonies.
 *
 * WHAT A SIGNED TOKEN CANNOT DO. `lib/auth/webauthn.ts` sealed its challenge
 * into a five-minute JWT and argued that this needed "no new table and therefore
 * no expiry sweep". The cost argument was right and the security argument was
 * not: a signature proves WE minted the token, and says nothing at all about
 * whether it has already been spent. Replay inside the window was open. The same
 * hole would exist in any elevation cookie for the same reason, which is why
 * step-up elevation is recorded here too rather than living in a claim.
 *
 * THE BURN IS A COMPARE-AND-SET, not a read-then-write. Two requests arriving
 * with the same nonce must not both succeed, and `SELECT … then UPDATE` loses
 * that race by construction. A single conditional UPDATE decides it in the
 * database: exactly one caller sees `rowCount === 1`.
 *
 * ON DSQL that CAS can still surface a 40001 when two writers touch the row in
 * the same instant, so it goes through `withOccRetry` — and a retry is CORRECT
 * here rather than merely tolerated, because the second attempt reads the row
 * the winner already consumed and returns `false`, which is the right answer.
 *
 * FAIL CLOSED. Every failure path returns "not valid". A database blip during a
 * burn refuses the ceremony rather than waving it through; the caller's fallback
 * is to ask the person to try again, which costs a retry and never a session.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J4-R9, J4-R11, J13-R1, J13-R2
 */

import { randomUUID } from 'crypto';

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';

/**
 * The ceremonies that mint a nonce.
 *
 * `registration` and `authentication` are the two WebAuthn purposes and keep
 * their existing names — the purpose claim already separated them, and losing
 * that separation would let a challenge minted while REGISTERING a passkey be
 * replayed into the sign-in path.
 *
 * `step-up` is elevation: proof that the person at the keyboard re-authenticated
 * within the last few minutes.
 */
export const CHALLENGE_PURPOSES = ['registration', 'authentication', 'step-up'] as const;

export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

/** A fresh nonce. 128 bits of randomness; collision is not a failure mode. */
export function newChallengeId(): string {
  return randomUUID();
}

/**
 * Records a nonce as live for `ttlSeconds`.
 *
 * Throws on failure, deliberately: a ceremony whose nonce was not recorded must
 * not start, because `burnChallenge` would then refuse the assertion at the end
 * of it and the person would be told their perfectly good passkey failed.
 */
export async function recordChallenge(args: {
  jti: string;
  purpose: ChallengePurpose;
  ttlSeconds: number;
  userId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO auth_challenges (jti, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [args.jti, args.purpose, args.userId ?? null, args.ttlSeconds],
  );
}

/**
 * Spends a nonce. Returns true exactly once per nonce, ever.
 *
 * False means: never issued, already spent, expired, issued for a different
 * purpose, or unreadable. The caller must not tell those apart in its response —
 * the distinction is useful to an attacker and to nobody else.
 */
export async function burnChallenge(jti: string, purpose: ChallengePurpose): Promise<boolean> {
  try {
    return await withOccRetry(async () => {
      const res = await query(
        `UPDATE auth_challenges
            SET consumed_at = now()
          WHERE jti = $1
            AND purpose = $2
            AND consumed_at IS NULL
            AND expires_at > now()`,
        [jti, purpose],
      );
      return (res?.rowCount ?? 0) === 1;
    });
  } catch {
    // Fail closed. See the header.
    return false;
  }
}

/**
 * Is this nonce still live, WITHOUT spending it?
 *
 * Exists for elevation, which is a window rather than a single action: an owner
 * who re-authenticated to export should not be re-prompted between reading the
 * manifest and reading the last item. Anything that is genuinely one-shot —
 * every WebAuthn ceremony, closing an account — calls `burnChallenge` instead.
 */
export async function isChallengeLive(jti: string, purpose: ChallengePurpose): Promise<boolean> {
  try {
    const res = await query<{ one: number }>(
      `SELECT 1 AS one FROM auth_challenges
        WHERE jti = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [jti, purpose],
    );
    return (res?.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Ends every live nonce of one purpose for one user.
 *
 * This is what makes elevation REVOCABLE, which is the whole reason it is a row
 * rather than a claim. Signing out, bumping the session epoch, or recovering an
 * account all drop elevation immediately rather than leaving a five-minute
 * window open on a device the person has just declared they do not control.
 */
export async function revokeChallenges(
  userId: string,
  purpose: ChallengePurpose,
): Promise<number> {
  try {
    const res = await query(
      `UPDATE auth_challenges
          SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
    return res?.rowCount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Housekeeping. NOT A GUARD — see migration 029.
 *
 * Expiry is enforced by the `expires_at > now()` predicate on every burn, in the
 * database, on the read path. Deleting spent and stale rows only reclaims space.
 * If this never runs again the table grows and nothing becomes less safe, which
 * is precisely why it rides the existing heartbeat cron instead of becoming a
 * second scheduled thing that can silently stop.
 *
 * The grace period keeps recently-spent rows around long enough to be useful
 * when reading back what happened during an incident.
 */
export async function sweepExpiredChallenges(graceHours = 24): Promise<number> {
  try {
    const res = await query(
      `DELETE FROM auth_challenges
        WHERE expires_at < now() - make_interval(hours => $1)`,
      [graceHours],
    );
    return res?.rowCount ?? 0;
  } catch {
    // Housekeeping must never fail the job it rides on.
    return 0;
  }
}
