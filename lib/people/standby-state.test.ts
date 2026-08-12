/**
 * Tests for person state.
 *
 * This replaces `verification_status`, which was declared NOT NULL DEFAULT
 * 'pending' in migration 001, read with a `?? 'pending'` fallback, written by
 * NOTHING, and rendered as a permanent chip. A status that can never change is
 * furniture, not information.
 *
 * Two properties carry the weight here. NULL must read as `invited`, so the
 * columns added in 020 need no backfill. And the owner-facing light must be
 * derivable from state alone, because the whole point of it is that green means
 * "this person can actually do their job" rather than "a row exists".
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect } from 'vitest';

import {
  STANDBY_STATES,
  PERMITTED_STANDBY_EDGES,
  readStandbyState,
  canTransitionStandby,
  isUnreachable,
  circleLight,
} from './standby-state';

describe('readStandbyState — NULL means invited, so 020 needs no backfill', () => {
  it('maps NULL and undefined to invited', () => {
    expect(readStandbyState(null)).toBe('invited');
    expect(readStandbyState(undefined)).toBe('invited');
  });

  it('maps an empty or unrecognised value to invited rather than throwing', () => {
    // A row is never more trusted than its data. Anything unreadable is treated
    // as the least-privileged state, never as claimed or confirmed.
    for (const junk of ['', 'nonsense', 42, {}, 'CONFIRMED']) {
      expect(readStandbyState(junk)).toBe('invited');
    }
  });

  it('round-trips every real state', () => {
    for (const s of STANDBY_STATES) expect(readStandbyState(s)).toBe(s);
  });
});

describe('canTransitionStandby', () => {
  it('walks the normal path', () => {
    expect(canTransitionStandby('invited', 'claimed')).toBe(true);
    expect(canTransitionStandby('claimed', 'confirmed')).toBe(true);
  });

  it('lets the owner revoke from any live state', () => {
    expect(canTransitionStandby('invited', 'revoked')).toBe(true);
    expect(canTransitionStandby('claimed', 'revoked')).toBe(true);
    expect(canTransitionStandby('confirmed', 'revoked')).toBe(true);
  });

  it('drops confirmed back to claimed when the identity behind it changes', () => {
    // Re-claiming binds a new claimed_user_id, which changes the derived
    // fingerprint phrase — so the owner's previous confirmation is no longer
    // about the person now holding the slot. It must not silently stand.
    expect(canTransitionStandby('confirmed', 'claimed')).toBe(true);
  });

  it('never skips confirmation, and never resurrects a revoked person', () => {
    expect(canTransitionStandby('invited', 'confirmed')).toBe(false);
    expect(canTransitionStandby('revoked', 'claimed')).toBe(false);
    expect(canTransitionStandby('revoked', 'confirmed')).toBe(false);
    expect(canTransitionStandby('revoked', 'invited')).toBe(false);
  });

  it('is a no-op edge on itself', () => {
    for (const s of STANDBY_STATES) expect(canTransitionStandby(s, s)).toBe(false);
  });

  it('every permitted edge is between real states', () => {
    for (const e of PERMITTED_STANDBY_EDGES) {
      expect(STANDBY_STATES).toContain(e.from);
      expect(STANDBY_STATES).toContain(e.to);
    }
  });
});

describe('isUnreachable — derived on read, never stored, never swept', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('is true for an invited person whose ticket TTL has passed', () => {
    expect(isUnreachable({ state: 'invited', inviteExpiresAt: '2026-08-10T12:00:00Z' }, now)).toBe(
      true,
    );
  });

  it('is false while the ticket is still live', () => {
    expect(isUnreachable({ state: 'invited', inviteExpiresAt: '2026-08-12T12:00:00Z' }, now)).toBe(
      false,
    );
  });

  it('never applies to someone who already claimed', () => {
    for (const state of ['claimed', 'confirmed', 'revoked'] as const) {
      expect(isUnreachable({ state, inviteExpiresAt: '2020-01-01T00:00:00Z' }, now)).toBe(false);
    }
  });

  it('is false when there is no ticket or the date is unreadable', () => {
    expect(isUnreachable({ state: 'invited', inviteExpiresAt: null }, now)).toBe(false);
    expect(isUnreachable({ state: 'invited', inviteExpiresAt: 'not-a-date' }, now)).toBe(false);
  });
});

describe('circleLight — three positions, and green is a claim about capability', () => {
  it('is red until the person has claimed', () => {
    expect(circleLight('invited')).toBe('red');
  });

  it('is amber once claimed but not yet confirmed', () => {
    expect(circleLight('claimed')).toBe('amber');
  });

  it('is green only when confirmed', () => {
    expect(circleLight('confirmed')).toBe('green');
  });

  it('shows a revoked person as red, never as merely incomplete', () => {
    expect(circleLight('revoked')).toBe('red');
  });

  it('has exactly three positions across every state', () => {
    const lights = new Set(STANDBY_STATES.map(circleLight));
    expect([...lights].sort()).toEqual(['amber', 'green', 'red']);
  });
});
