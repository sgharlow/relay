/**
 * A ceiling on how much mail one account can make Relay send.
 *
 * 🔴 THE INVITATION PATH WAS COMPLETELY UNMETERED until 2026-08-13, and it is
 * the only place in the product where an authenticated user chooses both the
 * RECIPIENT and part of the CONTENT of a message Relay sends from its own
 * domain. `POST /api/invitations` had no rate limit, no daily cap and no tier
 * gate; `POST /api/verifiers` had no cap on how many addresses could be named in
 * the first place. Signup is self-serve and free, so the whole sequence —
 * register, name N people, invite each of them, repeat — was available to
 * anybody.
 *
 * WHAT THAT IS WORTH TO AN ATTACKER, stated plainly because it is what sizes the
 * limit: mail from a domain with real sending reputation, addressed to whoever
 * they like, whose subject carries their chosen display name and whose first
 * line carries their chosen contact name. That is a phishing lure with correct
 * SPF and DKIM. And the sender is a Resend account SHARED with another project,
 * so the reputation damage lands somewhere else entirely.
 *
 * lib/ai/intake-budget.ts already answered the same question for the AI seam,
 * and this is deliberately the same shape — down to the audit-log counter — so
 * there is one pattern for "an authenticated caller can spend something of ours"
 * rather than two. Read that file's header for why the count is a soft ceiling
 * and why the entry is written before the spend rather than after.
 *
 * TWO LAYERS, matching that precedent:
 *   1. a per-owner burst limit at the route (in-memory, per-instance)
 *   2. this: a rolling 24-hour count from the DATABASE, shared by every instance
 *
 * ⚠️ IT METERS SENDS, NOT INVITATIONS. The owner-delivered arm
 * (`BETA_INVITE_CHANNEL`) transmits nothing — the owner reads the code down the
 * phone — so it consumes no budget. Metering it would throttle the arm the
 * architecture actually wants people to use, to bound a cost it does not incur.
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';

/** The audit action that records one invitation EMAIL. Also the meter's unit. */
export const INVITE_EMAIL_ACTION = 'invitation_email_sent';

/**
 * Invitation emails per owner per rolling 24 hours.
 *
 * Sized from what a real circle costs. The free tier allows four recipients and
 * four verifiers, so a complete circle is eight invitations; twenty leaves room
 * to re-send to every one of them twice more in a day — which is already beyond
 * what "they never got it" needs — while turning an unbounded relay into a
 * bounded one. A paid owner with a larger circle who genuinely hits this is the
 * conversation worth having, which is what the message routes them to.
 */
export const INVITE_EMAIL_DAILY_LIMIT = 20;

/** Sends per owner in this window, on this instance. Catches a hammering client. */
export const INVITE_EMAIL_BURST_LIMIT = 5;
export const INVITE_EMAIL_BURST_WINDOW_MS = 10 * 60 * 1000;

export class InviteBudgetError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'InviteBudgetError';
    Object.setPrototypeOf(this, InviteBudgetError.prototype);
  }
}

/** How many invitation emails this owner has sent in the last 24 hours. */
export async function inviteEmailsToday(ownerId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log
      WHERE owner_id = $1 AND action = $2 AND ts > now() - INTERVAL '24 hours'`,
    [ownerId, INVITE_EMAIL_ACTION],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Reserves one invitation email against the daily ceiling, or throws.
 *
 * Writing the audit entry IS the reservation. `writeAuditEntry` blocks its
 * caller when it fails, by design, so a send cannot proceed unrecorded — which
 * also means an owner can see, in their own audit trail, every message the
 * product sent on their behalf.
 */
export async function reserveInviteEmail(ownerId: string): Promise<void> {
  const used = await inviteEmailsToday(ownerId);
  if (used >= INVITE_EMAIL_DAILY_LIMIT) {
    throw new InviteBudgetError(
      `Relay can send ${INVITE_EMAIL_DAILY_LIMIT} invitations a day for you and you have used ` +
        'them all. Nobody has been removed and nothing else is affected — you can still give ' +
        'somebody their code yourself, and the rest will send again tomorrow.',
      // To the end of the rolling window is unknowable without the oldest
      // entry's timestamp; an hour is an honest "come back later".
      3600,
    );
  }

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: INVITE_EMAIL_ACTION,
    entity: 'invitation',
    detail: { used: used + 1, limit: INVITE_EMAIL_DAILY_LIMIT },
  });
}
