/**
 * The fingerprint phrase — the entire assurance model (§3.3).
 *
 * One boolean per person, set by the owner after comparing a short phrase with
 * the contact out of band. No webhook ledger, no acknowledgement state machine,
 * no scheduled sweep.
 *
 * WHAT IT DEFENDS AGAINST, precisely. The claim ticket is a bearer secret for the
 * hours or days between the owner sending it and the contact spending it. If it
 * were intercepted, the interceptor would claim the slot and then look — from the
 * database, from the circle screen, from every angle we have — exactly like the
 * intended person. The fingerprint is the only thing that can separate them, and
 * it works solely because the comparison happens over a channel the attacker does
 * not control: the owner's own voice.
 *
 * NO SECRET IN THE DERIVATION, DELIBERATELY. Mixing in NEXTAUTH_SECRET is the
 * obvious "hardening" and it would be a bug: rotating that secret would change
 * every phrase at once and silently invalidate every confirmation ever made,
 * with no event anywhere to notice. The security here does not come from the
 * phrase being unguessable — it comes from the out-of-band comparison — so the
 * derivation must be stable for the life of the binding and nothing else.
 *
 * It MUST change when `claimed_user_id` changes. A confirmation is an assertion
 * about a specific human holding a specific slot; a re-claim binds a different
 * human, and the old assertion must stop reading as valid (Risk 8).
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { createHash } from 'crypto';

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import type { PersonType } from './invitations';

/**
 * 64 short words chosen to survive a bad phone line: no near-homophones, no
 * plurals of each other, distinct first syllables, all one or two syllables.
 * 4 words from 64 is 24 bits — far more than enough for a comparison a human
 * makes once, against an attacker who cannot influence the value.
 */
export const FINGERPRINT_WORDS = [
  'anchor', 'apple', 'amber', 'arrow',
  'basket', 'bridge', 'button', 'branch',
  'cabin', 'candle', 'carpet', 'copper',
  'daisy', 'dolphin', 'donkey', 'drawer',
  'eagle', 'engine', 'evening', 'echo',
  'fabric', 'feather', 'flint', 'forest',
  'garden', 'ginger', 'granite', 'gravy',
  'hammer', 'harbour', 'hollow', 'hunter',
  'igloo', 'india', 'ivory', 'island',
  'jacket', 'jelly', 'jigsaw', 'jungle',
  'kettle', 'kitten', 'knuckle', 'koala',
  'ladder', 'lantern', 'lemon', 'lobster',
  'magnet', 'marble', 'meadow', 'mitten',
  'napkin', 'nectar', 'nickel', 'nutmeg',
  'oatmeal', 'octopus', 'orbit', 'otter',
  'pantry', 'pebble', 'pilot', 'pumpkin',
] as const;

export const FINGERPRINT_LENGTH = 4;

export interface FingerprintBinding {
  ownerId: string;
  personId: string;
  claimedUserId: string;
}

export function fingerprintFor(b: FingerprintBinding): string {
  const digest = createHash('sha256')
    .update(`relay-fingerprint-v1:${b.ownerId}:${b.personId}:${b.claimedUserId}`)
    .digest();

  const words: string[] = [];
  for (let i = 0; i < FINGERPRINT_LENGTH; i++) {
    // Two bytes per word so the index is not biased by a 64-entry modulo of a
    // single byte, and so adding words to the list later stays uniform.
    const n = (digest[i * 2] << 8) | digest[i * 2 + 1];
    words.push(FINGERPRINT_WORDS[n % FINGERPRINT_WORDS.length]);
  }
  return words.join(' ');
}

/**
 * The owner asserts: I spoke to this person and the phrase matched.
 *
 * Guarded from `claimed` only. Confirming someone who has not claimed would be
 * asserting something about a slot nobody holds, and confirming from `revoked`
 * would resurrect them.
 */
