/**
 * How the owner is named to everyone else.
 *
 * Every outbound message that refers to the owner used their raw email address,
 * because `users` had no name column while recipients and verifiers did. A real
 * family read "margaret.chen1948@gmail.com asked you to be a trusted contact" —
 * on a product whose whole proposition is trust, addressing people by raw email
 * is the strongest phishing signal left in the outbound mail. It lands hardest
 * on the verifier, who has no stake and is the likeliest to bin it, and J7 only
 * works if verifiers answer.
 *
 * One accessor, used everywhere, so the fallback can never drift between
 * messages: a family must not get "Margaret" in one email and a raw address in
 * the next.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J7-R1
 */

import { query } from '../db/connection';

/** Last resort when an owner row is missing entirely. */
export const UNKNOWN_OWNER_LABEL = 'Someone you know';

/**
 * Formats an owner label from a name and an email.
 *
 * Pure, so the precedence is testable without a database. Falls back to the
 * email address rather than inventing anything — existing owners have no name
 * and a made-up one would be worse than none.
 */
export function formatOwnerLabel(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = displayName?.trim();
  if (name) return name;
  const addr = email?.trim();
  return addr || UNKNOWN_OWNER_LABEL;
}

/** Looks up how to refer to an owner in a message to someone else. */
export async function getOwnerLabel(ownerId: string): Promise<string> {
  const r = await query<{ display_name: string | null; email: string | null }>(
    `SELECT display_name, email FROM users WHERE id = $1 LIMIT 1`,
    [ownerId],
  );
  const row = r.rows[0];
  return formatOwnerLabel(row?.display_name, row?.email);
}
