/**
 * Claiming a standby role — the moment a roster row stops being a name the owner
 * typed and becomes a person who can be reached.
 *
 * WHAT WAS MISSING. `redeemInvitation` validated the code and stamped
 * `claimed_at`, which made "claimed" mean *someone typed the code*. It bound no
 * identity: no `users` row, no `claimed_user_id`. That is the half that matters,
 * because it is what lets a release transmit nothing secret — the person signs
 * into an account they already have and the dashboard resolves server-side.
 *
 * STAGE ONE OF TWO (docs/standby-architecture.md [A1]). This is the near-instant
 * half: acknowledge and bind. No password to invent, no email to verify, no app
 * to install. A passkey is offered afterwards and is deferrable, because the
 * architecture's whole bet is claim conversion and the first thing a contact
 * meets must not be a security ceremony for a product they do not use.
 *
 * THE MULTI-HAT RULE, WHICH IS EASY TO GET WRONG (§3.7 rule 2). A contact who is
 * already signed in — because they are an owner themselves, or already stand by
 * for someone else — must LINK a second relationship, never mint a second
 * account. A second `users` row severs every standby link that person already
 * holds, which silently breaks the acquisition loop this architecture was adopted
 * for. `existingUserId` is how the caller says "this is already someone".
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import { hashToken, type PersonType } from './invitations';

/**
 * Matches `recipient_codes` (migration 017) and `verifier_codes` (015), which
 * already carry this guard. An invitation lives 30 days rather than 24–72 hours,
 * and under the standby architecture it is the FRONT DOOR — the thing that binds
 * a human identity to a roster row — so it earns the same treatment.
 */
export const MAX_INVITE_FAILED_ATTEMPTS = 10;

export interface ClaimResult {
  userId: string;
  ownerId: string;
  personId: string;
  personType: PersonType;
  /** True when an existing account gained a relationship rather than being created. */
  linkedExisting: boolean;
}

/** One message for unknown, expired and already-used. Which one it was is not the caller's business. */
const REFUSAL = 'That code is not valid, or it has already been used.';

export async function claimStandbyRole(params: {
  token: string;
  existingUserId?: string;
}): Promise<ClaimResult> {
  const { token, existingUserId } = params;
  const tokenHash = hashToken(token);

  // Expiry and single-use are filtered in SQL, so a row that must not be
  // redeemable never reaches JS and all three refusals look identical.
  const found = await query<{
    id: string;
    owner_id: string;
    person_id: string;
    person_type: PersonType;
    failed_attempts: number | null;
  }>(
    `SELECT id, owner_id, person_id, person_type, failed_attempts
       FROM invitations
      WHERE token_hash = $1
        AND claimed_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [tokenHash],
  );

  const invite = found.rows[0];
  if (!invite) throw new ValidationError(REFUSAL, 'token');

  // NULL reads as 0 — migration 021 could not add NOT NULL to an existing table.
  if (Number(invite.failed_attempts ?? 0) >= MAX_INVITE_FAILED_ATTEMPTS) {
    await query(
      `UPDATE invitations SET failed_attempts = failed_attempts + 1 WHERE token_hash = $1`,
      [tokenHash],
    );
    throw new ValidationError(REFUSAL, 'token');
  }

  // Single use, claimed before any identity work: if the binding below fails,
  // the code is still spent. Deliberate — a code that survives a partial claim
  // is a code that can be replayed, and a stuck claim is recoverable by the
  // owner reissuing, which is a conversation rather than a vulnerability.
  await query(`UPDATE invitations SET claimed_at = now() WHERE id = $1`, [invite.id]);

  const table = invite.person_type === 'verifier' ? 'verifiers' : 'recipients';

  let userId: string;
  let linkedExisting: boolean;

  if (existingUserId) {
    // Already a person here. Link, never create (§3.7 rule 2).
    userId = existingUserId;
    linkedExisting = true;
  } else {
    // Bind to the address the OWNER named. Asking the claimer to type one would
    // add a field to the flow whose conversion the whole architecture rests on,
    // and would let a claimer bind the slot to an address the owner never chose.
    const person = await query<{ email: string }>(
      `SELECT email FROM ${table} WHERE id = $1 LIMIT 1`,
      [invite.person_id],
    );
    const email = person.rows[0]?.email;
    if (!email) throw new ValidationError(REFUSAL, 'token');

    const upserted = await query<{ id: string }>(
      `INSERT INTO users (email, auth_sub)
       VALUES ($1, $2)
       ON CONFLICT (auth_sub) DO UPDATE SET last_active_at = now()
       RETURNING id`,
      [email, `standby:${email.trim().toLowerCase()}`],
    );
    userId = upserted.rows[0].id;
    linkedExisting = false;
  }

  await query(
    `UPDATE ${table}
        SET claimed_user_id = $1, standby_state = 'claimed'
      WHERE id = $2 AND owner_id = $3`,
    [userId, invite.person_id, invite.owner_id],
  );

  // Against the OWNER: it is their circle that changed, and their audit chain
  // that has to be able to show when each person became reachable.
  await writeAuditEntry(invite.owner_id, {
    actor: `${invite.person_type}:${invite.person_id}`,
    action: 'standby_claimed',
    entity: invite.person_type,
    entityId: invite.person_id,
    detail: { personType: invite.person_type, linkedExisting },
  });

  return {
    userId,
    ownerId: invite.owner_id,
    personId: invite.person_id,
    personType: invite.person_type,
    linkedExisting,
  };
}
