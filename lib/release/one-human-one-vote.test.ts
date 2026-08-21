/**
 * M counts PEOPLE, not rows.
 *
 * 🔴 THE DEFECT, found 2026-08-21 by a review of the unified add-a-person work.
 * `countEligibleVerifiers` was `rows.filter(isEligibleVerifier).length` — a count
 * of verifier ROWS. `isEligibleVerifier` already refuses the owner (rule 7) and
 * anyone who is also a recipient on the release (rule 6), so the obvious
 * self-authorisation shapes were closed. What was not closed is the dull one:
 *
 *   one human, entered twice under two addresses — personal and work — claiming
 *   both standby invitations with the SAME account, both confirmed by the owner.
 *
 * That is two rows, two `confirmed` states, one person, and it counted as 2. A
 * quorum of 2-of-3 could then be satisfied by that person alone, and every
 * surface that reports assurance would have agreed: `assertQuorumSatisfiable`
 * would accept N=2, the coverage matrix would show two verifiers, and the
 * release would open on one human's say-so while telling the owner two people
 * had confirmed.
 *
 * It is not exotic. The product ASKS people to claim a standby account, and a
 * person invited at two addresses signs in with the account they already have —
 * `claimed_user_id` is exactly the field that records "these are the same
 * person", and nothing was reading it for this.
 *
 * THE FIX IS STRUCTURAL, not an entry-time check. `lib/people/verifiers.ts`
 * gained a same-address duplicate guard in the same sprint, and that guard is
 * good and insufficient: it closes one address twice, not one human twice. This
 * counts distinct humans at the moment the number is used, so no future entry
 * path can reopen it.
 *
 * ⚠️ UNCLAIMED ROWS STILL COUNT INDIVIDUALLY, deliberately. A `claimed_user_id`
 * of NULL means nobody has claimed that invitation yet, so two unclaimed rows
 * are two prospective people and there is no evidence they are one. Collapsing
 * them would UNDERCOUNT M and refuse quorums that are genuinely reachable —
 * failing in the direction that blocks a real emergency.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.6, J7-R1 (N-of-M is N distinct attestations)
 */

import { describe, it, expect } from 'vitest';
import { countEligibleVerifiers, type VerifierEligibilityRow } from './quorum';

const confirmed = (id: string, claimed: string | null): VerifierEligibilityRow => ({
  id,
  claimed_user_id: claimed,
  standby_state: 'confirmed',
});

describe('M counts people, not rows', () => {
  it('one human claiming two verifier rows counts ONCE', () => {
    const rows = [confirmed('v-work', 'user-anna'), confirmed('v-home', 'user-anna')];

    expect(
      countEligibleVerifiers(rows, { recipientUserIds: [] }),
      'two rows claimed by the same account counted as two independent attestations — ' +
        'a 2-of-M quorum would be satisfiable by one person',
    ).toBe(1);
  });

  it('two different humans still count as two', () => {
    const rows = [confirmed('v-1', 'user-anna'), confirmed('v-2', 'user-bram')];
    expect(countEligibleVerifiers(rows, { recipientUserIds: [] })).toBe(2);
  });

  it('unclaimed rows count individually — they are not evidence of one person', () => {
    // Collapsing these would UNDERCOUNT M and refuse a reachable quorum, which
    // fails in the direction that blocks a real emergency.
    const rows = [confirmed('v-1', null), confirmed('v-2', null)];
    expect(countEligibleVerifiers(rows, { recipientUserIds: [] })).toBe(2);
  });

  it('a claimed human and an unclaimed invitation count as two', () => {
    const rows = [confirmed('v-1', 'user-anna'), confirmed('v-2', null)];
    expect(countEligibleVerifiers(rows, { recipientUserIds: [] })).toBe(2);
  });

  it('the existing exclusions still apply before the dedupe', () => {
    // The owner is not an independent attestation about themselves (rule 7), and
    // a recipient does not authorize their own access (rule 6). Both must be
    // removed BEFORE distinct-counting, or a conflicted duplicate could survive
    // as the surviving copy of its own pair.
    const rows = [
      confirmed('v-owner', 'user-owner'),
      confirmed('v-owner-again', 'user-owner'),
      confirmed('v-real', 'user-anna'),
    ];
    expect(
      countEligibleVerifiers(rows, { recipientUserIds: [], ownerUserId: 'user-owner' }),
      'the owner was counted despite rule 7',
    ).toBe(1);
  });

  it('an unconfirmed duplicate does not resurrect its confirmed twin', () => {
    const rows = [
      confirmed('v-1', 'user-anna'),
      { id: 'v-2', claimed_user_id: 'user-anna', standby_state: 'invited' },
    ];
    expect(countEligibleVerifiers(rows, { recipientUserIds: [] })).toBe(1);
  });
});
