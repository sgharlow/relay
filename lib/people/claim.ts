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
import { upsertUser } from '../auth/upsert-user';
import { recordCodeMiss } from '../ops/guess-watch';

/**
 * Matches `recipient_codes` (migration 017) and `verifier_codes` (015), which
 * already carry this guard. An invitation lives 30 days rather than 24–72 hours,
 * and under the standby architecture it is the FRONT DOOR — the thing that binds
 * a human identity to a roster row — so it earns the same treatment.
 */
export const MAX_INVITE_FAILED_ATTEMPTS = 10;

/**
 * §3.7 rule 10 (B23): cap how many standby relationships one person may hold,
 * counted across BOTH roster tables and across every owner. This bounds the
 * abuse surface §7 Risk 4 names — one identity accumulating standby positions
 * over many vulnerable owners — while staying far above what any genuine
 * helper needs: the largest honest case the architecture describes is one
 * person standing by for an extended family.
 *
 * Enforced here because claiming is the ONLY moment a relationship binds to an
 * identity (`claimed_user_id` is written nowhere else). An owner adding a name
 * to their roster is not counted — a typed name is not a relationship yet, and
 * refusing the owner's add would tell them about the contact's other circles,
 * which rule 4 forbids.
 */
export const MAX_STANDBY = 10;

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
  if (!invite) {
    // Unknown, expired or already-claimed all arrive here identically, so this
    // over-counts slightly. Deliberate: the alternative is a second query to
    // tell them apart, on the unauthenticated path, to make a signal quieter.
    await recordCodeMiss('invitation');
    throw new ValidationError(REFUSAL, 'token');
  }

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
  //
  /*
    🔴 AND UNTIL 2026-08-13 IT WAS NOT ACTUALLY SINGLE USE. The stamp was
    `WHERE id = $1` with no predicate, so the `claimed_at IS NULL` filter in the
    SELECT above was doing all the work — against a snapshot. Two people typing
    the same code at once both passed it, both stamped, and both ran the binding
    below; the slot ended up bound to whichever wrote last while the other held
    a minted session.

    This is the sharpest instance of the five, because claiming is the moment a
    roster row stops being a name the owner typed and becomes a human identity.
    Exactly one caller may win that, and the database is what decides.
  */
  const claimed = await query(
    `UPDATE invitations SET claimed_at = now()
      WHERE id = $1 AND claimed_at IS NULL`,
    [invite.id],
  );
  if (claimed.rowCount === 0) {
    // Lost the race. Same refusal as an unknown or expired code — which one it
    // was is not the caller's business.
    throw new ValidationError(REFUSAL, 'token');
  }

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

    // Reuse `upsertUser` rather than writing this INSERT here. It implements the
    // app-level intent-read (SELECT → UPDATE or INSERT) that this data layer
    // requires: migration 002, which would have made `auth_sub` UNIQUE, is a
    // DRAFT that was deliberately never applied, because Aurora DSQL may not
    // enforce UNIQUE secondary indexes — so `INSERT … ON CONFLICT (auth_sub)`
    // errors on real infra.
    //
    // This comment exists because the first version of this file used
    // ON CONFLICT and returned a 500 from production on the very first live
    // claim. Unit tests could not see it: the failure lives in the database, not
    // in the logic.
    const record = await upsertUser(`standby:${email.trim().toLowerCase()}`, email);
    userId = record.id;
    linkedExisting = false;
  }

  // §3.7 rule 10 (B23): refuse the binding when this person already holds
  // MAX_STANDBY relationships. The row being claimed is excluded so a re-claim
  // of a slot this person already holds — a reissued invitation after a
  // fingerprint reset — is never refused by its own existing row. The check is
  // application-level (DSQL enforces no cross-table constraint), so two claims
  // racing at the boundary can land one over the cap; that is a bounded excess
  // on an abuse limit, not a correctness hole.
  //
  // The code is already spent (single-use stamps before identity work, above),
  // so recovery is the owner reissuing once a slot is free — a conversation,
  // not a replay surface, the same trade the stamp ordering already makes.
  //
  // §3.7 rule 4 shapes both sides of the refusal: the message names no count
  // and no owners, and NOTHING is written to this owner's audit chain — a cap
  // refusal recorded there would tell the owner this contact stands by for
  // many others, which is exactly the enumeration the rule forbids. The owner
  // sees only what they can already see: a slot that is still unclaimed.
  const held = await query<{ n: string }>(
    `SELECT (SELECT count(*) FROM recipients WHERE claimed_user_id = $1 AND id <> $2)
          + (SELECT count(*) FROM verifiers  WHERE claimed_user_id = $1 AND id <> $2) AS n`,
    [userId, invite.person_id],
  );
  const capRow = held.rows[0];
  const heldCount = Number(capRow?.n);
  if (!capRow || !Number.isFinite(heldCount)) {
    // Blind-guard shape (ladder-claim.ts): a count query that returns nothing
    // must FAIL, never read as zero — reading as zero silently disables the cap.
    throw new Error('standby cap count returned no usable row — refusing to guess');
  }
  if (heldCount >= MAX_STANDBY) {
    throw new ValidationError(
      'You already stand by for the maximum number of people Relay supports. ' +
        'Resign a standby role you no longer hold, then ask for a fresh invitation.',
      'token',
    );
  }

  // `fingerprint_confirmed_at = NULL` is load-bearing, not tidiness. A re-claim
  // binds a different `claimed_user_id`, which changes the derived phrase — so an
  // earlier confirmation was an assertion about a DIFFERENT human holding this
  // slot and must not silently stand. The owner's light drops to amber and they
  // are asked again (Risk 8).
  const bound = await query(
    // `break_glass_only` is cleared in the SAME statement as the binding, not by
    // a follow-up call: the marker records that somebody will never hold an
    // account, and they just did. A separate write could be forgotten or fail on
    // its own, leaving an exclusion outliving its reason — which is the failure
    // this feature exists to make visible, not to cause (§8.1).
    `UPDATE ${table}
        SET claimed_user_id = $1, standby_state = 'claimed', fingerprint_confirmed_at = NULL,
            break_glass_only = false
      WHERE id = $2 AND owner_id = $3`,
    [userId, invite.person_id, invite.owner_id],
  );

  /*
    🔴 NOBODY READ THIS ROWCOUNT UNTIL 2026-08-21, and one branch above skips
    the only other check. Removing a person used to leave their invitation
    behind (deleteRecipient/deleteVerifier cascaded rules and policies and
    nothing else), so an orphan invitation could still be typed. The branch that
    creates a user catches it — the email lookup returns nothing and refuses —
    but the `existingUserId` branch never looks the person up, so a signed-in
    contact reached this statement, matched ZERO rows, and carried on: the code
    was burned, a session was minted with no role attached, and `standby_claimed`
    went into the OWNER's tamper-evident log naming a person who does not exist.

    The cascade is fixed at source. This is the guard at the place the mistake
    lands, which is where it belongs — invitations minted before that fix have
    up to thirty days left to run.
  */
  if (bound.rowCount === 0) {
    throw new ValidationError(REFUSAL, 'token');
  }

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
