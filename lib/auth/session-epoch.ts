/**
 * Session invalidation — making a revoked session actually stop working.
 *
 * THE DEFECT THIS CLOSES, proven on production 2026-08-12. A browser holding a
 * session for a user that had been DELETED from `users` was still accepted:
 * `/api/standby` answered 200 rather than 401, because the session is a
 * self-contained JWT and nothing checked that the id still existed. "Delete my
 * account" did not mean "signed out", and no lever existed to revoke a session.
 *
 * It is §3.7 rule 1 made real. That rule already forbids reading `standbyFor`
 * from the token as authorization, because a JWT is a snapshot and the gap
 * between snapshot and truth is where revocation lives. The session itself had
 * the same gap.
 *
 * THE COST, STATED. This adds one indexed primary-key read per authenticated
 * request. That is the honest price of immediate revocation on a stateless
 * session, and it is small next to the queries every route behind it already
 * makes.
 *
 * THE FAILURE DIRECTION IS DELIBERATE. A lookup that cannot run DENIES. A
 * database blip therefore signs people out rather than silently honouring a stale
 * token — and every route behind this guard queries the database anyway, so a
 * blip was already going to fail. The only question was whether it failed loudly.
 *
 * Feature: relay-standby
 * Requirements: 17.1
 */

import { query } from '../db/connection';

/** Current epoch for a user, or null if that user no longer exists. */
export async function readSessionEpoch(userId: string): Promise<number | null> {
  const res = await query<{ session_epoch: number | null }>(
    `SELECT session_epoch FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (res.rows.length === 0) return null;
  return Number(res.rows[0].session_epoch ?? 0);
}

/**
 * Is this token still good?
 *
 * `tokenEpoch` undefined means a session minted before this shipped. Those are
 * honoured against an unbumped user on purpose: rejecting them would sign out
 * every existing user the moment this deploys, which is a worse outcome than
 * letting them expire naturally. One bump invalidates them, so "sign out
 * everywhere" still works on old sessions.
 */
export async function isSessionCurrent(
  userId: string,
  tokenEpoch: number | undefined,
): Promise<boolean> {
  let current: number | null;
  try {
    current = await readSessionEpoch(userId);
  } catch {
    return false; // Deny. See the header.
  }

  if (current === null) return false; // Deleted user — the defect this closes.
  return (tokenEpoch ?? 0) >= current;
}

/**
 * Invalidate every session this user holds.
 *
 * `coalesce` because the column is nullable and NULL + 1 is NULL — which would
 * silently leave the epoch unset and the sessions valid, the exact failure this
 * function exists to prevent.
 */
export async function bumpSessionEpoch(userId: string): Promise<number> {
  const res = await query<{ session_epoch: number }>(
    `UPDATE users SET session_epoch = coalesce(session_epoch, 0) + 1
      WHERE id = $1
      RETURNING session_epoch`,
    [userId],
  );
  return Number(res.rows[0]?.session_epoch ?? 0);
}
