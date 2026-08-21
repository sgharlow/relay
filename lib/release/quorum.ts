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
 * ✅ TIGHTENED TO CONFIRMED 2026-08-12 — the staging note below is now history,
 * kept because the reasoning still governs what may NOT be done here.
 *
 * The note said: tighten when the token fallback is retired, and not before,
 * because shipping confirmed-only while nobody could be confirmed would make
 * every quorum in the product unsatisfiable at once. Assurance shipped earlier
 * the same day — an owner can compare a fingerprint phrase and press one button
 * — so `confirmed` is reachable for the first time and the trap is closed.
 *
 * ⚠️ ELIGIBILITY AND *ANSWERING* ARE SEPARATE QUESTIONS. An unconfirmed
 * verifier's answer is recorded and does not advance the quorum, and they are
 * not mailed a code at all — `lib/notify/verifier-notice-class.ts` classifies
 * them `not_counted` and mints nothing. What J7-R1 guarantees, after its second
 * amendment, is only **no enrolment step at decision time**: nobody is ever
 * asked to pick a password mid-emergency in order to answer.
 *
 * 🔴 THIS PARAGRAPH SAID THE OPPOSITE UNTIL 2026-08-21, and it said it as the
 * rationale for the rule below. It read: "THE FALLBACK IS NOT RETIRED, AND WILL
 * NOT BE. J7-R1 (amended 2026-08-12) permanently guarantees that a verifier who
 * never enrolled can still render a decision by single-use code."
 *
 * That sentence was withdrawn by the SECOND amendment the same day
 * (J7-R1, second amendment, docs/user-journeys.md §J7 requirements), for the reason this file's own rule
 * creates: once quorum counts only `confirmed` people, a code mailed to an
 * unconfirmed verifier buys a vote with no effect — full credential risk, zero
 * function. The classifier shipped that decision; four code comments kept
 * quoting the superseded version, so a reader of the module that DEFINES
 * eligibility would have concluded unconfirmed verifiers are still mailed live
 * codes and must be able to answer. The single-use code path remains, and it
 * remains for a different reason: a CONFIRMED verifier with no passkey and no
 * authenticator genuinely needs one.
 *
 * WHY CONFIRMED AND NOT MERELY CLAIMED. Claiming proves somebody spent a code.
 * Confirming proves the owner spoke to them. The claim ticket is a bearer secret
 * for the hours between sending and spending (§3.3), so an interceptor who
 * claimed the slot is indistinguishable from the intended person by every
 * measure the database has. Counting them would let the interception authorize
 * the release it was staged to obtain.
 *
 * Separation of duties rides on the same identity. `claimed_user_id` makes "the
 * same human" provable rather than inferred from an email spelling, so a
 * verifier who is also a recipient on the same release is excluded from the
 * count that authorizes their own access, and an owner is not an independent
 * attestation about themselves.
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

/**
 * Does this one verifier's answer count toward the quorum?
 *
 * Single-row form, so the configuration check and the runtime check cannot
 * drift: a threshold validated against one definition of "counts" and enforced
 * against another is how a plan passes validation and then stalls.
 */
export function isEligibleVerifier(
  row: VerifierEligibilityRow,
  ctx: EligibilityContext,
): boolean {
  // §4.3. `invited` and `claimed` may both still ANSWER — they are simply not
  // people whose identity the owner has checked, so their answer does not
  // advance a threshold that exists to represent verified attestation.
  if (readStandbyState(row.standby_state) !== 'confirmed') return false;

  // Nobody helps authorize their own access (rule 6), and an owner is not an
  // independent attestation about themselves (rule 7).
  const conflicted = new Set(ctx.recipientUserIds);
  if (ctx.ownerUserId) conflicted.add(ctx.ownerUserId);
  if (row.claimed_user_id && conflicted.has(row.claimed_user_id)) return false;

  return true;
}

export function countEligibleVerifiers(
  rows: VerifierEligibilityRow[],
  ctx: EligibilityContext,
): number {
  return rows.filter((r) => isEligibleVerifier(r, ctx)).length;
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
