/**
 * Tests for [A3] — readiness goes green at EXECUTABLE, not at complete.
 *
 * The pivot's strongest objection to the design it rejected was "perpetual amber
 * readiness that owners learn to ignore". Gating green on every roster row being
 * confirmed reintroduces exactly that: a circle of five with four confirmed is
 * amber forever, and an owner who sees amber forever stops reading it.
 *
 * Green means the plan CAN RUN: enough confirmed verifiers to satisfy the quorum,
 * plus at least one confirmed recipient to receive anything. Paired with §4.3
 * that makes green a true claim rather than a decoration.
 *
 * And anything short of green must state the single fastest next action. A status
 * light that does not say what to do is the amber owners learn to ignore.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect } from 'vitest';

import { assessCircle } from './circle-readiness';

const confirmed = (id: string) => ({ id, standby_state: 'confirmed' });
const claimedOnly = (id: string) => ({ id, standby_state: 'claimed' });
const invited = (id: string) => ({ id, standby_state: null });

describe('assessCircle', () => {
  it('is GREEN once the plan can actually run, even with people still outstanding', () => {
    const out = assessCircle({
      requiredConfirmations: 1,
      verifiers: [confirmed('v-1'), invited('v-2'), claimedOnly('v-3')],
      recipients: [confirmed('r-1'), invited('r-2')],
    });

    expect(out.light).toBe('green');
    expect(out.executable).toBe(true);
  });

  it('is not green when the quorum cannot be met by confirmed people', () => {
    const out = assessCircle({
      requiredConfirmations: 2,
      verifiers: [confirmed('v-1'), claimedOnly('v-2')],
      recipients: [confirmed('r-1')],
    });

    expect(out.light).not.toBe('green');
    expect(out.executable).toBe(false);
  });

  it('is not green with nobody to receive anything, however many verifiers agree', () => {
    const out = assessCircle({
      requiredConfirmations: 1,
      verifiers: [confirmed('v-1'), confirmed('v-2')],
      recipients: [claimedOnly('r-1')],
    });

    expect(out.executable).toBe(false);
  });

  it('is RED when nobody has claimed at all — this plan cannot do anything', () => {
    const out = assessCircle({
      requiredConfirmations: 1,
      verifiers: [invited('v-1')],
      recipients: [invited('r-1')],
    });

    expect(out.light).toBe('red');
  });

  it('is AMBER when people have claimed but not enough are confirmed', () => {
    const out = assessCircle({
      requiredConfirmations: 2,
      verifiers: [confirmed('v-1'), claimedOnly('v-2')],
      recipients: [confirmed('r-1')],
    });

    expect(out.light).toBe('amber');
  });

  it('names ONE next action, and it is the one that unblocks execution', () => {
    const out = assessCircle({
      requiredConfirmations: 2,
      verifiers: [confirmed('v-1'), claimedOnly('v-2')],
      recipients: [confirmed('r-1')],
    });

    expect(out.nextAction).toBeTruthy();
    // Confirming someone who already claimed is a two-minute call; chasing a
    // claim is days. The fastest unblocking action is the one to name.
    expect(out.nextAction).toMatch(/confirm/i);
  });

  it('asks for a claim when there is nobody claimed left to confirm', () => {
    const out = assessCircle({
      requiredConfirmations: 2,
      verifiers: [confirmed('v-1'), invited('v-2')],
      recipients: [confirmed('r-1')],
    });

    expect(out.nextAction).toMatch(/claim|invit|send/i);
  });

  it('says nothing to do when green — silence is the reward for being ready', () => {
    const out = assessCircle({
      requiredConfirmations: 1,
      verifiers: [confirmed('v-1')],
      recipients: [confirmed('r-1')],
    });

    expect(out.nextAction).toBeNull();
  });

  it('never counts a revoked person toward anything', () => {
    const out = assessCircle({
      requiredConfirmations: 1,
      verifiers: [{ id: 'v-1', standby_state: 'revoked' }, confirmed('v-2')],
      recipients: [confirmed('r-1')],
    });

    expect(out.confirmedVerifiers).toBe(1);
  });
});
