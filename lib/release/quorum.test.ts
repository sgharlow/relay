/**
 * Tests for who actually counts toward N-of-M.
 *
 * `getVerifierCount` is a bare `COUNT(*)` over the verifiers roster. Under the
 * old model that was fine: every verifier had an emailed token, so every roster
 * row could act. Under standby it is not, and it produces a failure with no error
 * anywhere — **an unsatisfiable quorum**. Require 2 confirmations from a circle
 * where only 1 person can act and the release simply never completes. Nothing
 * throws. Nobody is told.
 *
 * THE STAGING TRAP, which is the reason this file is careful. §4.3 says quorum
 * counts *confirmed* participants. Ship that before the fingerprint flow exists
 * and nobody is confirmed, so EVERY quorum becomes unsatisfiable at once. During
 * the transition an unclaimed verifier can still act by emailed token, so the
 * count must include anyone who can act by EITHER route.
 *
 * And the separation of duties the identity model finally makes enforceable: a
 * verifier who is also a recipient on the same release should not help authorize
 * their own access.
 *
 * Feature: relay-standby
 * Requirements: 3.9, J4-R13
 */

import { describe, it, expect } from 'vitest';

import { countEligibleVerifiers, assertQuorumSatisfiable } from './quorum';
import { ValidationError } from '../validation';

const claimed = (over: Partial<Row> = {}): Row => ({
  id: 'v-1',
  claimed_user_id: 'user-1',
  standby_state: 'claimed',
  ...over,
});

type Row = {
  id: string;
  claimed_user_id: string | null;
  standby_state: string | null;
};

describe('countEligibleVerifiers — who can actually answer', () => {
  it('counts a claimed verifier: they can sign in and confirm', () => {
    expect(countEligibleVerifiers([claimed()], { recipientUserIds: [] })).toBe(1);
  });

  it('counts a confirmed verifier', () => {
    expect(countEligibleVerifiers([claimed({ standby_state: 'confirmed' })], { recipientUserIds: [] })).toBe(1);
  });

  it('STILL counts an unclaimed verifier during the transition — the token path works', () => {
    // The trap. Excluding these would strand releases by leaving out people who
    // can genuinely still act.
    expect(
      countEligibleVerifiers([{ id: 'v-1', claimed_user_id: null, standby_state: null }], {
        recipientUserIds: [],
      }),
    ).toBe(1);
  });

  it('never counts a revoked verifier, claimed or not', () => {
    expect(
      countEligibleVerifiers([claimed({ standby_state: 'revoked' })], { recipientUserIds: [] }),
    ).toBe(0);
  });

  it('does not let someone help authorize their OWN access', () => {
    // Separation of duties, enforceable for the first time because both roster
    // rows now point at the same claimed_user_id. Under email-keyed rows this
    // was only a warning, and only in the extreme case.
    expect(countEligibleVerifiers([claimed()], { recipientUserIds: ['user-1'] })).toBe(0);
  });

  it('counts the others when only one verifier is conflicted', () => {
    const rows = [claimed({ id: 'v-1' }), claimed({ id: 'v-2', claimed_user_id: 'user-2' })];
    expect(countEligibleVerifiers(rows, { recipientUserIds: ['user-1'] })).toBe(1);
  });

  it('excludes the owner — they may be the incapacitated or coerced party', () => {
    expect(
      countEligibleVerifiers([claimed({ claimed_user_id: 'owner-1' })], {
        recipientUserIds: [],
        ownerUserId: 'owner-1',
      }),
    ).toBe(0);
  });
});

describe('assertQuorumSatisfiable', () => {
  it('permits N when enough people can actually answer', () => {
    expect(() => assertQuorumSatisfiable(2, 3)).not.toThrow();
  });

  it('REFUSES an N nobody could ever reach, instead of stalling silently later', () => {
    expect(() => assertQuorumSatisfiable(3, 2)).toThrow(ValidationError);
  });

  it('refuses a quorum of zero — a release nobody attests to is not a quorum', () => {
    expect(() => assertQuorumSatisfiable(0, 3)).toThrow(ValidationError);
  });

  it('names the shortfall, because "invalid" does not tell an owner what to do', () => {
    try {
      assertQuorumSatisfiable(3, 1);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/1/);
      expect((e as Error).message).toMatch(/3/);
    }
  });
});
