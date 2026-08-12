/**
 * Passive liveness — [A4].
 *
 * The signal worth having is "is this person still operating", not "did they
 * press a button". Recording it from actions the owner already takes removes the
 * only recurring friction in the product, and it is a more accurate measure of
 * the thing the dead-man's-switch actually cares about.
 *
 * It also resolves toward ARMED, which is the safe direction (principle 4): more
 * evidence of life means fewer releases, never more.
 *
 * ⚠️ WHY THIS IS NOT "ANY AUTHENTICATED REQUEST".
 * A phone left logged in in a hospital drawer will poll and refresh for days
 * without a human touching it. If that counted, it would keep marking its owner
 * alive and **suppress the dead-man's-switch at exactly the moment it exists to
 * fire** — the owner is in hospital, which is the scenario, and the product would
 * quietly do nothing. That fails safe rather than open, so it is not a security
 * hole; it is silent feature death, which is the failure this codebase produces
 * most often. Hence: writes only, listed explicitly, and anything unrecognised
 * counts as not-deliberate.
 *
 * §3.7 rule 8: a multi-hat user acting in someone else's context must not extend
 * their own liveness. Confirming a release for Margaret says nothing about
 * whether you are still around to look after your own vault.
 *
 * Feature: relay-standby
 * Requirements: 4.2, J5
 */

import { query } from '../db/connection';

/** Deliberate = the person changed something. Reads are not evidence of a human. */
const DELIBERATE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isDeliberate(method: string): boolean {
  return DELIBERATE_METHODS.has(String(method ?? '').toUpperCase());
}

export async function recordDeliberateActivity(params: {
  userId: string;
  method: string;
  /**
   * Whose vault this action was about. Omit for actions on the user's own
   * account. When present and different from `userId`, nothing is recorded.
   */
  actingForOwnerId?: string;
}): Promise<void> {
  if (!isDeliberate(params.method)) return;
  if (params.actingForOwnerId && params.actingForOwnerId !== params.userId) return;

  try {
    await query(`UPDATE users SET last_active_at = now() WHERE id = $1`, [params.userId]);
  } catch {
    // Liveness is a side effect of the request, never its purpose. An owner
    // saving a vault item must not see it fail because a timestamp could not be
    // written; the scheduled sweep reads `last_active_at` and a missed stamp
    // only ever errs toward escalating, which is the safe direction.
  }
}
