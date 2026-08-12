/**
 * Who actually counts toward N-of-M.
 *
 * `getVerifierCount` is a bare `COUNT(*)` over the verifiers roster. That was
 * correct under the old model, where every verifier held an emailed token and so
 * every roster row could act. Under standby it is not, and the failure it
 * produces has no error anywhere: require 2 confirmations from a circle where
 * only 1 person can answer and the release **never completes**. Nothing throws.
 * Nobody is told. That is the shape of bug this codebase keeps producing, and it
 * is why this module exists.
 *
 * ⚠️ THE STAGING TRAP — READ BEFORE TIGHTENING THIS.
 * §4.3 of the architecture says quorum counts *confirmed* participants. Shipping
 * that literally, today, would mean nobody is confirmed and **every quorum in the
 * product becomes unsatisfiable at once**. During the transition an unclaimed
 * verifier can still act by emailed token, so eligibility is "can this person
 * answer by ANY route", not "have they claimed". Tighten to confirmed-only when
 * the token fallback is actually retired — and not before.
 *
 * The one thing the identity model lets us tighten NOW is separation of duties.
 * With `claimed_user_id` on both roster tables, "the same human" is provable
 * rather than inferred from an email spelling, so a verifier who is also a
 * recipient on the same release can be excluded from the count that authorizes
 * their own access. `detectRoleConcentration` could only ever warn about that,
 * and only in the extreme case where one person held every role.
 *
 * Feature: relay-standby
 * Requirements: 3.9, J4-R13
 */

import { ValidationError } from '../validation';
import { readStandbyState } from '../people/standby-state';

export interface VerifierEligibilityRow {
  id: string;
  claimed_user_id: string | null;
  standby_state: string | null;
}

export interface EligibilityContext {
  /** Users who are recipients on this release — they must not authorize themselves. */
  recipientUserIds: string[];
  /** The vault owner. They may be the incapacitated or coerced party. */
  ownerUserId?: string;
}

export function countEligibleVerifiers(
  rows: VerifierEligibilityRow[],
  ctx: EligibilityContext,
): number {
  const conflicted = new Set(ctx.recipientUserIds);
  if (ctx.ownerUserId) conflicted.add(ctx.ownerUserId);

  return rows.filter((r) => {
    // Revoked is the only state that removes the ability to act. `invited` still
    // counts while the emailed-token fallback exists — see the staging note.
    if (readStandbyState(r.standby_state) === 'revoked') return false;

    // Nobody helps authorize their own access, and an owner is not an
    // independent attestation about themselves.
    if (r.claimed_user_id && conflicted.has(r.claimed_user_id)) return false;

    return true;
  }).length;
}

/**
 * Refuse an N that nobody could ever reach, at configuration time, rather than
 * discovering it as a release that quietly never completes.
 *
 * The message names both numbers on purpose: "invalid" tells an owner nothing
 * they can act on, and the action here is always the same — add another person,
 * or ask for fewer.
 */
export function assertQuorumSatisfiable(required: number, eligible: number): void {
  if (!Number.isInteger(required) || required < 1) {
    throw new ValidationError(
      'At least one person has to confirm before access opens.',
      'required_confirmations',
    );
  }
  if (required > eligible) {
    throw new ValidationError(
      `That needs ${required} people to confirm, but only ${eligible} could answer. ` +
        `Add another verifier, or ask for fewer confirmations.`,
      'required_confirmations',
    );
  }
}