export async function confirmPerson(params: {
  ownerId: string;
  personId: string;
  personType: PersonType;
}): Promise<void> {
  const table = params.personType === 'verifier' ? 'verifiers' : 'recipients';

  const res = await query<{ id: string }>(
    `UPDATE ${table}
        SET standby_state = 'confirmed', fingerprint_confirmed_at = now()
      WHERE id = $1 AND owner_id = $2 AND standby_state = 'claimed'
      RETURNING id`,
    [params.personId, params.ownerId],
  );

  if (res.rows.length === 0) {
    throw new ValidationError(
      'That person has not claimed their place yet, so there is nothing to confirm.',
      'personId',
    );
  }

  await writeAuditEntry(params.ownerId, {
    actor: `owner:${params.ownerId}`,
    action: 'standby_confirmed',
    entity: params.personType,
    entityId: params.personId,
    detail: { personType: params.personType },
  });
}

/**
 * The phrase did NOT match — reject the claim (sprint plan N14).
 *
 * This is the response the whole control exists to enable, and it was missing.
 * `unconfirmPerson` below is guarded on `standby_state = 'confirmed'`, so it
 * cannot touch the case that actually matters: a mismatch is discovered during
 * the setup call, when the person is `claimed` and has never been confirmed.
 * Until 2026-08-12 an owner who found a mismatch had nothing to press — a
 * control that detects an interception and offers no response is decoration.
 *
 * TREAT AS A SECURITY EVENT, NOT A TYPO. A mismatch means the slot is held by
 * somebody other than the person the owner named, so the binding is severed
 * (`claimed_user_id` to NULL, back to `invited`) and every outstanding ticket
 * for that person is killed — the ticket channel is what was compromised, and
 * leaving a live one lets the same interceptor walk back in.
 *
 * Reissuing is deliberately NOT automatic. The owner should choose the channel
 * after an interception, and the invitation UI is one press away.
 */
export async function rejectClaim(params: {
  ownerId: string;
  personId: string;
  personType: PersonType;
}): Promise<void> {
  const table = params.personType === 'verifier' ? 'verifiers' : 'recipients';

  const res = await query<{ id: string }>(
    `UPDATE ${table}
        SET claimed_user_id = NULL,
            standby_state = 'invited',
            fingerprint_confirmed_at = NULL
      WHERE id = $1 AND owner_id = $2
        AND coalesce(standby_state, 'invited') IN ('claimed', 'confirmed')
      RETURNING id`,
    [params.personId, params.ownerId],
  );

  if (res.rows.length === 0) {
    throw new ValidationError(
      'Nobody currently holds that place, so there is nothing to reject.',
      'personId',
    );
  }

  // Kill any live ticket. Marking `claimed_at` is how this schema retires an
  // invitation (see `invitations.ts`), and it is the same mechanism redemption
  // already checks — so this cannot drift from what "spent" means.
  await query(
    `UPDATE invitations SET claimed_at = now()
      WHERE owner_id = $1 AND person_id = $2 AND claimed_at IS NULL`,
    [params.ownerId, params.personId],
  );

  await writeAuditEntry(params.ownerId, {
    actor: `owner:${params.ownerId}`,
    action: 'standby_claim_rejected',
    entity: params.personType,
    entityId: params.personId,
    detail: { personType: params.personType, reason: 'fingerprint_mismatch' },
  });
}

/**
 * Withdraw a confirmation — back to `claimed`, not to `invited`.
 *
 * They still hold the slot; what the owner is retracting is the assertion that
 * it is really them. Used when the phrase does not match (the missing half of
 * the mismatch path, sprint plan N14) and when a re-claim changes the identity.
 */
export async function unconfirmPerson(params: {
  ownerId: string;
  personId: string;
  personType: PersonType;
  reason: 'mismatch' | 'reclaimed';
}): Promise<void> {
  const table = params.personType === 'verifier' ? 'verifiers' : 'recipients';

  await query(
    `UPDATE ${table}
        SET standby_state = 'claimed', fingerprint_confirmed_at = NULL
      WHERE id = $1 AND owner_id = $2 AND standby_state = 'confirmed'`,
    [params.personId, params.ownerId],
  );

  await writeAuditEntry(params.ownerId, {
    actor: `owner:${params.ownerId}`,
    action: 'standby_unconfirmed',
    entity: params.personType,
    entityId: params.personId,
    detail: { reason: params.reason },
  });
}
